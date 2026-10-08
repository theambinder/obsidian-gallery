import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_TILE_SCALE,
	normalizeGallerySettings,
	normalizeTileScale,
	MIN_TILE_SCALE,
	MAX_TILE_SCALE,
} from '../src/settings';

void test('tile scale defaults safely for missing and malformed persisted values', () => {
	for (const value of [undefined, null, '140', {}, [], NaN, Infinity, -Infinity]) {
		assert.equal(normalizeTileScale(value), DEFAULT_TILE_SCALE);
	}
});

void test('internal tile percentages clamp without quantizing distinct size levels', () => {
	assert.equal(MIN_TILE_SCALE, 10);
	assert.equal(MAX_TILE_SCALE, 100_000);
	assert.equal(normalizeTileScale(-100), 10);
	assert.equal(normalizeTileScale(0), 10);
	assert.equal(normalizeTileScale(9), 10);
	assert.equal(normalizeTileScale(15), 15);
	assert.equal(normalizeTileScale(20), 20);
	assert.equal(normalizeTileScale(29), 29);
	assert.equal(normalizeTileScale(35), 35);
	assert.equal(normalizeTileScale(59), 59);
	assert.equal(normalizeTileScale(104), 104);
	assert.equal(normalizeTileScale(106), 106);
	assert.equal(normalizeTileScale(179), 179);
	assert.equal(normalizeTileScale(184), 184);
	assert.equal(normalizeTileScale(186), 186);
	assert.equal(normalizeTileScale(186.2345), 186.2345);
	assert.equal(normalizeTileScale(300), 300);
	assert.equal(normalizeTileScale(496), 496);
	assert.equal(normalizeTileScale(500), 500);
	assert.equal(normalizeTileScale(10000), 10000);
	assert.equal(normalizeTileScale(MAX_TILE_SCALE), MAX_TILE_SCALE);
	assert.equal(normalizeTileScale(MAX_TILE_SCALE + 1), MAX_TILE_SCALE);
});

void test('expanded tile-scale range preserves all previously supported saved slider values', () => {
	for (let tileScale = 30; tileScale <= 500; tileScale += 10) {
		assert.equal(normalizeGallerySettings({ tileScale }).tileScale, tileScale);
	}
	for (const tileScale of [10, 20]) {
		assert.equal(normalizeGallerySettings({ tileScale }).tileScale, tileScale);
	}
});

void test('larger internal tile sizes survive settings serialization without changing unrelated preferences', () => {
	for (const tileScale of [1990, 2150, 10000, 50000, MAX_TILE_SCALE]) {
		const saved = {
			layoutMode: 'aspect', tileScale, showSections: false,
			futurePreference: { enabled: true }, version: 1,
		};
		const reloaded = normalizeGallerySettings(JSON.parse(JSON.stringify(normalizeGallerySettings(saved))));
		assert.equal(reloaded.tileScale, tileScale);
		assert.equal(reloaded.layoutMode, 'aspect');
		assert.equal(reloaded.showSections, false);
		assert.deepEqual(reloaded.futurePreference, { enabled: true });
		assert.equal(saved.tileScale, tileScale);
	}
});

void test('legacy settings keep their layout and gain the original tile scale', () => {
	assert.deepEqual(normalizeGallerySettings({ layoutMode: 'aspect', version: 1 }), {
		layoutMode: 'aspect', tileScale: 100, separateMobileTileScale: false,
		mobileTileScale: null, showSections: true, version: 1,
	});
	for (const value of [null, [], undefined, 'invalid', { layoutMode: 'invalid' }]) {
		assert.equal(normalizeGallerySettings(value).layoutMode, 'square');
		assert.equal(normalizeGallerySettings(value).tileScale, 100);
		assert.equal(normalizeGallerySettings(value).showSections, true);
	}
});

void test('separate mobile sizes default off and invalid overrides remain unset without rewriting the shared size', () => {
	for (const value of [null, undefined, [], 'invalid', { tileScale: 380 }]) {
		const settings = normalizeGallerySettings(value);
		assert.equal(settings.separateMobileTileScale, false);
		assert.equal(settings.mobileTileScale, null);
	}
	for (const mobileTileScale of [undefined, null, '150', {}, [], NaN, Infinity, -Infinity]) {
		const settings = normalizeGallerySettings({ tileScale: 380, separateMobileTileScale: true, mobileTileScale });
		assert.equal(settings.tileScale, 380);
		assert.equal(settings.separateMobileTileScale, true);
		assert.equal(settings.mobileTileScale, null);
	}
	for (const separateMobileTileScale of [undefined, null, 0, 1, 'true', [], {}]) {
		assert.equal(normalizeGallerySettings({ separateMobileTileScale }).separateMobileTileScale, false);
	}
});

void test('desktop and mobile legacy percentages serialize exactly and mobile extremes remain bounded', () => {
	for (const mobileTileScale of [10, 123, 380, 1150, 1880, 10000]) {
		const saved = { tileScale: 144, mobileTileScale, separateMobileTileScale: true, custom: { keep: true } };
		const normalized = normalizeGallerySettings(saved);
		const restored = normalizeGallerySettings(JSON.parse(JSON.stringify(normalized)));
		assert.equal(restored.tileScale, 144);
		assert.equal(restored.mobileTileScale, mobileTileScale);
		assert.equal(restored.separateMobileTileScale, true);
		assert.deepEqual(restored.custom, { keep: true });
		assert.deepEqual(saved, { tileScale: 144, mobileTileScale, separateMobileTileScale: true, custom: { keep: true } });
	}
	assert.equal(normalizeGallerySettings({ mobileTileScale: 0 }).mobileTileScale, MIN_TILE_SCALE);
	assert.equal(normalizeGallerySettings({ mobileTileScale: MAX_TILE_SCALE + 1 }).mobileTileScale, MAX_TILE_SCALE);
});

void test('section visibility accepts only boolean preferences and defaults on for legacy or malformed data', () => {
	assert.equal(normalizeGallerySettings({ showSections: false }).showSections, false);
	assert.equal(normalizeGallerySettings({ showSections: true }).showSections, true);
	for (const showSections of [undefined, null, 0, 1, 'false', '', [], {}]) {
		assert.equal(normalizeGallerySettings({ showSections }).showSections, true);
	}
});

void test('settings normalization preserves unrelated saved data without mutating it', () => {
	const saved = { layoutMode: 'aspect', tileScale: 144, futurePreference: { value: true } };
	const result = normalizeGallerySettings(saved);
	assert.equal(result.tileScale, 144);
	assert.deepEqual(result.futurePreference, { value: true });
	assert.equal(saved.tileScale, 144);
});
