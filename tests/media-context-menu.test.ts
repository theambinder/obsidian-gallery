import assert from 'node:assert/strict';
import { Buffer as NodeBuffer } from 'node:buffer';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// Run the actual menu handlers with narrowly simulated native capabilities.
// No clipboard writes or file-manager launches occur on the test host.
const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/media-context-menu.ts', import.meta.url))],
	bundle: true,
	write: false,
	format: 'cjs',
	platform: 'browser',
	external: ['obsidian', 'electron'],
});

class MenuItemStub {
	title = '';
	disabled = false;
	action: (() => void) | null = null;
	setTitle(title: string): this { this.title = title; return this; }
	setIcon(): this { return this; }
	setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
	onClick(action: () => void): this { this.action = action; return this; }
}

interface ClipboardItemStub {
	data: Record<string, Promise<Blob>>;
}

interface MenuModule {
	showMediaContextMenu(options: {
		app: unknown;
		event: unknown;
		media: unknown;
		revealSource(): Promise<void>;
		afterNavigate(): void;
	}): boolean;
}

function createMenu(options: {
	mobile?: boolean;
	browserOnly?: boolean;
	windows?: boolean;
	electron?: unknown;
	missingBuffer?: boolean;
	missingRequire?: boolean;
	clipboardTypes?: string[];
} = {}) {
	const notices: string[] = [];
	const moduleLoads: string[] = [];
	const items: MenuItemStub[] = [];
	const nativeWrites: { format: string; bytes: Uint8Array }[] = [];
	const revealedPaths: string[] = [];
	const browserWrites: ClipboardItemStub[][] = [];
	const copiedPaths: string[] = [];
	const navigation: string[] = [];
	let binaryReads = 0;
	let eventHandled = false;
	let menuShown = false;
	let nativeMenu = false;
	const macOS = !options.windows;
	const nativeClipboard = {
		writeBuffer(format: string, bytes: Uint8Array): void {
			assert.equal(this, nativeClipboard, 'Preserve native API receiver');
			nativeWrites.push({ format, bytes });
		},
		has(format: string): boolean {
			assert.equal(this, nativeClipboard, 'Preserve native API receiver');
			return nativeWrites.some(write => write.format === format);
		},
	};
	const shell = {
		showItemInFolder(path: string): void {
			assert.equal(this, shell, 'Preserve native API receiver');
			revealedPaths.push(path);
		},
	};
	class FileSystemAdapterStub {
		getFullPath(path: string): string {
			return options.windows ? `C:\\Vault\\${path.replaceAll('/', '\\')}` : `/Users/Example/Vault/${path}`;
		}
	}
	class ItemStub implements ClipboardItemStub {
		constructor(readonly data: Record<string, Promise<Blob>>) {}
		static supports(type: string): boolean { return options.clipboardTypes?.includes(type) ?? false; }
	}
	const ownerWindow = {
		Blob,
		ClipboardItem: ItemStub,
		navigator: {
			clipboard: {
				write(items: ClipboardItemStub[]): Promise<void> {
					browserWrites.push(items);
					return Promise.resolve();
				},
				writeText(path: string): Promise<void> {
					copiedPaths.push(path);
					return Promise.resolve();
				},
			},
		},
	};
	const menu = {
		setUseNativeMenu(value: boolean): void { nativeMenu = value; },
		addItem(configure: (item: MenuItemStub) => void): void {
			const item = new MenuItemStub();
			configure(item);
			items.push(item);
		},
		addSeparator(): void {},
		showAtMouseEvent(): void { menuShown = true; },
	};
	const obsidian = {
		FileSystemAdapter: FileSystemAdapterStub,
		Menu: { forEvent: () => menu },
		Notice: class { constructor(message: string) { notices.push(message); } },
		Platform: {
			isDesktop: !options.mobile,
			isDesktopApp: !options.mobile && !options.browserOnly,
			isMacOS: macOS,
			isWin: !macOS,
		},
	};
	const module = { exports: {} as MenuModule };
	const context = {
		module,
		exports: module.exports,
		Buffer: options.missingBuffer ? undefined : NodeBuffer,
		require: ((specifier: string): unknown => {
			moduleLoads.push(specifier);
			if (specifier === 'obsidian') { return obsidian; }
			assert.equal(specifier, 'electron');
			return 'electron' in options ? options.electron : { clipboard: nativeClipboard, shell };
		}) as ((specifier: string) => unknown) | undefined,
	};
	runInNewContext(compiled.outputFiles[0]!.text, context);
	if (options.missingRequire) { context.require = undefined; }
	const file = { path: 'Attachments/100% # кадр.webp', extension: 'webp' };
	const app = {
		vault: {
			adapter: new FileSystemAdapterStub(),
			readBinary(): Promise<ArrayBuffer> {
				binaryReads += 1;
				return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
			},
		},
		workspace: {
			openLinkText(path: string, note: string): Promise<void> {
				navigation.push(`open:${path}:${note}`);
				return Promise.resolve();
			},
		},
	};
	const handled = module.exports.showMediaContextMenu({
		app,
		media: { file, note: { path: 'Note.md' }, kind: 'image' },
		event: {
			win: ownerWindow,
			preventDefault(): void { eventHandled = true; },
			stopPropagation(): void {},
		},
		revealSource: () => { navigation.push('source'); return Promise.resolve(); },
		afterNavigate: () => { navigation.push('close'); },
	});
	return {
		items, notices, moduleLoads, nativeWrites, revealedPaths, browserWrites,
		copiedPaths, navigation, handled, eventHandled, menuShown, nativeMenu,
		binaryReads: () => binaryReads,
		async click(title: string): Promise<void> {
			const item = items.find(item => item.title === title);
			assert.ok(item, `Menu contains ${title}`);
			assert.equal(item.disabled, false);
			assert.ok(item.action);
			item.action();
			await setImmediate();
		},
	};
}

void test('macOS copies an original file URL using a real Node Buffer without reading/transcoding media', async () => {
	const h = createMenu();
	assert.equal(h.handled, true);
	assert.equal(h.menuShown, true);
	assert.equal(h.nativeMenu, true);
	await h.click('Copy image');
	assert.equal(h.nativeWrites.length, 1);
	const write = h.nativeWrites[0]!;
	assert.equal(write.format, 'public.file-url');
	assert.equal(NodeBuffer.isBuffer(write.bytes), true, 'Electron requires a Buffer, not a new browser byte array');
	assert.equal(NodeBuffer.from(write.bytes).toString('utf8'), 'file:///Users/Example/Vault/Attachments/100%25%20%23%20%D0%BA%D0%B0%D0%B4%D1%80.webp');
	assert.equal(h.binaryReads(), 0);
	assert.equal(h.browserWrites.length, 0);
	assert.deepEqual(h.moduleLoads, ['obsidian', 'electron']);
	assert.deepEqual(h.notices, ['Image copied to clipboard.']);
});

void test('desktop Finder and Explorer actions still resolve and reveal the original vault path', async () => {
	for (const windows of [false, true]) {
		const h = createMenu({ windows });
		await h.click(windows ? 'Show in File Explorer' : 'Reveal in Finder');
		assert.deepEqual(h.revealedPaths, [windows ? 'C:\\Vault\\Attachments\\100% # кадр.webp' : '/Users/Example/Vault/Attachments/100% # кадр.webp']);
		assert.deepEqual(h.moduleLoads, ['obsidian', 'electron']);
		assert.equal(h.notices.length, 0);
	}
});

void test('unavailable/malformed native clipboard or Buffer falls back to the exact supported original MIME', async () => {
	for (const options of [
		{ electron: null },
		{ electron: { clipboard: { writeBuffer: 'not callable', has: () => true } } },
		{ electron: { clipboard: { writeBuffer: () => undefined, has: () => false } } },
		{ missingBuffer: true },
		{ missingRequire: true },
	]) {
		const h = createMenu({ ...options, clipboardTypes: ['image/webp'] });
		await h.click('Copy image');
		assert.equal(h.browserWrites.length, 1);
		const item = h.browserWrites[0]![0]!;
		assert.deepEqual(Object.keys(item.data), ['image/webp']);
		const blob = await item.data['image/webp'];
		assert.ok(blob);
		assert.equal(blob.type, 'image/webp');
		assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
		assert.equal(h.binaryReads(), 1);
		assert.deepEqual(h.notices, ['Image copied to clipboard.']);
	}
});

void test('native capability errors without a supported exact fallback report failure without copying a different format', async () => {
	const h = createMenu({ electron: { clipboard: {} }, clipboardTypes: ['image/png'] });
	await h.click('Copy image');
	assert.deepEqual(h.notices, ['Could not copy this media.']);
	assert.equal(h.browserWrites.length, 0);
	assert.equal(h.binaryReads(), 0);
});

void test('unavailable native shell reports a safe menu error', async () => {
	for (const electron of [null, {}, { shell: { showItemInFolder: false } }]) {
		const h = createMenu({ electron });
		await h.click('Reveal in Finder');
		assert.deepEqual(h.notices, ['Could not reveal the media file.']);
		assert.equal(h.revealedPaths.length, 0);
	}
});

void test('browser desktop uses the clipboard API and never loads native desktop modules', async () => {
	const h = createMenu({ browserOnly: true, clipboardTypes: ['image/webp'] });
	assert.equal(h.nativeMenu, false);
	assert.equal(h.items.some(item => item.title === 'Reveal in Finder'), false);
	await h.click('Copy image');
	await h.click('Copy vault path');
	assert.equal(h.browserWrites.length, 1);
	assert.deepEqual(h.copiedPaths, ['Attachments/100% # кадр.webp']);
	assert.deepEqual(h.moduleLoads, ['obsidian']);
});

void test('mobile never handles desktop menus or loads Electron even if native globals are unavailable', () => {
	const h = createMenu({ mobile: true, missingRequire: true, missingBuffer: true });
	assert.equal(h.handled, false);
	assert.equal(h.eventHandled, false);
	assert.equal(h.menuShown, false);
	assert.equal(h.items.length, 0);
	assert.deepEqual(h.moduleLoads, ['obsidian']);
});

void test('opening a media file and navigating to its source still close only after successful navigation', async () => {
	const h = createMenu();
	await h.click('Open media file');
	await h.click('Go to source in note');
	assert.deepEqual(h.navigation, ['open:Attachments/100% # кадр.webp:Note.md', 'close', 'source', 'close']);
});
