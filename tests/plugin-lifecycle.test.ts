import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { TILE_SCALE_PRESETS, tileScaleToLevel } from '../src/gallery-tile-size';

interface TestPlugin {
	onload(): Promise<void>;
	onunload(): void;
	activateGallery(): Promise<unknown>;
	focusGallery(): Promise<void>;
	showDiagnostics(): void;
	isLayoutReady: boolean;
	getTileScale(): number;
	getLayoutMode(): string;
	getShowSections(): boolean;
	setTileScale(value: number): Promise<void>;
	setLayoutMode(value: 'square' | 'aspect'): Promise<void>;
	setShowSections(value: boolean): Promise<void>;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

const pluginBundle = build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron'],
	format: 'cjs',
	platform: 'node',
	write: false,
	plugins: [{
		name: 'diagnostics-test-double',
		setup(bundler) {
			bundler.onResolve({ filter: /\/mobile-diagnostics$/ }, () => ({ path: 'diagnostics-test-double', external: true }));
		},
	}],
}).then((result) => result.outputFiles[0]!.text);

async function harness(options: {
	isMobile?: boolean;
	data?: Promise<unknown>;
	saveData?: (data: unknown) => Promise<void>;
	setViewState?: Promise<void>;
	revealLeaf?: Promise<void>;
} = {}) {
	const layoutCallbacks: (() => void)[] = [];
	const commands = new Map<string, () => void>();
	const ribbonCallbacks: (() => void)[] = [];
	const notices: string[] = [];
	const diagnostics: { close(): void; closed: number }[] = [];
	const timers = new Map<number, () => void>();
	const calls = {
		registeredViews: 0, registeredSettings: 0, reveal: 0, refresh: 0, visible: 0, focus: 0,
		saved: [] as Record<string, unknown>[],
		scales: [] as number[],
		layouts: [] as string[],
		sectionVisibility: [] as boolean[],
	};
	let nextTimer = 0;
	let viewFactory!: (leaf: object) => object;
	let hasLeaf = false;
	const leaf = {
		view: {},
		setViewState(): Promise<void> {
			leaf.view = viewFactory(leaf);
			instrumentView();
			hasLeaf = true;
			return options.setViewState ?? Promise.resolve();
		},
	};
	function instrumentView(): void {
		Object.assign(leaf.view, {
			refresh: () => { calls.refresh += 1; },
			refreshVisibleMedia: () => { calls.visible += 1; },
			focusGallery: () => { calls.focus += 1; },
			setTileScale: (scale: number) => { calls.scales.push(scale); },
			setLayoutMode: (mode: string) => { calls.layouts.push(mode); },
			setShowSections: (show: boolean) => { calls.sectionVisibility.push(show); },
		});
	}
	const app = {
		workspace: {
			on: () => ({}),
			onLayoutReady: (callback: () => void) => { layoutCallbacks.push(callback); },
			getActiveFile: () => null,
			getActiveViewOfType: () => null,
			getLeavesOfType: () => hasLeaf ? [leaf] : [],
			getRightLeaf: () => leaf,
			revealLeaf: () => {
				calls.reveal += 1;
				return options.revealLeaf ?? Promise.resolve();
			},
		},
		metadataCache: { on: () => ({}) },
		vault: { on: () => ({}) },
	};
	class HostPlugin {
		app = app;
		manifest = { version: 'test' };
		loadData(): Promise<unknown> { return options.data ?? Promise.resolve(null); }
		saveData(data: unknown): Promise<void> {
			calls.saved.push(JSON.parse(JSON.stringify(data)) as Record<string, unknown>);
			return options.saveData?.(data) ?? Promise.resolve();
		}
		registerView(_type: string, factory: (leaf: object) => object): void {
			calls.registeredViews += 1;
			viewFactory = factory;
		}
		addRibbonIcon(_icon: string, _title: string, callback: () => void): void { ribbonCallbacks.push(callback); }
		addCommand(command: { id: string; callback: () => void }): void { commands.set(command.id, command.callback); }
		addSettingTab(): void { calls.registeredSettings += 1; }
		registerEvent(): void {}
	}
	const module = { exports: {} };
	const nodeRequire = createRequire(import.meta.url);
	runInNewContext(await pluginBundle, {
		module,
		window: {
			setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
			clearTimeout: (timer: number) => { timers.delete(timer); },
		},
		require: (specifier: string): unknown => specifier === 'diagnostics-test-double' ? {
			openGalleryDiagnostics: (_app: unknown, _version: string, onClosed: (modal: object) => void) => {
				const modal = { closed: 0, close(): void { this.closed += 1; onClosed(this); } };
				diagnostics.push(modal);
				return modal;
			},
		} : specifier === 'obsidian' ? {
			Plugin: HostPlugin,
			PluginSettingTab: class {},
			ItemView: class {},
			Modal: class {},
			MarkdownView: class {},
			TFile: class {},
			Platform: { isMobile: options.isMobile ?? true },
			Notice: class { constructor(message: string) { notices.push(message); } },
		} : nodeRequire(specifier) as unknown,
	});
	const Plugin = (module.exports as { default: new () => TestPlugin }).default;
	return {
		plugin: new Plugin(), calls, layoutCallbacks, timers, commands, ribbonCallbacks, notices, diagnostics,
		makeExistingView: () => {
			leaf.view = viewFactory(leaf);
			instrumentView();
			hasLeaf = true;
		},
	};
}

void test('disabling while settings load prevents late registration', async () => {
	const data = deferred<null>();
	const h = await harness({ data: data.promise });
	const loading = h.plugin.onload();
	h.plugin.onunload();
	data.resolve(null);
	await loading;
	assert.equal(h.calls.registeredViews, 0);
	assert.equal(h.layoutCallbacks.length, 0);
});

void test('layout-ready callback cannot restart refresh work after unload', async () => {
	const h = await harness();
	await h.plugin.onload();
	h.plugin.onunload();
	h.layoutCallbacks[0]!();
	assert.equal(h.plugin.isLayoutReady, false);
	assert.equal(h.timers.size, 0);
});

void test('normal layout-ready refresh is scheduled and cancelled on unload', async () => {
	const h = await harness();
	await h.plugin.onload();
	h.makeExistingView();
	h.layoutCallbacks[0]!();
	assert.equal(h.plugin.isLayoutReady, true);
	assert.equal(h.timers.size, 1);
	h.plugin.onunload();
	assert.equal(h.timers.size, 0);
});

void test('a pending leaf creation does not reveal the old gallery after unload', async () => {
	const opening = deferred<void>();
	const h = await harness({ setViewState: opening.promise });
	await h.plugin.onload();
	const activating = h.plugin.activateGallery();
	h.plugin.onunload();
	opening.resolve();
	assert.equal(await activating, null);
	assert.equal(h.calls.reveal, 0);
	assert.equal(h.calls.visible, 0);
});

void test('leaf cancellation during unload does not reject a pending activation', async () => {
	const opening = deferred<void>();
	const h = await harness({ setViewState: opening.promise });
	await h.plugin.onload();
	const activating = h.plugin.activateGallery();
	h.plugin.onunload();
	opening.reject(new Error('View type was unregistered'));
	assert.equal(await activating, null);
});

void test('a pending sidebar reveal does not refresh or focus a disabled gallery', async () => {
	const reveal = deferred<void>();
	const h = await harness({ revealLeaf: reveal.promise });
	await h.plugin.onload();
	h.makeExistingView();
	const focusing = h.plugin.focusGallery();
	assert.equal(h.calls.reveal, 1);
	h.plugin.onunload();
	reveal.resolve();
	await focusing;
	assert.equal(h.calls.refresh, 0);
	assert.equal(h.calls.visible, 0);
	assert.equal(h.calls.focus, 0);
});

void test('tile scale loads with the saved layout and applies live to existing views', async () => {
	const h = await harness({ data: Promise.resolve({ layoutMode: 'aspect', tileScale: 140, custom: true }) });
	await h.plugin.onload();
	h.makeExistingView();
	assert.equal(h.calls.registeredSettings, 1);
	assert.equal(h.plugin.getLayoutMode(), 'aspect');
	assert.equal(h.plugin.getTileScale(), 140);
	await h.plugin.setTileScale(123);
	assert.equal(h.plugin.getTileScale(), 123);
	assert.deepEqual(h.calls.scales, [123]);
	assert.deepEqual(h.calls.saved, [{ layoutMode: 'aspect', tileScale: 123, showSections: true, custom: true, version: 1 }]);
	await h.plugin.setLayoutMode('square');
	assert.deepEqual(h.calls.layouts, ['square']);
	assert.deepEqual(h.calls.saved.at(-1), { layoutMode: 'square', tileScale: 123, showSections: true, custom: true, version: 1 });
});

void test('saved tile numbers remain stable on desktop and mobile without measuring a gallery pane', async () => {
	for (const isMobile of [false, true]) {
		const h = await harness({ isMobile, data: Promise.resolve({ tileScale: 380 }) });
		await h.plugin.onload();
		assert.equal(h.plugin.getTileScale(), 380);
		const before = tileScaleToLevel(h.plugin.getTileScale());
		h.makeExistingView();
		assert.equal(tileScaleToLevel(h.plugin.getTileScale()), before);
		assert.deepEqual(h.calls.saved, []);
	}
});

void test('section visibility loads and applies live without altering layout or tile scale', async () => {
	const h = await harness({ data: Promise.resolve({ layoutMode: 'aspect', tileScale: 30, showSections: false }) });
	await h.plugin.onload();
	h.makeExistingView();
	assert.equal(h.plugin.getShowSections(), false);
	assert.equal(h.plugin.getTileScale(), 30);
	await h.plugin.setShowSections(true);
	assert.equal(h.plugin.getShowSections(), true);
	assert.deepEqual(h.calls.sectionVisibility, [true]);
	assert.deepEqual(h.calls.saved.at(-1), { layoutMode: 'aspect', tileScale: 30, showSections: true, version: 1 });
	assert.deepEqual(h.calls.scales, []);
	assert.deepEqual(h.calls.layouts, []);
});

void test('the fixed largest tile size persists across plugin restart and resets without changing other settings', async () => {
	const h = await harness({
		isMobile: false,
		data: Promise.resolve({ layoutMode: 'aspect', tileScale: 380, showSections: false, custom: true }),
	});
	await h.plugin.onload();
	h.makeExistingView();
	const largest = TILE_SCALE_PRESETS.at(-1)!;
	assert.equal(largest, 2000);
	assert.equal(h.plugin.getTileScale(), 380, 'Opening the plugin must not rewrite a legacy scale');
	assert.deepEqual(h.calls.saved, []);
	await h.plugin.setTileScale(largest);
	assert.equal(h.plugin.getTileScale(), largest);
	assert.deepEqual(h.calls.scales, [largest]);
	assert.deepEqual(h.calls.saved.at(-1), {
		layoutMode: 'aspect', tileScale: largest, showSections: false, custom: true, version: 1,
	});
	h.plugin.onunload();
	const restarted = await harness({
		isMobile: false,
		data: Promise.resolve(JSON.parse(JSON.stringify(h.calls.saved.at(-1)))),
	});
	await restarted.plugin.onload();
	restarted.makeExistingView();
	assert.equal(restarted.plugin.getTileScale(), largest);
	assert.equal(tileScaleToLevel(restarted.plugin.getTileScale()), 20);
	assert.deepEqual(restarted.calls.saved, []);
	await restarted.plugin.setTileScale(100);
	assert.equal(restarted.plugin.getTileScale(), 100);
	assert.deepEqual(restarted.calls.saved.at(-1), {
		layoutMode: 'aspect', tileScale: 100, showSections: false, custom: true, version: 1,
	});
});

void test('concurrent scale, layout and section updates serialize persistence without stale overwrites', async () => {
	const firstSave = deferred<void>();
	let writes = 0;
	const h = await harness({ saveData: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
	await h.plugin.onload();
	const scaleChange = h.plugin.setTileScale(150);
	const layoutChange = h.plugin.setLayoutMode('aspect');
	const newerScaleChange = h.plugin.setTileScale(180);
	const sectionChange = h.plugin.setShowSections(false);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(h.calls.saved.length, 1, 'only one write may be active');
	firstSave.resolve();
	await Promise.all([scaleChange, layoutChange, newerScaleChange, sectionChange]);
	assert.deepEqual(h.calls.saved, [
		{ layoutMode: 'square', tileScale: 150, showSections: true, version: 1 },
		{ layoutMode: 'aspect', tileScale: 150, showSections: true, version: 1 },
		{ layoutMode: 'aspect', tileScale: 180, showSections: true, version: 1 },
		{ layoutMode: 'aspect', tileScale: 180, showSections: false, version: 1 },
	]);
});

void test('failed section visibility writes can be retried without reverting the live selection', async () => {
	let writes = 0;
	const h = await harness({ saveData: () => ++writes === 1 ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve() });
	await h.plugin.onload();
	await assert.rejects(h.plugin.setShowSections(false), /Storage unavailable/);
	assert.equal(h.plugin.getShowSections(), false);
	await h.plugin.setShowSections(false);
	assert.equal(h.calls.saved.length, 2);
	assert.equal(h.calls.saved.at(-1)?.showSections, false);
});

void test('failed settings write can be retried with the same selection', async () => {
	let writes = 0;
	const h = await harness({ saveData: () => ++writes === 1 ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve() });
	await h.plugin.onload();
	await assert.rejects(h.plugin.setTileScale(130), /Storage unavailable/);
	await h.plugin.setTileScale(130);
	assert.equal(h.calls.saved.length, 2);
	assert.equal(h.calls.saved.at(-1)?.tileScale, 130);
});

void test('disabled plugin does not accept or persist new settings changes', async () => {
	const h = await harness();
	await h.plugin.onload();
	h.plugin.onunload();
	await h.plugin.setTileScale(180);
	await h.plugin.setLayoutMode('aspect');
	await h.plugin.setShowSections(false);
	assert.equal(h.plugin.getTileScale(), 100);
	assert.equal(h.plugin.getLayoutMode(), 'square');
	assert.equal(h.plugin.getShowSections(), true);
	assert.equal(h.calls.saved.length, 0);
});

void test('mobile exposes gallery commands without a diagnostic command', async () => {
	const h = await harness({ isMobile: true });
	await h.plugin.onload();
	assert.deepEqual([...h.commands.keys()], ['open-media', 'focus-media']);
	assert.equal(h.diagnostics.length, 0);
});

void test('desktop retains the optional diagnostic command and closes its report on unload', async () => {
	const h = await harness({ isMobile: false });
	await h.plugin.onload();
	assert.deepEqual([...h.commands.keys()], ['open-media', 'focus-media', 'show-mobile-diagnostics']);
	h.commands.get('show-mobile-diagnostics')!();
	assert.equal(h.diagnostics.length, 1);
	h.plugin.onunload();
	assert.equal(h.diagnostics[0]!.closed, 1);
});

void test('diagnostics are tracked until closed and remaining reports close on plugin unload', async () => {
	const h = await harness();
	await h.plugin.onload();
	h.plugin.showDiagnostics();
	h.plugin.showDiagnostics();
	assert.equal(h.diagnostics.length, 2);
	h.diagnostics[0]!.close();
	h.plugin.onunload();
	assert.deepEqual(h.diagnostics.map(modal => modal.closed), [1, 1], 'already closed reports must not remain retained');
	h.plugin.showDiagnostics();
	assert.equal(h.diagnostics.length, 2, 'a disabled plugin must not create another report');
});

void test('ribbon and gallery commands report rejected opens and focus instead of unhandled promises', async () => {
	for (const action of ['ribbon', 'open-media', 'focus-media']) {
		const opening = deferred<void>();
		const h = await harness({ setViewState: opening.promise });
		await h.plugin.onload();
		if (action === 'ribbon') h.ribbonCallbacks[0]!();
		else h.commands.get(action)!();
		opening.reject(new Error('Workspace unavailable'));
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(h.notices.length, 1);
		assert.match(h.notices[0]!, action === 'focus-media' ? /Could not focus/ : /Could not open/);
	}
});

void test('command rejection after unload does not show a stale error notice', async () => {
	const opening = deferred<void>();
	const h = await harness({ setViewState: opening.promise });
	await h.plugin.onload();
	h.commands.get('open-media')!();
	h.plugin.onunload();
	opening.reject(new Error('View unregistered'));
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(h.notices.length, 0);
});
