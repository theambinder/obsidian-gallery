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
	getEffectiveTileScale(): number;
	getMobileTileScale(): number;
	getSeparateMobileTileScale(): boolean;
	getLayoutMode(): string;
	getShowSections(): boolean;
	setTileScale(value: number): Promise<void>;
	setMobileTileScale(value: number): Promise<void>;
	setSeparateMobileTileScale(value: boolean): Promise<void>;
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
	isAndroid?: boolean;
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
			Platform: { isMobile: options.isMobile ?? true, isAndroidApp: options.isAndroid ?? false, isIosApp: (options.isMobile ?? true) && !options.isAndroid },
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
	assert.deepEqual(h.calls.saved, [{ layoutMode: 'aspect', tileScale: 123, separateMobileTileScale: false, mobileTileScale: null, showSections: true, custom: true, version: 1 }]);
	await h.plugin.setLayoutMode('square');
	assert.deepEqual(h.calls.layouts, ['square']);
	assert.deepEqual(h.calls.saved.at(-1), { layoutMode: 'square', tileScale: 123, separateMobileTileScale: false, mobileTileScale: null, showSections: true, custom: true, version: 1 });
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

const scalePlatforms = [
	{ name: 'desktop', isMobile: false, isAndroid: false },
	{ name: 'iOS', isMobile: true, isAndroid: false },
	{ name: 'Android', isMobile: true, isAndroid: true },
];

for (const platform of scalePlatforms) {
	void test(`${platform.name} shares the legacy scale by default and initializes a separate mobile scale without a size jump`, async () => {
		const h = await harness({ ...platform, data: Promise.resolve({ tileScale: 380, custom: true }) });
		await h.plugin.onload();
		h.makeExistingView();
		assert.equal(h.plugin.getSeparateMobileTileScale(), false);
		assert.equal(h.plugin.getEffectiveTileScale(), 380);
		assert.equal(h.plugin.getMobileTileScale(), 380);
		assert.equal(h.calls.saved.length, 0, 'Opening legacy settings must not migrate the saved file');
		await h.plugin.setTileScale(123);
		assert.equal(h.plugin.getEffectiveTileScale(), 123);
		await h.plugin.setSeparateMobileTileScale(true);
		assert.equal(h.plugin.getMobileTileScale(), 123, 'First enable inherits the current shared size, not a default');
		assert.equal(h.plugin.getEffectiveTileScale(), 123);
		assert.deepEqual(h.calls.scales, [123], 'Enabling the identical inherited size does not change the view or rebuild previews');
		assert.equal(h.calls.refresh, 0);
		assert.equal(h.calls.saved.at(-1)?.mobileTileScale, 123);
		assert.equal(h.calls.saved.at(-1)?.custom, true);
	});

	void test(`${platform.name} applies only its own tile size while keeping both choices across disable, reenable and restart`, async () => {
		const h = await harness({
			...platform,
			data: Promise.resolve({ tileScale: 380, mobileTileScale: 1150, separateMobileTileScale: true, layoutMode: 'aspect', showSections: false }),
		});
		await h.plugin.onload();
		h.makeExistingView();
		assert.equal(h.plugin.getTileScale(), 380);
		assert.equal(h.plugin.getMobileTileScale(), 1150);
		assert.equal(h.plugin.getEffectiveTileScale(), platform.isMobile ? 1150 : 380);
		assert.deepEqual(h.calls.saved, []);
		await h.plugin.setTileScale(150);
		assert.equal(h.plugin.getEffectiveTileScale(), platform.isMobile ? 1150 : 150);
		assert.deepEqual(h.calls.scales, platform.isMobile ? [] : [150]);
		await h.plugin.setMobileTileScale(220);
		assert.equal(h.plugin.getEffectiveTileScale(), platform.isMobile ? 220 : 150);
		assert.deepEqual(h.calls.scales, platform.isMobile ? [220] : [150]);
		await h.plugin.setSeparateMobileTileScale(false);
		assert.equal(h.plugin.getEffectiveTileScale(), 150);
		assert.equal(h.plugin.getMobileTileScale(), 220);
		await h.plugin.setTileScale(180);
		assert.equal(h.plugin.getEffectiveTileScale(), 180);
		assert.equal(h.plugin.getMobileTileScale(), 220, 'Shared changes while disabled preserve the saved override');
		await h.plugin.setSeparateMobileTileScale(true);
		assert.equal(h.plugin.getEffectiveTileScale(), platform.isMobile ? 220 : 180);
		assert.deepEqual(h.calls.scales, platform.isMobile ? [220, 150, 180, 220] : [150, 180]);
		assert.equal(h.calls.refresh, 0, 'Changing platform sizes must not rebuild or reset gallery previews');
		h.plugin.onunload();
		const restarted = await harness({ ...platform, data: Promise.resolve(JSON.parse(JSON.stringify(h.calls.saved.at(-1)))) });
		await restarted.plugin.onload();
		assert.equal(restarted.plugin.getTileScale(), 180);
		assert.equal(restarted.plugin.getMobileTileScale(), 220);
		assert.equal(restarted.plugin.getSeparateMobileTileScale(), true);
		assert.equal(restarted.plugin.getEffectiveTileScale(), platform.isMobile ? 220 : 180);
		assert.equal(restarted.plugin.getLayoutMode(), 'aspect');
		assert.equal(restarted.plugin.getShowSections(), false);
		assert.deepEqual(restarted.calls.saved, []);
	});
}

void test('a malformed mobile override falls back to the legacy shared percentage until first explicit enable', async () => {
	const h = await harness({ isMobile: true, data: Promise.resolve({ tileScale: 380, separateMobileTileScale: true, mobileTileScale: '120' }) });
	await h.plugin.onload();
	assert.equal(h.plugin.getEffectiveTileScale(), 380);
	assert.equal(h.calls.saved.length, 0);
	await h.plugin.setSeparateMobileTileScale(true);
	assert.equal(h.plugin.getMobileTileScale(), 380);
	assert.equal(h.calls.saved.at(-1)?.mobileTileScale, 380);
});

void test('mobile and shared settings use the serial writer so rapid changes cannot overwrite the latest two sizes', async () => {
	const firstSave = deferred<void>();
	let writes = 0;
	const h = await harness({
		isMobile: true, data: Promise.resolve({ tileScale: 380, custom: { preserve: true } }),
		saveData: () => ++writes === 1 ? firstSave.promise : Promise.resolve(),
	});
	await h.plugin.onload();
	h.makeExistingView();
	const enabling = h.plugin.setSeparateMobileTileScale(true);
	const mobileChange = h.plugin.setMobileTileScale(30);
	const desktopChange = h.plugin.setTileScale(500);
	const disable = h.plugin.setSeparateMobileTileScale(false);
	const reenable = h.plugin.setSeparateMobileTileScale(true);
	const newerMobileChange = h.plugin.setMobileTileScale(80);
	const layoutChange = h.plugin.setLayoutMode('aspect');
	const sectionChange = h.plugin.setShowSections(false);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(h.calls.saved.length, 1);
	firstSave.resolve();
	await Promise.all([enabling, mobileChange, desktopChange, disable, reenable, newerMobileChange, layoutChange, sectionChange]);
	assert.equal(h.calls.saved.length, 8);
	assert.deepEqual(h.calls.saved.at(-1), {
		tileScale: 500, mobileTileScale: 80, separateMobileTileScale: true,
		layoutMode: 'aspect', showSections: false, custom: { preserve: true }, version: 1,
	});
	assert.deepEqual(h.calls.scales, [30, 500, 30, 80]);
	assert.equal(h.plugin.getEffectiveTileScale(), 80);
});

void test('failed mobile and separate-mode writes can be retried without resetting live or unrelated preferences', async () => {
	let writes = 0;
	const h = await harness({
		isMobile: true, data: Promise.resolve({ tileScale: 380, layoutMode: 'aspect', custom: true }),
		saveData: () => ++writes <= 2 ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve(),
	});
	await h.plugin.onload();
	h.makeExistingView();
	await assert.rejects(h.plugin.setSeparateMobileTileScale(true), /Storage unavailable/);
	assert.equal(h.plugin.getSeparateMobileTileScale(), true);
	assert.equal(h.plugin.getMobileTileScale(), 380);
	await assert.rejects(h.plugin.setMobileTileScale(30), /Storage unavailable/);
	assert.equal(h.plugin.getEffectiveTileScale(), 30);
	await h.plugin.setMobileTileScale(30);
	assert.deepEqual(h.calls.scales, [30], 'Retrying the same value does not restart the live tile layout');
	assert.equal(h.calls.saved.at(-1)?.mobileTileScale, 30);
	assert.equal(h.calls.saved.at(-1)?.tileScale, 380);
	assert.equal(h.calls.saved.at(-1)?.custom, true);
	assert.equal(h.calls.saved.at(-1)?.layoutMode, 'aspect');
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
	assert.deepEqual(h.calls.saved.at(-1), { layoutMode: 'aspect', tileScale: 30, separateMobileTileScale: false, mobileTileScale: null, showSections: true, version: 1 });
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
		layoutMode: 'aspect', tileScale: largest, separateMobileTileScale: false, mobileTileScale: null, showSections: false, custom: true, version: 1,
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
		layoutMode: 'aspect', tileScale: 100, separateMobileTileScale: false, mobileTileScale: null, showSections: false, custom: true, version: 1,
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
		{ layoutMode: 'square', tileScale: 150, separateMobileTileScale: false, mobileTileScale: null, showSections: true, version: 1 },
		{ layoutMode: 'aspect', tileScale: 150, separateMobileTileScale: false, mobileTileScale: null, showSections: true, version: 1 },
		{ layoutMode: 'aspect', tileScale: 180, separateMobileTileScale: false, mobileTileScale: null, showSections: true, version: 1 },
		{ layoutMode: 'aspect', tileScale: 180, separateMobileTileScale: false, mobileTileScale: null, showSections: false, version: 1 },
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
	await h.plugin.setMobileTileScale(180);
	await h.plugin.setSeparateMobileTileScale(true);
	assert.equal(h.plugin.getTileScale(), 100);
	assert.equal(h.plugin.getLayoutMode(), 'square');
	assert.equal(h.plugin.getShowSections(), true);
	assert.equal(h.plugin.getMobileTileScale(), 100);
	assert.equal(h.plugin.getSeparateMobileTileScale(), false);
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
