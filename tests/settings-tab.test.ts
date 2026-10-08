import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { TILE_SCALE_PRESETS, tileLevelToScale, tileScaleToLevel } from '../src/gallery-tile-size';

interface SettingsHost {
	getTileScale(): number;
	setTileScale(value: number): Promise<void>;
	getSeparateMobileTileScale(): boolean;
	setSeparateMobileTileScale(value: boolean): Promise<void>;
	getMobileTileScale(): number;
	setMobileTileScale(value: number): Promise<void>;
	getShowSections(): boolean;
	setShowSections(value: boolean): Promise<void>;
}

interface TestSlider {
	setLimits(min: number, max: number, step: number): TestSlider;
	setValue(value: number): TestSlider;
	setDisplayFormat(format: (value: number) => string): TestSlider;
	setInstant(value: boolean): TestSlider;
	onChange(callback: (value: number) => void): TestSlider;
}

interface TestButton {
	setIcon(icon: string): TestButton;
	setTooltip(tooltip: string): TestButton;
	onClick(callback: () => void): TestButton;
}

interface TestSetting {
	setClass(value: string): TestSetting;
	addSlider(callback: (slider: TestSlider) => void): TestSetting;
	addExtraButton(callback: (button: TestButton) => void): TestSetting;
}

interface TestDefinition {
	name: string;
	desc?: string;
	control?: { type: string; key: string; defaultValue: boolean };
	visible?: () => boolean;
	render?: (setting: TestSetting) => void;
}

interface TestTab {
	getSettingDefinitions(): TestDefinition[];
	getControlValue(key: string): unknown;
	setControlValue(key: string, value: unknown): Promise<void>;
	updates: number;
}

const settingsBundle = build({
		entryPoints: ['src/settings-tab.ts'], bundle: true, external: ['obsidian'],
		format: 'cjs', platform: 'node', write: false,
	}).then(result => result.outputFiles[0]!.text);

async function harness(options: { fail?: boolean; scale?: number; showSections?: boolean; separateMobile?: boolean; mobileScale?: number } = {}) {
	const module = { exports: {} };
	const notices: string[] = [];
	const scales: number[] = [];
	const mobileScales: number[] = [];
	const separateMobileChanges: boolean[] = [];
	const sectionVisibility: boolean[] = [];
	let scale = options.scale ?? 100;
	let showSections = options.showSections ?? true;
	let separateMobile = options.separateMobile ?? false;
	let mobileScale = options.mobileScale ?? null;
	const host: SettingsHost = {
		getTileScale: () => scale,
		setTileScale: (value) => {
			scales.push(value);
			scale = value;
			return options.fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
		},
		getShowSections: () => showSections,
		getSeparateMobileTileScale: () => separateMobile,
		setSeparateMobileTileScale: (value) => {
			separateMobileChanges.push(value);
			if (value && mobileScale === null) mobileScale = scale;
			separateMobile = value;
			return options.fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
		},
		getMobileTileScale: () => mobileScale ?? scale,
		setMobileTileScale: (value) => {
			mobileScales.push(value);
			mobileScale = value;
			return options.fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
		},
		setShowSections: (value) => {
			sectionVisibility.push(value);
			showSections = value;
			return options.fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
		},
	};
	runInNewContext(await settingsBundle, {
		module,
		require: () => ({
			PluginSettingTab: class { updates = 0; update(): void { this.updates += 1; } hide(): void {} },
			Notice: class { constructor(message: string) { notices.push(message); } },
		}),
	});
	const Constructor = (module.exports as {
		GallerySettingsTab: new (app: object, plugin: object, host: SettingsHost) => TestTab;
	}).GallerySettingsTab;
	return {
		tab: new Constructor({}, {}, host), notices, scales, mobileScales, separateMobileChanges, sectionVisibility,
		getScale: () => scale,
		getMobileScale: () => mobileScale,
	};
}

function renderSlider(definition: TestDefinition) {
	const classes: string[] = [];
	let limits: number[] = [];
	let value: number | undefined;
	let instant = false;
	let format: (value: number) => string = String;
	let change!: (value: number) => void;
	let reset!: () => void;
	let icon = '';
	let tooltip = '';
	const slider: TestSlider = {
		setLimits: (min, max, step) => { limits = [min, max, step]; return slider; },
		setValue: (next) => { value = next; return slider; },
		setDisplayFormat: (next) => { format = next; return slider; },
		setInstant: (next) => { instant = next; return slider; },
		onChange: (next) => { change = next; return slider; },
	};
	const button: TestButton = {
		setIcon: (next) => { icon = next; return button; },
		setTooltip: (next) => { tooltip = next; return button; },
		onClick: (next) => { reset = next; return button; },
	};
	const setting: TestSetting = {
		setClass: (next) => { classes.push(next); return setting; },
		addSlider: (callback) => { callback(slider); return setting; },
		addExtraButton: (callback) => { callback(button); return setting; },
	};
	assert.ok(definition.render);
	definition.render(setting);
	return { classes, limits, value, instant, format, change, reset, icon, tooltip, getValue: () => value, getLimits: () => limits };
}

void test('public settings expose tile scale and native section visibility, without a diagnostics row', async () => {
	const { tab } = await harness();
	const definitions = tab.getSettingDefinitions();
	assert.equal(definitions.length, 4);
	assert.equal(definitions[0]?.name, 'Tile scale');
	assert.equal(definitions[1]?.name, 'Use separate mobile tile scale');
	assert.deepEqual(JSON.parse(JSON.stringify(definitions[1]?.control)), {
		type: 'toggle', key: 'separateMobileTileScale', defaultValue: false,
	});
	assert.equal(definitions[2]?.name, 'Mobile tile scale');
	assert.equal(definitions[2]?.visible?.(), false);
	assert.equal(definitions[3]?.name, 'Show sections');
	assert.deepEqual(JSON.parse(JSON.stringify(definitions[3]?.control)), {
		type: 'toggle', key: 'showSections', defaultValue: true,
	});
});

void test('native separate-mobile toggle reveals an inherited second slider and keeps its value across disable and reenable', async () => {
	const h = await harness({ scale: 380 });
	assert.equal(h.tab.getControlValue('separateMobileTileScale'), false);
	await h.tab.setControlValue('separateMobileTileScale', 'true');
	assert.deepEqual(h.separateMobileChanges, []);
	await h.tab.setControlValue('separateMobileTileScale', true);
	assert.equal(h.getMobileScale(), 380);
	assert.equal(h.tab.updates, 1);
	let definitions = h.tab.getSettingDefinitions();
	assert.equal(definitions[0]?.name, 'Desktop tile scale');
	assert.equal(definitions[2]?.visible?.(), true);
	const mobileSlider = renderSlider(definitions[2]);
	assert.deepEqual(mobileSlider.limits, [1, 20, 1]);
	assert.equal(mobileSlider.value, tileScaleToLevel(380));
	assert.equal(mobileSlider.tooltip, 'Reset mobile tile scale');
	mobileSlider.change(3);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(h.mobileScales, [30]);
	assert.equal(h.getScale(), 380);
	await h.tab.setControlValue('separateMobileTileScale', false);
	definitions = h.tab.getSettingDefinitions();
	assert.equal(definitions[0]?.name, 'Tile scale');
	assert.equal(definitions[2]?.visible?.(), false);
	assert.equal(h.getMobileScale(), 30);
	await h.tab.setControlValue('separateMobileTileScale', true);
	assert.equal(h.getMobileScale(), 30);
	assert.equal(renderSlider(h.tab.getSettingDefinitions()[2]!).value, 3);
});

void test('desktop and mobile slider reset are independent and both restore fixed default level eight', async () => {
	const h = await harness({ scale: 380, separateMobile: true, mobileScale: 1150 });
	const definitions = h.tab.getSettingDefinitions();
	renderSlider(definitions[2]!).reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(h.getMobileScale(), 100);
	assert.equal(h.getScale(), 380);
	assert.deepEqual(h.mobileScales, [100]);
	assert.deepEqual(h.scales, []);
	renderSlider(definitions[0]!).reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(h.getScale(), 100);
	assert.equal(h.getMobileScale(), 100);
	assert.deepEqual(h.scales, [100]);
	assert.equal(h.tab.updates, 2);
});

void test('mobile slider reports storage failures and failed native toggles do not rebuild settings', async () => {
	const h = await harness({ fail: true, separateMobile: true });
	const mobileSlider = renderSlider(h.tab.getSettingDefinitions()[2]!);
	mobileSlider.change(9);
	mobileSlider.reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(h.notices.length, 2);
	assert.equal(h.tab.updates, 0);
	await assert.rejects(h.tab.setControlValue('separateMobileTileScale', false), /Storage unavailable/);
	assert.equal(h.tab.updates, 0);
});

void test('native section toggle reads saved visibility and routes only boolean changes to the settings host', async () => {
	const { tab, sectionVisibility } = await harness({ showSections: false });
	assert.equal(tab.getControlValue('showSections'), false);
	assert.equal(tab.getControlValue('unknown'), undefined);
	await tab.setControlValue('showSections', true);
	assert.equal(tab.getControlValue('showSections'), true);
	await tab.setControlValue('showSections', 'false');
	await tab.setControlValue('unknown', false);
	assert.deepEqual(sectionVisibility, [true]);
});

void test('tile slider shows twenty fixed numeric sizes with percentage persistence, live updates and reset', async () => {
	const { tab, scales } = await harness({ scale: 30 });
	const slider = renderSlider(tab.getSettingDefinitions()[0]!);
	assert.deepEqual(slider.classes, ['section-gallery-tile-scale-setting']);
	assert.deepEqual(slider.limits, [1, 20, 1]);
	assert.equal(slider.value, 3);
	assert.equal(slider.instant, true);
	assert.equal(slider.format(1), '1');
	assert.equal(slider.format(9), '9');
	assert.equal(slider.format(10), '10');
	assert.equal(slider.format(20), '20');
	assert.equal(slider.icon, 'rotate-ccw');
	assert.equal(slider.tooltip, 'Reset tile scale');
	slider.change(20);
	slider.reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(scales, [2000, 100]);
	assert.equal(tab.updates, 1);
});

void test('fixed tile levels preserve legacy scales and restore the same numeric level when reopened', async () => {
	const h = await harness({ scale: 380 });
	const slider = renderSlider(h.tab.getSettingDefinitions()[0]!);
	assert.equal(slider.value, tileScaleToLevel(380));
	assert.equal(h.getScale(), 380);
	assert.deepEqual(h.scales, [], 'Opening settings must preserve a legacy saved percentage');
	slider.change(20);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(h.scales, [2000]);
	const reopened = await harness({ scale: h.scales[0] });
	const restoredSlider = renderSlider(reopened.tab.getSettingDefinitions()[0]!);
	assert.equal(restoredSlider.value, 20);
	assert.deepEqual(reopened.scales, [], 'Displaying a saved larger size must not rewrite it');
	restoredSlider.reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(reopened.scales, [100]);
});

void test('each fixed number stores its own increasing scale without requiring any pane geometry', async () => {
	const { tab, scales } = await harness({ scale: 100 });
	const slider = renderSlider(tab.getSettingDefinitions()[0]!);
	assert.equal(slider.value, 8);
	assert.deepEqual(scales, [], 'Opening settings must not change a saved scale');
	for (let level = 1; level <= 20; level += 1) {
		slider.change(level);
	}
	assert.deepEqual(scales, [...TILE_SCALE_PRESETS]);
	assert.equal(new Set(scales).size, 20);
	assert.equal(scales.at(-1), 2000);
	for (let index = 1; index < scales.length; index += 1) {
		assert.ok(scales[index]! > scales[index - 1]!);
	}
});

void test('opening fixed size settings does not rewrite nonpreset or previously larger preview values', async () => {
	for (const scale of [123, 380, 1990, 50000]) {
		const h = await harness({ scale });
		const slider = renderSlider(h.tab.getSettingDefinitions()[0]!);
		assert.equal(slider.getValue(), tileScaleToLevel(scale));
		assert.deepEqual(slider.getLimits(), [1, 20, 1]);
		assert.equal(h.getScale(), scale);
		assert.deepEqual(h.scales, []);
		assert.equal(h.tab.updates, 0);
	}
});

void test('reset always restores the fixed default level rather than a pane-dependent density', async () => {
	const h = await harness({ scale: 50000 });
	const slider = renderSlider(h.tab.getSettingDefinitions()[0]!);
	slider.reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(h.getScale(), 100);
	assert.equal(tileScaleToLevel(h.getScale()), 8);
	assert.equal(tileLevelToScale(8), 100);
	assert.deepEqual(h.scales, [100]);
});

void test('failed tile saves show notices and a failed reset does not refresh the native settings row', async () => {
	const { tab, notices } = await harness({ fail: true });
	const slider = renderSlider(tab.getSettingDefinitions()[0]!);
	slider.change(9);
	slider.reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(notices.length, 2);
	assert.ok(notices.every(message => message.includes('Could not save the tile scale')));
	assert.equal(tab.updates, 0);
});

void test('native section saves preserve rejection so the native settings framework can report the failure', async () => {
	const { tab } = await harness({ fail: true });
	await assert.rejects(tab.setControlValue('showSections', false), /Storage unavailable/);
});
