import {
	App,
	FileSystemAdapter,
	Menu,
	Notice,
	Platform,
} from 'obsidian';
import {
	encodeMacOsFileUrl,
	getClipboardMediaPlan,
	getCopyMediaLabel,
	getRevealInFileManagerLabel,
	runNavigationThenClose,
	type ClipboardMediaPlan,
} from './media-context-menu-helpers';
import { getMediaMimeType } from './media-utils';
import type { GalleryMedia } from './types';

type BrowserWindow = Window & {
	Blob: typeof Blob;
	ClipboardItem: typeof ClipboardItem;
};

// Desktop globals are optional runtime capabilities, not browser APIs. Keep
// their boundary independent of Node typings, including in Obsidian's scanner.
declare const require: unknown;
declare const Buffer: unknown;

interface NativeClipboard {
	has(format: string): boolean;
	writeBuffer(format: string, buffer: Uint8Array): void;
}

interface NativeShell {
	showItemInFolder(fullPath: string): void;
}

interface NativeBufferConstructor {
	from(value: string, encoding: 'utf8'): Uint8Array;
}

const MACOS_FILE_URL_CLIPBOARD_FORMAT = 'public.file-url';

export interface MediaContextMenuOptions {
	afterNavigate?: () => Promise<void> | void;
	app: App;
	event: MouseEvent;
	media: GalleryMedia;
	revealSource: (media: GalleryMedia) => Promise<void>;
}

/**
 * Shows the desktop media menu and returns whether the event was handled.
 *
 * The implementation uses Obsidian's public APIs, the standardized browser
 * Clipboard API, and Electron's public shell API behind a desktop-only guard.
 */
export function showMediaContextMenu(
	options: MediaContextMenuOptions,
): boolean {
	if (!Platform.isDesktop) {
		return false;
	}

	const { app, event, media } = options;
	event.preventDefault();
	event.stopPropagation();
	const ownerWindow = getEventWindow(event);
	const sourceMimeType = getMediaMimeType(media.file.extension);
	const clipboardPlan = getClipboardMediaPlan(
		sourceMimeType,
		getClipboardSupport(app, ownerWindow),
	);
	const canCopyPath = hasClipboardTextSupport(ownerWindow);
	const menu = Menu.forEvent(event);
	if (Platform.isDesktopApp) {
		menu.setUseNativeMenu(true);
	}

	menu.addItem((item) => {
		item
			.setTitle(getCopyMediaLabel(media.kind))
			.setIcon('copy')
			.setDisabled(clipboardPlan === null)
			.onClick(() => {
				if (!clipboardPlan) {
					return;
				}
				void runMenuAction(
					() =>
						copyMediaToClipboard(
							app,
							media,
							ownerWindow,
							clipboardPlan,
						),
					media.kind === 'image'
						? 'Image copied to clipboard.'
						: 'Video copied to clipboard.',
					'Could not copy this media.',
				);
			});
	});

	menu.addItem((item) => {
		item
			.setTitle('Copy vault path')
			.setIcon('copy')
			.setDisabled(!canCopyPath)
			.onClick(() => {
				void runMenuAction(
					() => copyVaultPath(ownerWindow, media.file.path),
					'Vault path copied.',
					'Could not copy the vault path.',
				);
			});
	});

	menu.addSeparator();
	menu.addItem((item) => {
		item
			.setTitle('Open media file')
			.setIcon('file')
			.onClick(() => {
				void runMenuAction(
					() =>
						runNavigationThenClose(
							() => openMediaFile(app, media),
							options.afterNavigate,
						),
					null,
					'Could not open the media file.',
				);
			});
	});
	if (canRevealInFileManager(app)) {
		menu.addItem((item) => {
			item
				.setTitle(getRevealInFileManagerLabel(Platform))
				.setIcon('folder-open')
				.onClick(() => {
					void runMenuAction(
						() => revealInFileManager(app, media),
						null,
						'Could not reveal the media file.',
					);
				});
		});
	}
	menu.addItem((item) => {
		item
			.setTitle('Go to source in note')
			.setIcon('locate-fixed')
			.onClick(() => {
				void runMenuAction(
					() =>
						runNavigationThenClose(
							() => options.revealSource(media),
							options.afterNavigate,
						),
					null,
					'Could not open the media location.',
				);
			});
	});

	menu.showAtMouseEvent(event);
	return true;
}

function getEventWindow(event: MouseEvent): BrowserWindow {
	return event.win as BrowserWindow;
}

function getClipboardSupport(app: App, ownerWindow: BrowserWindow): {
	canCopyOriginalMacFile: boolean;
	canWriteItems: boolean;
	supportsType(type: string): boolean;
} {
	const clipboard = ownerWindow.navigator.clipboard;
	const ClipboardItemConstructor = ownerWindow.ClipboardItem;
	return {
		canCopyOriginalMacFile: canCopyOriginalMacFile(app),
		canWriteItems:
			typeof clipboard?.write === 'function' &&
			typeof ClipboardItemConstructor === 'function',
		supportsType: (type: string) => {
			if (typeof ClipboardItemConstructor !== 'function') {
				return false;
			}
			if (typeof ClipboardItemConstructor.supports !== 'function') {
				return true;
			}
			try {
				return ClipboardItemConstructor.supports(type);
			} catch {
				return false;
			}
		},
	};
}

function hasClipboardTextSupport(ownerWindow: BrowserWindow): boolean {
	return typeof ownerWindow.navigator.clipboard?.writeText === 'function';
}

async function copyMediaToClipboard(
	app: App,
	media: GalleryMedia,
	ownerWindow: BrowserWindow,
	plan: ClipboardMediaPlan,
): Promise<void> {
	if (plan.method === 'macos-file-url') {
		try {
			await copyOriginalMacFile(app, media);
			return;
		} catch (error) {
			if (!plan.fallbackMimeType) {
				throw error;
			}
			await copyOriginalBlob(
				app,
				media,
				ownerWindow,
				plan.fallbackMimeType,
			);
			return;
		}
	}

	await copyOriginalBlob(
		app,
		media,
		ownerWindow,
		plan.targetMimeType,
	);
}

function copyOriginalBlob(
	app: App,
	media: GalleryMedia,
	ownerWindow: BrowserWindow,
	targetMimeType: string,
): Promise<void> {
	const clipboard = ownerWindow.navigator.clipboard;
	const ClipboardItemConstructor = ownerWindow.ClipboardItem;
	if (
		typeof clipboard?.write !== 'function' ||
		typeof ClipboardItemConstructor !== 'function'
	) {
		return Promise.reject(new Error('Clipboard media writes are unavailable.'));
	}

	const blob = app.vault
		.readBinary(media.file)
		.then(
			(bytes) =>
				new ownerWindow.Blob([bytes], { type: targetMimeType }),
		);
	const item = new ClipboardItemConstructor({
		[targetMimeType]: blob,
	});
	return clipboard.write([item]);
}

function canCopyOriginalMacFile(app: App): boolean {
	return (
		Platform.isDesktopApp &&
		Platform.isMacOS &&
		app.vault.adapter instanceof FileSystemAdapter
	);
}

function copyOriginalMacFile(
	app: App,
	media: GalleryMedia,
): Promise<void> {
	const adapter = app.vault.adapter;
	if (
		!Platform.isDesktopApp ||
		!Platform.isMacOS ||
		!(adapter instanceof FileSystemAdapter)
	) {
		throw new Error('The original file is unavailable to desktop APIs.');
	}

	const fullPath = adapter.getFullPath(media.file.path);
	writeMacFileUrlWithElectron(fullPath);
	return Promise.resolve();
}

function writeMacFileUrlWithElectron(fullPath: string): void {
	const electron = loadDesktopElectron();
	if (
		!hasProperty(electron, 'clipboard') ||
		!isNativeClipboard(electron.clipboard) ||
		typeof Buffer === 'undefined' ||
		!isNativeBufferConstructor(Buffer)
	) {
		throw new Error('Electron file clipboard writes are unavailable.');
	}

	const clipboard = electron.clipboard;
	const fileUrl = encodeMacOsFileUrl(fullPath);
	clipboard.writeBuffer(
		MACOS_FILE_URL_CLIPBOARD_FORMAT,
		Buffer.from(fileUrl, 'utf8'),
	);
	if (!clipboard.has(MACOS_FILE_URL_CLIPBOARD_FORMAT)) {
		throw new Error('macOS rejected the file URL clipboard representation.');
	}
}

function copyVaultPath(
	ownerWindow: BrowserWindow,
	path: string,
): Promise<void> {
	const clipboard = ownerWindow.navigator.clipboard;
	if (typeof clipboard?.writeText !== 'function') {
		return Promise.reject(new Error('Clipboard text writes are unavailable.'));
	}
	return clipboard.writeText(path);
}

function openMediaFile(app: App, media: GalleryMedia): Promise<void> {
	return app.workspace.openLinkText(
		media.file.path,
		media.note.path,
		false,
	);
}

function canRevealInFileManager(app: App): boolean {
	return (
		Platform.isDesktopApp && app.vault.adapter instanceof FileSystemAdapter
	);
}

function revealInFileManager(app: App, media: GalleryMedia): Promise<void> {
	if (!Platform.isDesktop) {
		return Promise.reject(new Error('Desktop APIs are unavailable.'));
	}
	if (
		!Platform.isDesktopApp ||
		!(app.vault.adapter instanceof FileSystemAdapter)
	) {
		return Promise.reject(new Error('The vault has no desktop file path.'));
	}

	const electron = loadDesktopElectron();
	if (!hasProperty(electron, 'shell') || !isNativeShell(electron.shell)) {
		return Promise.reject(new Error('The desktop file manager is unavailable.'));
	}
	electron.shell.showItemInFolder(app.vault.adapter.getFullPath(media.file.path));
	return Promise.resolve();
}

function loadDesktopElectron(): unknown {
	if (!Platform.isDesktopApp || typeof require !== 'function') {
		throw new Error('Desktop module loading is unavailable.');
	}

	// Obsidian supplies CommonJS in its Electron renderer. A native import()
	// would instead be handled by Chromium. Treat its result as untrusted until
	// the specific clipboard or shell capabilities have been checked below.
	const loadModule = require as (specifier: string) => unknown;
	return loadModule('electron');
}

function hasProperty<Key extends string>(
	value: unknown,
	key: Key,
): value is Record<Key, unknown> {
	return (
		((typeof value === 'object' && value !== null) ||
			typeof value === 'function') &&
		key in value
	);
}

function isNativeClipboard(value: unknown): value is NativeClipboard {
	return (
		hasProperty(value, 'has') &&
		typeof value.has === 'function' &&
		hasProperty(value, 'writeBuffer') &&
		typeof value.writeBuffer === 'function'
	);
}

function isNativeShell(value: unknown): value is NativeShell {
	return (
		hasProperty(value, 'showItemInFolder') &&
		typeof value.showItemInFolder === 'function'
	);
}

function isNativeBufferConstructor(
	value: unknown,
): value is NativeBufferConstructor {
	return hasProperty(value, 'from') && typeof value.from === 'function';
}

async function runMenuAction(
	action: () => Promise<void>,
	successMessage: string | null,
	failureMessage: string,
): Promise<void> {
	try {
		await action();
		if (successMessage) {
			new Notice(successMessage);
		}
	} catch {
		new Notice(failureMessage);
	}
}
