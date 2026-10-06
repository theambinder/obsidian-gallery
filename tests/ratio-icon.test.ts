import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getRatioIconArrowPaths,
	RATIO_ICON_FRAME_PATH,
} from '../src/ratio-icon';

void test('uses the supplied common ratio frame path', () => {
	assert.equal(
		RATIO_ICON_FRAME_PATH,
		'M17.8333 7H6.16667C5.24619 7 4.5 7.74619 4.5 8.66667V15.3333C4.5 16.2538 5.24619 17 6.16667 17H17.8333C18.7538 17 19.5 16.2538 19.5 15.3333V8.66667C19.5 7.74619 18.7538 7 17.8333 7Z',
	);
});

void test('uses inward arrows while media fits inside its tile', () => {
	assert.deepEqual(getRatioIconArrowPaths(true), [
		'M9 1L12 4L15 1',
		'M9 23L12 20L15 23',
	]);
});

void test('uses outward arrows while media fills its tile', () => {
	assert.deepEqual(getRatioIconArrowPaths(false), [
		'M9 4L12 1L15 4',
		'M9 20L12 23L15 20',
	]);
});
