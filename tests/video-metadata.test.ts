import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createVideoFrameRateEstimatorState,
	formatApproximateFrameRate,
	formatMediaDuration,
	getContainedVideoOffsets,
	updateVideoFrameRateEstimator,
	type VideoFrameRateEstimatorState,
} from '../src/video-metadata';

void test('formats finite media durations without overstating partial seconds', () => {
	assert.equal(formatMediaDuration(0), '0:00');
	assert.equal(formatMediaDuration(5.99), '0:05');
	assert.equal(formatMediaDuration(65.9), '1:05');
	assert.equal(formatMediaDuration(3661), '1:01:01');
	assert.equal(formatMediaDuration(Number.NaN), null);
	assert.equal(formatMediaDuration(Number.POSITIVE_INFINITY), null);
	assert.equal(formatMediaDuration(-1), null);
});

void test('computes square-root contain offsets for landscape and portrait video', () => {
	assert.deepEqual(getContainedVideoOffsets(16, 9), {
		blockPercent: 21.875,
		inlinePercent: 0,
	});
	assert.deepEqual(getContainedVideoOffsets(9, 16), {
		blockPercent: 0,
		inlinePercent: 21.875,
	});
	assert.deepEqual(getContainedVideoOffsets(100, 100), {
		blockPercent: 0,
		inlinePercent: 0,
	});
	assert.equal(getContainedVideoOffsets(0, 100), null);
	assert.equal(getContainedVideoOffsets(100, Number.NaN), null);
});

void test('waits for six valid frame intervals before estimating FPS', () => {
	let state = createVideoFrameRateEstimatorState();
	state = updateVideoFrameRateEstimator(state, 0);
	for (let frame = 1; frame <= 5; frame += 1) {
		state = updateVideoFrameRateEstimator(state, frame / 60);
	}
	assert.equal(state.intervals.length, 5);
	assert.equal(state.approximateFps, null);

	state = updateVideoFrameRateEstimator(state, 6 / 60);
	assert.equal(state.intervals.length, 6);
	assert.ok(state.approximateFps !== null);
	assert.ok(Math.abs(state.approximateFps - 60) < 0.000_001);
});

void test('starts a fresh estimate after duplicate, reverse, or seek-sized deltas', () => {
	let state = createVideoFrameRateEstimatorState();
	for (const mediaTime of [
		0,
		1 / 30,
		1 / 30,
		-1,
		-1 + 1 / 30,
		10,
		10 + 1 / 30,
	]) {
		state = updateVideoFrameRateEstimator(state, mediaTime);
	}
	assert.equal(state.intervals.length, 1);
	assert.equal(state.approximateFps, null);
	assert.ok(
		state.intervals.every(
			(interval) => Math.abs(interval - 1 / 30) < 1e-9,
		),
	);
	assert.equal(state.lastMediaTime, 10 + 1 / 30);
});

void test('clears a completed estimate when playback seeks', () => {
	let state = createVideoFrameRateEstimatorState();
	for (let frame = 0; frame <= 6; frame += 1) {
		state = updateVideoFrameRateEstimator(state, frame / 24);
	}
	assert.ok(state.approximateFps !== null);

	state = updateVideoFrameRateEstimator(state, 20);
	assert.equal(state.approximateFps, null);
	assert.deepEqual(state.intervals, []);
	assert.equal(state.lastMediaTime, 20);
});

void test('uses the median of at most eight recent valid frame intervals', () => {
	let state = createVideoFrameRateEstimatorState();
	let mediaTime = 0;
	state = updateVideoFrameRateEstimator(state, mediaTime);
	for (const interval of [
		1 / 30,
		1 / 30,
		1 / 30,
		0.2,
		1 / 30,
		1 / 30,
		1 / 30,
		1 / 30,
		1 / 30,
	]) {
		mediaTime += interval;
		state = updateVideoFrameRateEstimator(state, mediaTime);
	}

	assert.equal(state.intervals.length, 8);
	assert.ok(state.approximateFps !== null);
	assert.ok(Math.abs(state.approximateFps - 30) < 0.000_001);
});

void test('keeps reducer inputs immutable and formats estimates honestly', () => {
	const initial: VideoFrameRateEstimatorState = {
		approximateFps: null,
		intervals: [1 / 24],
		lastMediaTime: 1,
	};
	const next = updateVideoFrameRateEstimator(initial, 1 + 1 / 24);

	assert.deepEqual(initial.intervals, [1 / 24]);
	assert.notEqual(next, initial);
	assert.notEqual(next.intervals, initial.intervals);
	assert.equal(formatApproximateFrameRate(23.976), '≈ 23.98 FPS');
	assert.equal(formatApproximateFrameRate(30), '≈ 30 FPS');
	assert.equal(formatApproximateFrameRate(8.25), '≈ 8.25 FPS');
	assert.equal(formatApproximateFrameRate(null), null);
	assert.equal(formatApproximateFrameRate(Number.NaN), null);
});

void test('uses presented frame counts when mobile callbacks skip frames', () => {
	let state = createVideoFrameRateEstimatorState();
	for (let callback = 0; callback <= 6; callback += 1) {
		state = updateVideoFrameRateEstimator(
			state,
			(callback * 3) / 60,
			1 + callback * 3,
		);
	}
	assert.ok(state.approximateFps !== null);
	assert.ok(Math.abs(state.approximateFps - 60) < 0.000_001);
	assert.equal(state.lastPresentedFrames, 19);
});

void test('resets frame counts after a decoder restart without producing invalid FPS', () => {
	let state = updateVideoFrameRateEstimator(
		createVideoFrameRateEstimatorState(), 0, 100,
	);
	state = updateVideoFrameRateEstimator(state, 1 / 30, 1);
	assert.equal(state.approximateFps, null);
	assert.deepEqual(state.intervals, []);
	for (let frame = 2; frame <= 7; frame += 1) {
		state = updateVideoFrameRateEstimator(state, frame / 30, frame);
	}
	assert.ok(state.approximateFps !== null);
	assert.ok(Math.abs(state.approximateFps - 30) < 0.000_001);
});

void test('falls back to media timestamps when frame counts are unavailable', () => {
	let state = createVideoFrameRateEstimatorState();
	for (let frame = 0; frame <= 6; frame += 1) {
		state = updateVideoFrameRateEstimator(state, frame / 24, Number.NaN);
	}
	assert.ok(state.approximateFps !== null);
	assert.ok(Math.abs(state.approximateFps - 24) < 0.000_001);
});
