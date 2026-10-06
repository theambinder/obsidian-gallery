import assert from 'node:assert/strict';
import test from 'node:test';
import { isRectVisibleWithinRoot, type RectLike } from '../src/visibility';

function rect(
	left: number,
	top: number,
	width: number,
	height: number,
): RectLike {
	return {
		bottom: top + height,
		height,
		left,
		right: left + width,
		top,
		width,
	};
}

void test('does not load media while a drawer has no rendered size', () => {
	assert.equal(
		isRectVisibleWithinRoot(rect(0, 0, 0, 0), rect(0, 0, 0, 0), 144),
		false,
	);
	assert.equal(
		isRectVisibleWithinRoot(rect(0, 0, 320, 640), rect(0, 0, 0, 0), 144),
		false,
	);
});

void test('loads visible and near-viewport media but not distant media', () => {
	const root = rect(100, 100, 320, 640);
	assert.equal(isRectVisibleWithinRoot(root, rect(120, 160, 80, 80), 144), true);
	assert.equal(isRectVisibleWithinRoot(root, rect(120, 780, 80, 80), 144), true);
	assert.equal(isRectVisibleWithinRoot(root, rect(120, 980, 80, 80), 144), false);
});
