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

interface ElectronModule {
	clipboard?: {
		has?: (format: string) => boolean;
		writeBuffer?: (format: string, buffer: Uint8Array) => void;
	};
	shell: {
		showItemInFolder: (fullPath: string) => void;
	};
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
	// These modules are intentionally loaded only after desktop/macOS checks.
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian's Electron renderer exposes CommonJS at runtime.
	const { clipboard } = require('electron') as ElectronModule;
	if (
		typeof clipboard?.writeBuffer !== 'function' ||
		typeof clipboard.has !== 'function'
	) {
		throw new Error('Electron file clipboard writes are unavailable.');
	}

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

	// Obsidian plugins run as CommonJS in Electron's renderer. Native import()
	// would be handled by Chromium rather than Electron's module loader.
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron's renderer module is CommonJS-only here.
	const { shell } = require('electron') as ElectronModule;
	shell.showItemInFolder(app.vault.adapter.getFullPath(media.file.path));
	return Promise.resolve();
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
