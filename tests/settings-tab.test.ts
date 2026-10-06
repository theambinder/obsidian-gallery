import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

interface SettingsHost {
	getTileScale(): number;
	setTileScale(value: number): Promise<void>;
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

async function harness(options: { fail?: boolean; scale?: number; showSections?: boolean } = {}) {
	const module = { exports: {} };
	const notices: string[] = [];
	const scales: number[] = [];
	const sectionVisibility: boolean[] = [];
	let scale = options.scale ?? 100;
	let showSections = options.showSections ?? true;
	const host: SettingsHost = {
		getTileScale: () => scale,
		setTileScale: (value) => {
			scales.push(value);
			scale = value;
			return options.fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
		},
		getShowSections: () => showSections,
		setShowSections: (value) => {
			sectionVisibility.push(value);
			showSections = value;
			return options.fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
		},
	};
	runInNewContext(await settingsBundle, {
		module,
		require: () => ({
			PluginSettingTab: class { updates = 0; update(): void { this.updates += 1; } },
			Notice: class { constructor(message: string) { notices.push(message); } },
		}),
	});
	const Constructor = (module.exports as {
		GallerySettingsTab: new (app: object, plugin: object, host: SettingsHost) => TestTab;
	}).GallerySettingsTab;
	return { tab: new Constructor({}, {}, host), notices, scales, sectionVisibility };
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
	return { classes, limits, value, instant, format, change, reset, icon, tooltip };
}

void test('public settings expose tile scale and native section visibility, without a diagnostics row', async () => {
	const { tab } = await harness();
	const definitions = tab.getSettingDefinitions();
	assert.equal(definitions.length, 2);
	assert.equal(definitions[0]?.name, 'Tile scale');
	assert.equal(definitions[1]?.name, 'Show sections');
	assert.deepEqual(JSON.parse(JSON.stringify(definitions[1]?.control)), {
		type: 'toggle', key: 'showSections', defaultValue: true,
	});
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

void test('tile slider uses the expanded range and a scoped native setting class while retaining live updates and reset', async () => {
	const { tab, scales } = await harness({ scale: 30 });
	const slider = renderSlider(tab.getSettingDefinitions()[0]!);
	assert.deepEqual(slider.classes, ['section-gallery-tile-scale-setting']);
	assert.deepEqual(slider.limits, [30, 180, 10]);
	assert.equal(slider.value, 30);
	assert.equal(slider.instant, true);
	assert.equal(slider.format(30), '30%');
	assert.equal(slider.format(100), '100%');
	assert.equal(slider.format(180), '180%');
	assert.equal(slider.icon, 'rotate-ccw');
	assert.equal(slider.tooltip, 'Reset tile scale');
	slider.change(110);
	slider.reset();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(scales, [110, 100]);
	assert.equal(tab.updates, 1);
});

void test('failed tile saves show notices and a failed reset does not refresh the native settings row', async () => {
	const { tab, notices } = await harness({ fail: true });
	const slider = renderSlider(tab.getSettingDefinitions()[0]!);
	slider.change(90);
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
