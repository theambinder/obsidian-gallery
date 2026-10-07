import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TILE_SCALE, normalizeGallerySettings } from '../src/settings';
import { MIN_TILE_SIZE_LEVEL, MAX_TILE_SIZE_LEVEL, TILE_SCALE_PRESETS, tileLevelToScale, tileScaleToLevel } from '../src/gallery-tile-size';

void test('tile size levels have a fixed consecutive range independent of pane geometry', () => {
	assert.equal(MIN_TILE_SIZE_LEVEL, 1);
	assert.equal(MAX_TILE_SIZE_LEVEL, 20);
	assert.equal(TILE_SCALE_PRESETS.length, 20);
	assert.ok(Object.isFrozen(TILE_SCALE_PRESETS));
	for (let level = 1; level <= MAX_TILE_SIZE_LEVEL; level += 1) {
		const scale = tileLevelToScale(level);
		assert.equal(tileScaleToLevel(scale), level);
		assert.equal(scale, TILE_SCALE_PRESETS[level - 1]);
		if (level > 1) assert.ok(scale > tileLevelToScale(level - 1));
	}
});

void test('the default size and endpoints remain fixed with extra large presets', () => {
	assert.equal(tileLevelToScale(1), 10);
	assert.equal(tileScaleToLevel(DEFAULT_TILE_SCALE), 8);
	assert.equal(tileLevelToScale(8), 100);
	assert.equal(tileLevelToScale(16), 500);
	assert.equal(tileLevelToScale(20), 2000);
});

void test('a fixed level retains its percentage while the original responsive grid changes columns', () => {
	for (let level = 1; level <= MAX_TILE_SIZE_LEVEL; level += 1) {
		const fixedScale = tileLevelToScale(level);
		for (const width of [40, 191, 261, 344, 1051, 1111, 2000, 4000]) {
			const nominalMinimum = Math.min(56 * fixedScale / 100, width);
			const columns = Math.max(1, Math.floor((width + 2) / (nominalMinimum + 2)));
			const tileWidth = (width - (columns - 1) * 2) / columns;
			assert.ok(tileWidth <= width);
			assert.ok(Math.abs(tileWidth * columns + (columns - 1) * 2 - width) < 1e-9);
			assert.equal(tileLevelToScale(level), fixedScale);
			assert.equal(tileScaleToLevel(fixedScale), level);
		}
	}
});

void test('old saved percentages only get a stable display label and are not quantized to a preset', () => {
	for (const savedScale of [30, 100, 140, 144, 180, 380, 500, 1150, 1880, 10000]) {
		const saved = { tileScale: savedScale, custom: true };
		const settings = normalizeGallerySettings(saved);
		const label = tileScaleToLevel(settings.tileScale);
		for (let pass = 0; pass < 4; pass += 1) assert.equal(tileScaleToLevel(settings.tileScale), label);
		assert.equal(settings.tileScale, savedScale);
		assert.equal(saved.tileScale, savedScale);
		assert.equal(settings.custom, true);
	}
	assert.equal(tileScaleToLevel(380), 15);
	assert.equal(tileScaleToLevel(1150), 19);
});

void test('invalid levels and persisted scales keep safe fixed fallbacks', () => {
	assert.equal(tileLevelToScale(-10), 10);
	assert.equal(tileLevelToScale(1000), 2000);
	assert.equal(tileLevelToScale(1.4), 10);
	assert.equal(tileLevelToScale(1.6), 20);
	for (const value of [NaN, Infinity, -Infinity]) {
		assert.equal(tileLevelToScale(value), 100);
		assert.equal(tileScaleToLevel(value), 8);
	}
});
