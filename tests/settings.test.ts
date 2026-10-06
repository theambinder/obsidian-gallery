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

void test('tile scale snaps to slider steps and clamps to supported bounds', () => {
	assert.equal(MIN_TILE_SCALE, 30);
	assert.equal(MAX_TILE_SCALE, 180);
	assert.equal(normalizeTileScale(-100), 30);
	assert.equal(normalizeTileScale(29), 30);
	assert.equal(normalizeTileScale(35), 40);
	assert.equal(normalizeTileScale(59), 60);
	assert.equal(normalizeTileScale(104), 100);
	assert.equal(normalizeTileScale(106), 110);
	assert.equal(normalizeTileScale(179), 180);
	assert.equal(normalizeTileScale(10000), 180);
});

void test('legacy settings keep their layout and gain the original tile scale', () => {
	assert.deepEqual(normalizeGallerySettings({ layoutMode: 'aspect', version: 1 }), {
		layoutMode: 'aspect', tileScale: 100, showSections: true, version: 1,
	});
	for (const value of [null, [], undefined, 'invalid', { layoutMode: 'invalid' }]) {
		assert.equal(normalizeGallerySettings(value).layoutMode, 'square');
		assert.equal(normalizeGallerySettings(value).tileScale, 100);
		assert.equal(normalizeGallerySettings(value).showSections, true);
	}
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
	assert.equal(result.tileScale, 140);
	assert.deepEqual(result.futurePreference, { value: true });
	assert.equal(saved.tileScale, 144);
});
