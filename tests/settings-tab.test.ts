import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

void test('public settings expose only tile scale, without a diagnostics row', async () => {
	const result = await build({
		entryPoints: ['src/settings-tab.ts'], bundle: true, external: ['obsidian'],
		format: 'cjs', platform: 'node', write: false,
	});
	const module = { exports: {} };
	runInNewContext(result.outputFiles[0]!.text, {
		module,
		require: () => ({ PluginSettingTab: class {} }),
	});
	const Constructor = (module.exports as {
		GallerySettingsTab: new (app: object, plugin: object, host: object) => {
			getSettingDefinitions(): { name: string }[];
		};
	}).GallerySettingsTab;
	const tab = new Constructor({}, {}, { getTileScale: () => 100, setTileScale: () => Promise.resolve() });
	const definitions = tab.getSettingDefinitions();
	assert.equal(definitions.length, 1);
	assert.equal(definitions[0]?.name, 'Tile scale');
});
