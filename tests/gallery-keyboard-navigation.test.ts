import assert from 'node:assert/strict';
import test from 'node:test';
import {
	findGalleryControlFallbackIndex,
	findGalleryToolbarControlIndex,
	getSectionNavigationIntent,
	isGalleryArrowKey,
} from '../src/gallery-keyboard-navigation';

void test('recognizes only gallery arrow key names', () => {
	assert.equal(isGalleryArrowKey('ArrowLeft'), true);
	assert.equal(isGalleryArrowKey('ArrowDown'), true);
	assert.equal(isGalleryArrowKey('Enter'), false);
	assert.equal(isGalleryArrowKey('Left'), false);
});

void test('maps section arrows to standard expand and collapse intents', () => {
	assert.equal(getSectionNavigationIntent('ArrowRight', false), 'expand');
	assert.equal(getSectionNavigationIntent('ArrowRight', true), 'focus-child');
	assert.equal(getSectionNavigationIntent('ArrowLeft', true), 'collapse');
	assert.equal(getSectionNavigationIntent('ArrowLeft', false), 'focus-parent');
	assert.equal(getSectionNavigationIntent('ArrowUp', true), 'focus-previous');
	assert.equal(getSectionNavigationIntent('ArrowDown', false), 'focus-next');
});

void test('vertical fallback leaves the current tile grid for a section boundary', () => {
	const groups = [null, 'season-1', 'season-1', 'season-1', null, 'season-2'];

	assert.equal(findGalleryControlFallbackIndex(groups, 2, 'ArrowUp'), 0);
	assert.equal(findGalleryControlFallbackIndex(groups, 1, 'ArrowDown'), 4);
	assert.equal(findGalleryControlFallbackIndex(groups, 3, 'ArrowDown'), 4);
});

void test('horizontal fallback remains sequential across tiles and headers', () => {
	const groups = [null, 'season-1', 'season-1', null, 'season-2'];

	assert.equal(findGalleryControlFallbackIndex(groups, 1, 'ArrowRight'), 2);
	assert.equal(findGalleryControlFallbackIndex(groups, 2, 'ArrowRight'), 3);
	assert.equal(findGalleryControlFallbackIndex(groups, 1, 'ArrowLeft'), 0);
});

void test('fallback returns null at component edges and for stale indexes', () => {
	const groups = [null, 'season-1'];

	assert.equal(findGalleryControlFallbackIndex(groups, 0, 'ArrowUp'), null);
	assert.equal(findGalleryControlFallbackIndex(groups, 1, 'ArrowDown'), null);
	assert.equal(findGalleryControlFallbackIndex(groups, -1, 'ArrowRight'), null);
	assert.equal(findGalleryControlFallbackIndex(groups, 3, 'ArrowLeft'), null);
});

void test('toolbar movement uses enabled control order and stops at the ends', () => {
	// The view supplies only enabled controls, so collapse is skipped in flat
	// mode without needing a separate positional slot or changing Tab order.
	assert.equal(findGalleryToolbarControlIndex(3, 0, 'ArrowRight'), 1);
	assert.equal(findGalleryToolbarControlIndex(3, 1, 'ArrowLeft'), 0);
	assert.equal(findGalleryToolbarControlIndex(3, 2, 'ArrowRight'), null);
	assert.equal(findGalleryToolbarControlIndex(3, 0, 'ArrowLeft'), null);
	assert.equal(findGalleryToolbarControlIndex(3, 1, 'ArrowDown'), null);
	assert.equal(findGalleryToolbarControlIndex(0, 0, 'ArrowRight'), null);
	assert.equal(findGalleryToolbarControlIndex(3, -1, 'ArrowRight'), null);
});
