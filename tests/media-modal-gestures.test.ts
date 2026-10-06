import assert from 'node:assert/strict';
import test from 'node:test';
import {
	capWheelDelta,
	claimWheelBurstForCommittedPage,
	confirmsWheelRestartCandidate,
	getCappedPreviewDimensions,
	getCyclicNeighborIndices,
	getNativeScrollSettleDelay,
	getStagePageFilmstripMorph,
	getStagePageFilmstripScrollLeft,
	getStagePageNeighborIndex,
	getStageWheelPageOffset,
	getWheelVisualRestartSeed,
	interpolateStagePageFilmstripScroll,
	isCyclicStagePageWrap,
	resolveFilmstripWheelRoute,
	resolveStagePageFilmstripCloneMedia,
	resolveStagePageReleaseIndex,
	resolveStageWheelIntent,
	resolveViewportLandscape,
	shouldCommitStagePageSwipe,
	shouldAbsorbConsumedWheelBurst,
	updateWheelBurst,
	type FilmstripWheelRouteOptions,
	type StagePageSwipeOptions,
	type WheelBurstIntent,
	type WheelBurstOptions,
	type WheelBurstState,
} from '../src/media-modal-gestures';

const filmstripRouteOptions: FilmstripWheelRouteOptions = {
	axisDominance: 1.15,
	deadzonePx: 2,
};

const pageSwipeOptions: StagePageSwipeOptions = {
	distanceRatio: 0.24,
	maxDistancePx: 120,
	minDistancePx: 56,
	velocityMinDistancePx: 18,
	velocityThresholdPxPerMs: 0.45,
};

const options: WheelBurstOptions = {
	axisDominance: 1.15,
	idleMs: 180,
	restartAxisDominance: 1.35,
	restartCandidateMaxGapMs: 48,
	restartConfirmDeltaPx: 4,
	restartConfirmRatio: 1.1,
	restartGapMs: 80,
	restartGrowthDeltaPx: 10,
	restartGrowthRatio: 1.8,
	restartMinMagnitude: 18,
	restartQuietCandidateGapMs: 72,
	restartTailMagnitude: 12,
	restartTailSamples: 2,
	thresholdPx: 72,
};

function update(
	state: WheelBurstState | null,
	at: number,
	deltaX: number,
	deltaY: number,
) {
	return updateWheelBurst(state, { at, deltaX, deltaY }, options);
}

function collectIntents(
	samples: ReadonlyArray<readonly [number, number, number]>,
): WheelBurstIntent[] {
	let state: WheelBurstState | null = null;
	const intents: WheelBurstIntent[] = [];
	for (const [at, deltaX, deltaY] of samples) {
		const result = update(state, at, deltaX, deltaY);
		state = result.state;
		if (result.intent) {
			intents.push(result.intent);
		}
	}
	return intents;
}

void test('emits exactly one step for a complete trackpad momentum curve', () => {
	const intents = collectIntents([
		[0, 28, 2],
		[10, 46, 2],
		[20, 60, 1],
		[30, 48, 1],
		[40, 32, 0],
		[50, 18, 0],
		[60, 9, 0],
		[70, 5, 0],
		[80, 3, 0],
		[90, 1, 0],
	]);
	assert.deepEqual(intents, ['horizontal-positive']);
});

void test('caps classifier energy without changing a coalesced swipe angle', () => {
	assert.deepEqual(capWheelDelta(200, 100, 60), {
		deltaX: 60,
		deltaY: 30,
	});
	assert.deepEqual(capWheelDelta(-12, 4, 60), {
		deltaX: -12,
		deltaY: 4,
	});
});

void test('keeps raw page travel while the one-action classifier is capped', () => {
	let state: WheelBurstState | null = null;
	let rawDeltaX = 0;
	for (const [at, deltaX, deltaY] of [
		[0, 120, 12],
		[10, 80, 8],
	] as const) {
		const capped = capWheelDelta(deltaX, deltaY, 60);
		const result = updateWheelBurst(
			state,
			{ at, deltaX: capped.deltaX, deltaY: capped.deltaY },
			options,
		);
		state = result.state;
		rawDeltaX += deltaX;
	}
	assert.equal(state?.deltaX, 120);
	assert.equal(getStageWheelPageOffset(rawDeltaX, 20, 390, 10, 1.15), -200);
});

void test('uses uncapped restart energy without increasing capped intent accumulation', () => {
	const first = updateWheelBurst(null, { at: 0, deltaX: 60, deltaY: 0, rawMagnitude: 70 }, options);
	const consumed = updateWheelBurst(first.state, { at: 10, deltaX: 60, deltaY: 0, rawMagnitude: 90 }, options);
	assert.equal(consumed.state.deltaX, 120);
	assert.equal(consumed.state.lastMagnitude, 90);
	const candidate = updateWheelBurst(consumed.state, { at: 95, deltaX: 60, deltaY: 0, rawMagnitude: 70 }, options);
	const next = updateWheelBurst(candidate.state, { at: 110, deltaX: 60, deltaY: 0, rawMagnitude: 90 }, options);
	assert.equal(next.startedNewBurst, true);
	assert.equal(next.state.deltaX, 60);
});

void test('a raw-distance page commit owns its delayed momentum tail', () => {
	const cappedFirst = capWheelDelta(120, 4, 60);
	const first = updateWheelBurst(
		null,
		{ at: 0, deltaX: cappedFirst.deltaX, deltaY: cappedFirst.deltaY },
		options,
	);
	assert.equal(first.state.consumed, false);
	const claimed = claimWheelBurstForCommittedPage(first.state, -120);
	assert.equal(claimed?.consumed, true);
	assert.equal(claimed?.consumedIntent, 'horizontal-positive');

	const delayedTail = { at: 80, deltaX: 60, deltaY: 2 };
	assert.equal(
		shouldAbsorbConsumedWheelBurst(claimed, delayedTail, options),
		true,
	);
	const tailUpdate = updateWheelBurst(claimed, delayedTail, options);
	assert.equal(tailUpdate.intent, null);
	assert.equal(tailUpdate.state.consumed, true);
	const decayingTail = { at: 90, deltaX: 44, deltaY: 1 };
	assert.equal(
		shouldAbsorbConsumedWheelBurst(
			tailUpdate.state,
			decayingTail,
			options,
		),
		true,
	);
	const reversedClaim = claimWheelBurstForCommittedPage(
		{ ...claimed, consumedIntent: 'horizontal-negative' },
		-120,
	);
	assert.equal(reversedClaim?.consumedIntent, 'horizontal-positive');
});

void test('a claimed page session still accepts a confirmed distinct swipe', () => {
	const first = updateWheelBurst(
		null,
		{ at: 0, deltaX: 60, deltaY: 0 },
		options,
	);
	const claimed = claimWheelBurstForCommittedPage(first.state, -120);
	assert.ok(claimed);
	const candidateSample = { at: 90, deltaX: 30, deltaY: 0 };
	const candidate = updateWheelBurst(
		claimed,
		candidateSample,
		options,
	);
	assert.equal(candidate.state.restartCandidateAt, 90);
	const confirmSample = { at: 100, deltaX: 46, deltaY: 0 };
	assert.equal(
		shouldAbsorbConsumedWheelBurst(
			candidate.state,
			confirmSample,
			options,
		),
		false,
	);
});

void test('an old-page release preserves a pending raw restart candidate', () => {
	const first = updateWheelBurst(
		null,
		{ at: 0, deltaX: 60, deltaY: 0 },
		options,
	);
	const owned = claimWheelBurstForCommittedPage(first.state, -120);
	assert.ok(owned);
	const candidate = updateWheelBurst(
		owned,
		{ at: 90, deltaX: 30, deltaY: 0 },
		options,
	);
	assert.equal(candidate.state.restartCandidateAt, 90);

	// A delayed release timer can commit the old page after the candidate event.
	const released = claimWheelBurstForCommittedPage(candidate.state, -120);
	assert.equal(released?.restartCandidateAt, 90);
	assert.equal(released?.restartCandidateMagnitude, 30);
	const confirmSample = { at: 100, deltaX: 46, deltaY: 0 };
	assert.ok(released);
	assert.equal(
		confirmsWheelRestartCandidate(released, confirmSample, options),
		true,
	);
	assert.deepEqual(
		getWheelVisualRestartSeed(
			{ deltaX: 46, deltaY: 0 },
			{ at: 90, deltaX: 30, deltaY: 0 },
			released.restartCandidateAt,
		),
		{ deltaX: 76, deltaY: 0 },
	);
});

void test('reports physical wheel-session boundaries for visual reset', () => {
	const first = update(null, 0, 24, 0);
	assert.equal(first.startedNewBurst, true);
	const same = update(first.state, 10, 24, 0);
	assert.equal(same.startedNewBurst, false);
	const afterIdle = update(same.state, 191, 24, 0);
	assert.equal(afterIdle.startedNewBurst, true);
});

void test('never turns one downward momentum tail into info and modal close', () => {
	let state: WheelBurstState | null = null;
	let infoOpen = true;
	let closeCount = 0;
	for (const [at, deltaY] of [
		[0, -38],
		[10, -48],
		[20, -60],
		[30, -42],
		[40, -24],
		[50, -12],
		[135, -5],
		[145, -3],
		[155, -1],
	] as const) {
		const result = update(state, at, 0, deltaY);
		state = result.state;
		if (!result.intent) {
			continue;
		}
		const action = resolveStageWheelIntent(result.intent, infoOpen, true);
		if (action === 'hide-info') {
			infoOpen = false;
		} else if (action === 'close-viewer') {
			closeCount += 1;
		}
	}
	assert.equal(infoOpen, false);
	assert.equal(closeCount, 0);
});

void test('accepts a rapid opposite swipe without waiting for idle timeout', () => {
	const first = update(null, 0, 0, -40);
	const dismissed = update(first.state, 10, 0, -40);
	assert.equal(dismissed.intent, 'vertical-negative');

	const opposite = { at: 24, deltaX: 0, deltaY: 44 };
	assert.equal(
		shouldAbsorbConsumedWheelBurst(dismissed.state, opposite, options),
		false,
	);
	const restarted = updateWheelBurst(dismissed.state, opposite, options);
	assert.equal(restarted.intent, null);
	const opened = update(restarted.state, 34, 0, 34);
	assert.equal(opened.intent, 'vertical-positive');
});

void test('accepts a rapid same-direction swipe after a confirmed quiet tail', () => {
	const first = update(null, 0, 0, -40);
	const consumed = update(first.state, 10, 0, -40);
	const tailOne = update(consumed.state, 20, 0, -5);
	const tailTwo = update(tailOne.state, 30, 0, -3);
	assert.equal(tailTwo.state.restartArmed, true);

	const nextImpulse = { at: 42, deltaX: 0, deltaY: -46 };
	assert.equal(
		shouldAbsorbConsumedWheelBurst(tailTwo.state, nextImpulse, options),
		false,
	);
	const restarted = updateWheelBurst(tailTwo.state, nextImpulse, options);
	const next = update(restarted.state, 52, 0, -32);
	assert.equal(next.intent, 'vertical-negative');
});

void test('accepts a same-direction swipe after quiet release without 180ms pause', () => {
	assert.deepEqual(
		collectIntents([
			[0, 0, 44],
			[10, 0, 44],
			// No low-energy tail was delivered. A new rising ramp after the
			// page-release quiet gap confirms a separate physical swipe.
			[90, 0, 30],
			[100, 0, 46],
			[110, 0, 40],
		]),
		['vertical-positive', 'vertical-positive'],
	);
});

void test('carries a confirmed raw restart candidate into visual page travel', () => {
	const first = update(null, 0, 44, 0);
	const consumed = update(first.state, 10, 44, 0);
	const candidate = update(consumed.state, 90, 30, 0);
	assert.equal(candidate.state.restartCandidateAt, 90);
	const confirmSample = { at: 100, deltaX: 46, deltaY: 0 };
	assert.equal(
		confirmsWheelRestartCandidate(
			candidate.state,
			confirmSample,
			options,
		),
		true,
	);
	assert.deepEqual(
		getWheelVisualRestartSeed(
			{ deltaX: 46, deltaY: 0 },
			{ at: 90, deltaX: 30, deltaY: 0 },
			candidate.state.restartCandidateAt,
		),
		{ deltaX: 76, deltaY: 0 },
	);
});

void test('does not carry a failed or stale raw restart candidate', () => {
	const first = update(null, 0, 44, 0);
	const consumed = update(first.state, 10, 44, 0);
	const candidate = update(consumed.state, 90, 30, 0);
	const failedSample = { at: 100, deltaX: 20, deltaY: 0 };
	assert.equal(
		confirmsWheelRestartCandidate(
			candidate.state,
			failedSample,
			options,
		),
		false,
	);
	assert.deepEqual(
		getWheelVisualRestartSeed(
			{ deltaX: 20, deltaY: 0 },
			{ at: 90, deltaX: 30, deltaY: 0 },
			null,
		),
		{ deltaX: 20, deltaY: 0 },
	);
	assert.deepEqual(
		getWheelVisualRestartSeed(
			{ deltaX: 46, deltaY: 0 },
			{ at: 80, deltaX: 30, deltaY: 0 },
			candidate.state.restartCandidateAt,
		),
		{ deltaX: 46, deltaY: 0 },
	);
});

void test('rearms a same-direction swipe from a quiet valley and confirmed fresh ramp', () => {
	assert.deepEqual(
		collectIntents([
			[0, 0, 40],
			[10, 0, 40],
			[20, 0, 28],
			[30, 0, 12],
			[40, 0, 30],
			[50, 0, 44],
			[60, 0, 36],
		]),
		['vertical-positive', 'vertical-positive'],
	);
});

void test('does not mistake a failed low-energy rebound for a new swipe', () => {
	assert.deepEqual(
		collectIntents([
			[0, 0, 40],
			[10, 0, 40],
			[20, 0, 12],
			[30, 0, 25],
			[40, 0, 20],
			[50, 0, 16],
			[60, 0, 12],
		]),
		['vertical-positive'],
	);
});

void test('keeps a monotone macOS momentum tail in one consumed session', () => {
	assert.deepEqual(
		collectIntents([
			[0, 0, 40],
			[10, 0, 40],
			[20, 0, 60],
			[30, 0, 44],
			[40, 0, 30],
			[50, 0, 20],
			[60, 0, 14],
			[70, 0, 10],
			[80, 0, 7],
			[90, 0, 4],
		]),
		['vertical-positive'],
	);
});

void test('does not confirm a same-direction restart from a delayed momentum frame', () => {
	assert.deepEqual(
		collectIntents([
			[0, 44, 0],
			[10, 44, 0],
			[20, 12, 0],
			[120, 52, 0],
			[130, 34, 0],
		]),
		['horizontal-positive'],
	);
});

void test('uses the dominant component for a quiet tail with diagonal jitter', () => {
	assert.deepEqual(
		collectIntents([
			[0, 2, -40],
			[10, 3, -40],
			[20, 8, -10],
			[30, 2, -30],
			[40, 2, -44],
			[50, 1, -36],
		]),
		['vertical-negative', 'vertical-negative'],
	);
});

void test('does not rearm from a single low-energy outlier', () => {
	const first = update(null, 0, 40, 0);
	const consumed = update(first.state, 10, 40, 0);
	const outlier = update(consumed.state, 20, 5, 0);
	assert.equal(outlier.state.restartArmed, false);
	const rebound = update(outlier.state, 30, 50, 0);
	assert.equal(rebound.intent, null);
	assert.equal(rebound.state.consumed, true);
});

void test('does not split a consumed swipe after a long scheduling frame', () => {
	const first = update(null, 0, 44, 0);
	const consumed = update(first.state, 10, 44, 0);
	assert.equal(consumed.intent, 'horizontal-positive');

	const delayedTail = update(consumed.state, 110, 52, 0);
	const remainder = update(delayedTail.state, 120, 34, 0);
	assert.equal(delayedTail.intent, null);
	assert.equal(remainder.intent, null);
	assert.equal(remainder.state.consumed, true);
});

void test('does not split one curved horizontal-to-vertical swipe', () => {
	const first = update(null, 0, 42, 0);
	const horizontal = update(first.state, 10, 42, 0);
	assert.equal(horizontal.intent, 'horizontal-positive');

	const curved = update(horizontal.state, 20, 0, 54);
	const verticalTail = update(curved.state, 30, 0, 46);
	assert.equal(curved.intent, null);
	assert.equal(verticalTail.intent, null);
	assert.equal(verticalTail.state.consumed, true);
});

void test('allows a new action after the full idle timeout', () => {
	const consumed = update(null, 0, 0, -80);
	const nextGesture = update(consumed.state, 181, 0, -80);
	assert.equal(nextGesture.intent, 'vertical-negative');
});

void test('waits for a dominant axis before classifying a diagonal burst', () => {
	const diagonal = update(null, 0, 50, 50);
	assert.equal(diagonal.intent, null);
	const horizontal = update(diagonal.state, 10, 40, 0);
	assert.equal(horizontal.intent, 'horizontal-positive');
});

void test('maps vertical intents to exactly one state-dependent action', () => {
	assert.equal(resolveStageWheelIntent('vertical-negative', true, true), 'hide-info');
	assert.equal(
		resolveStageWheelIntent('vertical-negative', false, true),
		'close-viewer',
	);
	assert.equal(resolveStageWheelIntent('vertical-positive', false, true), 'show-info');
});

void test('routes vertical wheel over a stationary filmstrip back to the stage', () => {
	assert.equal(
		resolveFilmstripWheelRoute(
			0.8,
			-48,
			false,
			false,
			filmstripRouteOptions,
		),
		'stage',
	);
});

void test('keeps horizontal and shift-wheel filmstrip input native', () => {
	assert.equal(
		resolveFilmstripWheelRoute(
			36,
			4,
			false,
			false,
			filmstripRouteOptions,
		),
		'filmstrip',
	);
	assert.equal(
		resolveFilmstripWheelRoute(
			0,
			40,
			true,
			false,
			filmstripRouteOptions,
		),
		'filmstrip',
	);
});

void test('keeps a curved momentum tail in its active native filmstrip session', () => {
	assert.equal(
		resolveFilmstripWheelRoute(
			1,
			-52,
			false,
			true,
			filmstripRouteOptions,
		),
		'filmstrip',
	);
});

void test('recognizes a second downward gesture after layout moves the filmstrip', () => {
	let state: WheelBurstState | null = null;
	let infoOpen = true;
	let closeCount = 0;
	for (const [at, deltaX, deltaY, overFilmstrip] of [
		[0, 0, -40, false],
		[10, 0, -40, false],
		// Closing metadata moves the filmstrip under the same coordinates.
		[20, 0, -5, true],
		[30, 0, -3, true],
		[42, 0.8, -46, true],
		[52, 0.5, -32, true],
	] as const) {
		if (overFilmstrip) {
			assert.equal(
				resolveFilmstripWheelRoute(
					deltaX,
					deltaY,
					false,
					false,
					filmstripRouteOptions,
				),
				'stage',
			);
		}
		const result = update(state, at, deltaX, deltaY);
		state = result.state;
		if (!result.intent) {
			continue;
		}
		const action = resolveStageWheelIntent(result.intent, infoOpen, true);
		if (action === 'hide-info') {
			infoOpen = false;
		} else if (action === 'close-viewer') {
			closeCount += 1;
		}
	}
	assert.equal(infoOpen, false);
	assert.equal(closeCount, 1);
});

void test('commits a stage page by distance or matching release velocity', () => {
	assert.equal(
		shouldCommitStagePageSwipe(-100, -0.1, 390, pageSwipeOptions),
		true,
	);
	assert.equal(
		shouldCommitStagePageSwipe(-32, -0.8, 390, pageSwipeOptions),
		true,
	);
	assert.equal(
		shouldCommitStagePageSwipe(-32, 0.8, 390, pageSwipeOptions),
		false,
	);
	assert.equal(
		shouldCommitStagePageSwipe(-12, -1.2, 390, pageSwipeOptions),
		false,
	);
});

void test('maps a stage drag to exactly one cyclic neighbor', () => {
	assert.equal(getStagePageNeighborIndex(0, 5, -20), 1);
	assert.equal(getStagePageNeighborIndex(0, 5, 20), 4);
	assert.equal(getStagePageNeighborIndex(4, 5, -20), 0);
	assert.equal(getStagePageNeighborIndex(0, 1, -20), null);
});

void test('maps a dominant desktop wheel burst onto the touch page axis', () => {
	assert.equal(getStageWheelPageOffset(48, 3, 390, 10, 1.15), -48);
	assert.equal(getStageWheelPageOffset(-48, 3, 390, 10, 1.15), 48);
	assert.equal(getStageWheelPageOffset(8, 0, 390, 10, 1.15), null);
	assert.equal(getStageWheelPageOffset(40, 38, 390, 10, 1.15), null);
	assert.equal(getStageWheelPageOffset(600, 0, 390, 10, 1.15), -390);
});

void test('maps one complete horizontal momentum burst to one adjacent page', () => {
	const originIndex = 170;
	const targets = collectIntents([
		[0, 28, 2],
		[10, 46, 2],
		[20, 60, 1],
		[30, 48, 1],
		[40, 24, 0],
		[50, 10, 0],
		[60, 5, 0],
	]).flatMap((intent) => {
		if (intent !== 'horizontal-positive' && intent !== 'horizontal-negative') {
			return [];
		}
		const visualOffset = intent === 'horizontal-positive' ? -72 : 72;
		const target = getStagePageNeighborIndex(originIndex, 341, visualOffset);
		return target === null ? [] : [target];
	});
	assert.deepEqual(targets, [171]);
});

void test('moves the filmstrip in lockstep with page drag progress', () => {
	assert.equal(interpolateStagePageFilmstripScroll(100, 200, 0, 400), 100);
	assert.equal(interpolateStagePageFilmstripScroll(100, 200, -100, 400), 125);
	assert.equal(interpolateStagePageFilmstripScroll(100, 200, 400, 400), 200);
	assert.equal(interpolateStagePageFilmstripScroll(100, 200, 800, 400), 200);
	assert.equal(interpolateStagePageFilmstripScroll(100, 200, 100, 0), 100);
});

void test('morphs both filmstrip slots and their media continuously', () => {
	assert.deepEqual(
		getStagePageFilmstripMorph(200, 400, 64, 26, 42, 26),
		{
			originItemWidth: 45,
			originMediaInset: 5.5,
			originMediaWidth: 34,
			progress: 0.5,
			targetItemWidth: 45,
			targetMediaInset: 5.5,
			targetMediaWidth: 34,
		},
	);
	assert.deepEqual(
		getStagePageFilmstripMorph(400, 400, 64, 26, 42, 26),
		{
			originItemWidth: 26,
			originMediaInset: 0,
			originMediaWidth: 26,
			progress: 1,
			targetItemWidth: 64,
			targetMediaInset: 11,
			targetMediaWidth: 42,
		},
	);
});

void test('tracks filmstrip center analytically while slot widths trade space', () => {
	assert.equal(
		getStagePageFilmstripScrollLeft({
			itemWidthDelta: 38,
			maxScrollLeft: 1000,
			originCenter: 100,
			progress: 0,
			targetCenter: 160,
			viewportWidth: 100,
		}),
		50,
	);
	assert.equal(
		getStagePageFilmstripScrollLeft({
			itemWidthDelta: 38,
			maxScrollLeft: 1000,
			originCenter: 100,
			progress: 0.5,
			targetCenter: 160,
			viewportWidth: 100,
		}),
		70.5,
	);
	assert.equal(
		getStagePageFilmstripScrollLeft({
			itemWidthDelta: 38,
			maxScrollLeft: 1000,
			originCenter: 100,
			progress: 1,
			targetCenter: 40,
			viewportWidth: 100,
		}),
		9,
	);
});

void test('waits for wheel release distance instead of committing at intent lock', () => {
	let state: WheelBurstState | null = null;
	const intents: WheelBurstIntent[] = [];
	for (const [at, deltaX] of [
		[0, 28],
		[10, 46],
		[20, 30],
		[30, 20],
	] as const) {
		const result = update(state, at, deltaX, 0);
		state = result.state;
		if (result.intent) {
			intents.push(result.intent);
		}
	}
	assert.deepEqual(intents, ['horizontal-positive']);
	assert.equal(state?.deltaX, 124);
	assert.equal(
		shouldCommitStagePageSwipe(-72, 0, 1000, pageSwipeOptions),
		false,
	);
	assert.equal(
		shouldCommitStagePageSwipe(-124, 0, 1000, pageSwipeOptions),
		true,
	);
});

void test('uses edge clones only for true cyclic filmstrip wraps', () => {
	assert.equal(isCyclicStagePageWrap(0, 340, 341), true);
	assert.equal(isCyclicStagePageWrap(340, 0, 341), true);
	assert.equal(isCyclicStagePageWrap(0, 1, 341), false);
	assert.equal(isCyclicStagePageWrap(0, 1, 2), false);
});

void test('makes an unloaded wrap clone visible from a decoded neighbor original', () => {
	assert.deepEqual(
		resolveStagePageFilmstripCloneMedia(
			'',
			false,
			'app://vault/full-neighbor.jpg',
			true,
		),
		{
			isLoaded: true,
			source: 'app://vault/full-neighbor.jpg',
		},
	);
	assert.deepEqual(
		resolveStagePageFilmstripCloneMedia(
			'blob:lazy-thumbnail',
			false,
			'app://vault/not-ready.jpg',
			false,
		),
		{ isLoaded: false, source: 'blob:lazy-thumbnail' },
	);
});

void test('bounds original neighbor candidates to the unique adjacent items', () => {
	assert.deepEqual(getCyclicNeighborIndices(0, 341), [340, 1]);
	assert.deepEqual(getCyclicNeighborIndices(0, 2), [1]);
	assert.deepEqual(getCyclicNeighborIndices(0, 1), []);
	assert.deepEqual(getCyclicNeighborIndices(-1, 341), []);
});

void test('keeps native filmstrip settling open through release grace and momentum', () => {
	const settleOptions = { quietMs: 120, releaseGraceMs: 220 };
	assert.equal(
		getNativeScrollSettleDelay(100, 100, null, true, settleOptions),
		120,
	);
	assert.equal(
		getNativeScrollSettleDelay(140, 120, 130, false, settleOptions),
		210,
	);
	assert.equal(
		getNativeScrollSettleDelay(360, 330, 130, false, settleOptions),
		90,
	);
	assert.equal(
		getNativeScrollSettleDelay(451, 330, 130, false, settleOptions),
		0,
	);
});

void test('resolves a page release from its immutable origin index', () => {
	const originIndex = 2;
	let independentlyMutableCurrentIndex = 4;
	independentlyMutableCurrentIndex = 0;
	assert.equal(independentlyMutableCurrentIndex, 0);
	assert.equal(resolveStagePageReleaseIndex(originIndex, 6, -80, true), 3);
	assert.equal(resolveStagePageReleaseIndex(originIndex, 6, 80, true), 1);
	assert.equal(resolveStagePageReleaseIndex(originIndex, 6, -80, false), 2);
});

void test('detects viewport orientation without flipping on a square pulse', () => {
	assert.equal(resolveViewportLandscape(844, 390, false), true);
	assert.equal(resolveViewportLandscape(390, 844, true), false);
	assert.equal(resolveViewportLandscape(500, 500, true), true);
	assert.equal(resolveViewportLandscape(500, 500, false), false);
});

void test('caps a decoded rotation snapshot without changing its ratio', () => {
	assert.deepEqual(getCappedPreviewDimensions(1200, 800, 320), {
		height: 213,
		width: 320,
	});
	assert.deepEqual(getCappedPreviewDimensions(120, 80, 320), {
		height: 80,
		width: 120,
	});
	assert.equal(getCappedPreviewDimensions(0, 80, 320), null);
});
