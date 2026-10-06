export type WheelBurstIntent =
	| 'horizontal-negative'
	| 'horizontal-positive'
	| 'vertical-negative'
	| 'vertical-positive';

export type StageWheelAction =
	| 'close-viewer'
	| 'hide-info'
	| 'move-next'
	| 'move-previous'
	| 'show-info';

export type FilmstripWheelRoute = 'filmstrip' | 'stage';

const RESTART_RETAINED_PULSE_RATIO = 0.75;
const RESTART_DECAY_SAMPLES = 2;

export interface WheelBurstState {
	consumed: boolean;
	consumedIntent: WheelBurstIntent | null;
	deltaX: number;
	deltaY: number;
	decaySamples: number;
	lastMagnitude: number;
	lastAt: number;
	restartArmed: boolean;
	restartCandidateAt: number | null;
	restartCandidateIntent: WheelBurstIntent | null;
	restartCandidateMagnitude: number;
	restartCandidateMayDecay: boolean;
	restartCandidateMinimumMagnitude: number;
	tailSamples: number;
}

export interface WheelBurstSample {
	at: number;
	deltaX: number;
	deltaY: number;
	/** Uncapped energy for restart ramps; accumulated intent remains capped. */
	rawMagnitude?: number;
}

export interface WheelBurstOptions {
	axisDominance: number;
	idleMs: number;
	restartAxisDominance: number;
	restartCandidateMaxGapMs: number;
	restartConfirmDeltaPx: number;
	restartConfirmRatio: number;
	restartGapMs: number;
	restartGrowthDeltaPx: number;
	restartGrowthRatio: number;
	restartMinMagnitude: number;
	restartQuietCandidateGapMs: number;
	restartTailMagnitude: number;
	restartTailSamples: number;
	thresholdPx: number;
}

export interface WheelBurstUpdate {
	intent: WheelBurstIntent | null;
	startedNewBurst: boolean;
	state: WheelBurstState;
}

export interface FilmstripWheelRouteOptions {
	axisDominance: number;
	deadzonePx: number;
}

export interface StagePageSwipeOptions {
	distanceRatio: number;
	maxDistancePx: number;
	minDistancePx: number;
	velocityMinDistancePx: number;
	velocityThresholdPxPerMs: number;
}

export interface PixelDimensions {
	height: number;
	width: number;
}

export interface NativeScrollSettleOptions {
	quietMs: number;
	releaseGraceMs: number;
}

export interface StagePageFilmstripCloneMedia {
	isLoaded: boolean;
	source: string;
}

export interface StagePageFilmstripMorph {
	originItemWidth: number;
	originMediaInset: number;
	originMediaWidth: number;
	progress: number;
	targetItemWidth: number;
	targetMediaInset: number;
	targetMediaWidth: number;
}

export interface StagePageFilmstripScrollGeometry {
	itemWidthDelta: number;
	maxScrollLeft: number;
	originCenter: number;
	progress: number;
	targetCenter: number;
	viewportWidth: number;
}

export interface WheelDelta {
	deltaX: number;
	deltaY: number;
}

export interface RawWheelRestartCandidate extends WheelDelta {
	at: number;
}

/**
 * Caps reducer energy without changing the physical gesture's axis or angle.
 * Independent component clamps can turn a 2:1 coalesced trackpad sample into
 * an ambiguous 1:1 sample; proportional scaling keeps classification stable.
 */
export function capWheelDelta(
	deltaX: number,
	deltaY: number,
	maximumMagnitude: number,
): WheelDelta {
	const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
	if (magnitude <= maximumMagnitude || magnitude === 0) {
		return { deltaX, deltaY };
	}
	const scale = maximumMagnitude / magnitude;
	return { deltaX: deltaX * scale, deltaY: deltaY * scale };
}

/** Returns whether this sample confirms the reducer's one-frame restart candidate. */
export function confirmsWheelRestartCandidate(
	state: WheelBurstState,
	sample: WheelBurstSample,
	options: WheelBurstOptions,
): boolean {
	const sampleIntent = getDominantIntent(
		sample.deltaX,
		sample.deltaY,
		options.restartMinMagnitude,
		options.restartAxisDominance,
	);
	const magnitude = getWheelSampleMagnitude(sample);
	const growingRamp =
		magnitude >= state.restartCandidateMagnitude * options.restartConfirmRatio &&
		magnitude - state.restartCandidateMagnitude >= options.restartConfirmDeltaPx;
	// A fast physical flick can arrive peak-first, then already decelerate in
	// its next coalesced event. Requiring *more* acceleration swallowed that
	// whole gesture until the idle timeout. Only a separately evidenced fresh
	// impulse may use this path; an ordinary decaying momentum tail cannot.
	const retainedFreshPulse =
		state.restartCandidateMayDecay &&
		magnitude >= state.restartCandidateMinimumMagnitude &&
		magnitude + state.restartCandidateMagnitude >= options.thresholdPx;
	return (
		state.consumed &&
		sampleIntent !== null &&
		state.restartCandidateIntent === sampleIntent &&
		state.restartCandidateAt !== null &&
		sample.at - state.restartCandidateAt <=
			options.restartCandidateMaxGapMs &&
		(growingRamp || retainedFreshPulse)
	);
}

/**
 * Seeds a confirmed fresh visual burst with its withheld first raw sample.
 * Stale or failed candidates are deliberately ignored.
 */
export function getWheelVisualRestartSeed(
	rawSample: WheelDelta,
	rawCandidate: RawWheelRestartCandidate | null,
	confirmedCandidateAt: number | null,
): WheelDelta {
	const carry =
		rawCandidate !== null && rawCandidate.at === confirmedCandidateAt
			? rawCandidate
			: null;
	return {
		deltaX: rawSample.deltaX + (carry?.deltaX ?? 0),
		deltaY: rawSample.deltaY + (carry?.deltaY ?? 0),
	};
}

/**
 * Gives a distance-committed page ownership of its reducer session even when
 * one coalesced raw sample moved farther than the capped intent threshold.
 */
export function claimWheelBurstForCommittedPage(
	state: WheelBurstState | null,
	pageOffset: number,
): WheelBurstState | null {
	if (!state || pageOffset === 0) {
		return state;
	}
	const hasPendingRestartCandidate =
		state.restartCandidateAt !== null &&
		state.restartCandidateIntent !== null;
	return {
		...state,
		consumed: true,
		consumedIntent:
			pageOffset < 0 ? 'horizontal-positive' : 'horizontal-negative',
		restartArmed: hasPendingRestartCandidate
			? state.restartArmed
			: false,
		restartCandidateAt: hasPendingRestartCandidate
			? state.restartCandidateAt
			: null,
		restartCandidateIntent: hasPendingRestartCandidate
			? state.restartCandidateIntent
			: null,
		restartCandidateMagnitude: hasPendingRestartCandidate
			? state.restartCandidateMagnitude
			: 0,
		restartCandidateMayDecay: hasPendingRestartCandidate
			? state.restartCandidateMayDecay
			: false,
		restartCandidateMinimumMagnitude: hasPendingRestartCandidate
			? state.restartCandidateMinimumMagnitude
			: 0,
		tailSamples: hasPendingRestartCandidate ? state.tailSamples : 0,
	};
}

export function shouldAbsorbConsumedWheelBurst(
	state: WheelBurstState | null,
	sample: WheelBurstSample,
	options: WheelBurstOptions,
): boolean {
	return (
		state?.consumed === true && !startsNewWheelBurst(state, sample, options)
	);
}

export function resolveStageWheelIntent(
	intent: WheelBurstIntent,
	infoOpen: boolean,
	canMove: boolean,
): StageWheelAction | null {
	if (intent === 'horizontal-positive') {
		return canMove ? 'move-next' : null;
	}
	if (intent === 'horizontal-negative') {
		return canMove ? 'move-previous' : null;
	}
	if (intent === 'vertical-positive') {
		return 'show-info';
	}
	return infoOpen ? 'hide-info' : 'close-viewer';
}

/**
 * Chooses which viewer surface owns a wheel sample while the pointer is over
 * the filmstrip. Once native horizontal scrolling starts, it owns the entire
 * curved momentum tail; otherwise vertical input remains a viewer gesture.
 */
export function resolveFilmstripWheelRoute(
	deltaX: number,
	deltaY: number,
	shiftKey: boolean,
	nativeSessionActive: boolean,
	options: FilmstripWheelRouteOptions,
): FilmstripWheelRoute {
	if (nativeSessionActive) {
		return 'filmstrip';
	}
	if (shiftKey && Math.abs(deltaY) >= options.deadzonePx) {
		return 'filmstrip';
	}
	return Math.abs(deltaX) >= options.deadzonePx &&
		Math.abs(deltaX) > Math.abs(deltaY) * options.axisDominance
		? 'filmstrip'
		: 'stage';
}

/** Returns whether a released horizontal touch should advance one page. */
export function shouldCommitStagePageSwipe(
	deltaX: number,
	velocityX: number,
	viewportWidth: number,
	options: StagePageSwipeOptions,
): boolean {
	// A deliberate release flick back toward the current page cancels even a
	// long drag. Distance alone must not send the page against the user's hand.
	if (
		Math.abs(velocityX) >= options.velocityThresholdPxPerMs &&
		Math.sign(velocityX) !== Math.sign(deltaX)
	) {
		return false;
	}
	const distanceThreshold = Math.min(
		options.maxDistancePx,
		Math.max(options.minDistancePx, viewportWidth * options.distanceRatio),
	);
	if (Math.abs(deltaX) >= distanceThreshold) {
		return true;
	}
	return (
		Math.abs(deltaX) >= options.velocityMinDistancePx &&
		Math.abs(velocityX) >= options.velocityThresholdPxPerMs &&
		Math.sign(velocityX) === Math.sign(deltaX)
	);
}

/** Maps a drag direction to exactly one cyclic neighbor. */
export function getStagePageNeighborIndex(
	currentIndex: number,
	itemCount: number,
	deltaX: number,
): number | null {
	if (itemCount < 2 || deltaX === 0) {
		return null;
	}
	const delta = deltaX > 0 ? -1 : 1;
	return (currentIndex + delta + itemCount) % itemCount;
}

/**
 * Converts a dominant desktop wheel burst into the same visual offset used by
 * a direct-touch page drag. Wheel delta and content movement have opposite
 * signs, matching the existing next/previous intent mapping.
 */
export function getStageWheelPageOffset(
	deltaX: number,
	deltaY: number,
	viewportWidth: number,
	lockPx: number,
	axisDominance: number,
): number | null {
	if (
		viewportWidth <= 0 ||
		Math.abs(deltaX) < lockPx ||
		Math.abs(deltaX) <= Math.abs(deltaY) * axisDominance
	) {
		return null;
	}
	return Math.max(-viewportWidth, Math.min(viewportWidth, -deltaX));
}

/** Keeps filmstrip movement proportional to the visible page drag. */
export function interpolateStagePageFilmstripScroll(
	originScrollLeft: number,
	targetScrollLeft: number,
	pageOffset: number,
	viewportWidth: number,
): number {
	if (viewportWidth <= 0) {
		return originScrollLeft;
	}
	const progress = Math.min(1, Math.abs(pageOffset) / viewportWidth);
	return originScrollLeft + (targetScrollLeft - originScrollLeft) * progress;
}

/**
 * Morphs the selected filmstrip slot and its neighbor continuously with the
 * visible page. The media inset is derived from the interpolated widths so the
 * thumbnail itself, rather than only its outer slot, changes shape smoothly.
 */
export function getStagePageFilmstripMorph(
	pageOffset: number,
	viewportWidth: number,
	expandedItemWidth: number,
	collapsedItemWidth: number,
	expandedMediaWidth: number,
	collapsedMediaWidth: number,
): StagePageFilmstripMorph {
	const progress =
		viewportWidth > 0
			? Math.min(1, Math.abs(pageOffset) / viewportWidth)
			: 0;
	const mix = (from: number, to: number): number =>
		from + (to - from) * progress;
	const originItemWidth = mix(expandedItemWidth, collapsedItemWidth);
	const targetItemWidth = mix(collapsedItemWidth, expandedItemWidth);
	const originMediaWidth = mix(expandedMediaWidth, collapsedMediaWidth);
	const targetMediaWidth = mix(collapsedMediaWidth, expandedMediaWidth);
	return {
		originItemWidth,
		originMediaInset: Math.max(
			0,
			(originItemWidth - originMediaWidth) / 2,
		),
		originMediaWidth,
		progress,
		targetItemWidth,
		targetMediaInset: Math.max(
			0,
			(targetItemWidth - targetMediaWidth) / 2,
		),
		targetMediaWidth,
	};
}

/**
 * Tracks the interpolated filmstrip center without forcing layout on every
 * gesture sample. The two slot widths trade the same amount, so their sum and
 * the distance between their centers remain invariant; both centers only gain
 * the same half-width translation.
 */
export function getStagePageFilmstripScrollLeft(
	geometry: StagePageFilmstripScrollGeometry,
): number {
	const progress = Math.min(1, Math.max(0, geometry.progress));
	const targetIsAfterOrigin =
		geometry.targetCenter >= geometry.originCenter;
	const sharedShift =
		(targetIsAfterOrigin ? -1 : 1) *
		geometry.itemWidthDelta *
		progress /
		2;
	const center =
		geometry.originCenter +
		(geometry.targetCenter - geometry.originCenter) * progress +
		sharedShift;
	return Math.max(
		0,
		Math.min(
			geometry.maxScrollLeft,
			center - geometry.viewportWidth / 2,
		),
	);
}

/** Identifies the only cyclic transitions that need a temporary edge clone. */
export function isCyclicStagePageWrap(
	originIndex: number,
	targetIndex: number,
	itemCount: number,
): boolean {
	return (
		itemCount > 2 &&
		((originIndex === 0 && targetIndex === itemCount - 1) ||
			(originIndex === itemCount - 1 && targetIndex === 0))
	);
}

/**
 * Chooses the visual source for a cyclic filmstrip edge clone. A decoded
 * adjacent original can safely make an otherwise-unloaded lazy clone visible;
 * without it, the clone keeps the real thumbnail's loaded state.
 */
export function resolveStagePageFilmstripCloneMedia(
	clonedSource: string,
	clonedIsLoaded: boolean,
	preloadedSource: string,
	preloadReady: boolean,
): StagePageFilmstripCloneMedia {
	if (preloadReady && preloadedSource.length > 0) {
		return { isLoaded: true, source: preloadedSource };
	}
	return {
		isLoaded: clonedIsLoaded && clonedSource.length > 0,
		source: clonedSource,
	};
}

/** Returns the unique cyclic image candidates immediately beside an item. */
export function getCyclicNeighborIndices(
	currentIndex: number,
	itemCount: number,
): number[] {
	if (itemCount < 2 || currentIndex < 0 || currentIndex >= itemCount) {
		return [];
	}
	const previous = (currentIndex - 1 + itemCount) % itemCount;
	const next = (currentIndex + 1) % itemCount;
	return previous === next ? [previous] : [previous, next];
}

/**
 * Computes how long a native scroll session must stay open. The release grace
 * lets WebKit begin momentum after pointerup; subsequent scroll events extend
 * the independent quiet deadline.
 */
export function getNativeScrollSettleDelay(
	now: number,
	lastActivityAt: number,
	pointerReleasedAt: number | null,
	pointerActive: boolean,
	options: NativeScrollSettleOptions,
): number {
	let deadline = lastActivityAt + options.quietMs;
	if (pointerReleasedAt !== null) {
		deadline = Math.max(
			deadline,
			pointerReleasedAt + options.releaseGraceMs,
		);
	}
	if (pointerActive) {
		deadline = Math.max(deadline, now + options.quietMs);
	}
	return Math.max(0, deadline - now);
}

/** Resolves a page release exclusively from its immutable gesture origin. */
export function resolveStagePageReleaseIndex(
	originIndex: number,
	itemCount: number,
	deltaX: number,
	commit: boolean,
): number {
	if (!commit) {
		return originIndex;
	}
	return (
		getStagePageNeighborIndex(originIndex, itemCount, deltaX) ?? originIndex
	);
}

/** Keeps a transient square viewport from creating a false orientation flip. */
export function resolveViewportLandscape(
	width: number,
	height: number,
	fallback: boolean,
): boolean {
	if (width === height) {
		return fallback;
	}
	return width > height;
}

/** Preserves aspect ratio while capping a decoded rotation snapshot. */
export function getCappedPreviewDimensions(
	width: number,
	height: number,
	maximumEdgePx: number,
): PixelDimensions | null {
	if (width <= 0 || height <= 0 || maximumEdgePx <= 0) {
		return null;
	}
	const scale = Math.min(1, maximumEdgePx / Math.max(width, height));
	return {
		height: Math.max(1, Math.round(height * scale)),
		width: Math.max(1, Math.round(width * scale)),
	};
}

function getDominantIntent(
	deltaX: number,
	deltaY: number,
	thresholdPx: number,
	axisDominance: number,
): WheelBurstIntent | null {
	const absoluteX = Math.abs(deltaX);
	const absoluteY = Math.abs(deltaY);
	if (
		absoluteX >= thresholdPx &&
		absoluteX > absoluteY * axisDominance
	) {
		return deltaX > 0 ? 'horizontal-positive' : 'horizontal-negative';
	}
	if (
		absoluteY >= thresholdPx &&
		absoluteY > absoluteX * axisDominance
	) {
		return deltaY > 0 ? 'vertical-positive' : 'vertical-negative';
	}
	return null;
}

function startsNewWheelBurst(
	previous: WheelBurstState,
	sample: WheelBurstSample,
	options: WheelBurstOptions,
): boolean {
	const gap = sample.at - previous.lastAt;
	if (gap > options.idleMs) {
		return true;
	}
	if (!previous.consumed) {
		return gap >= options.restartGapMs;
	}
	const sampleIntent = getDominantIntent(
		sample.deltaX,
		sample.deltaY,
		options.restartMinMagnitude,
		options.restartAxisDominance,
	);
	if (!sampleIntent) {
		return false;
	}
	if (
		previous.restartArmed ||
		(previous.consumedIntent !== null &&
			isOppositeIntent(previous.consumedIntent, sampleIntent))
	) {
		return true;
	}
	return confirmsWheelRestartCandidate(previous, sample, options);
}

function getWheelSampleMagnitude(sample: WheelBurstSample): number {
	return sample.rawMagnitude ?? Math.max(Math.abs(sample.deltaX), Math.abs(sample.deltaY));
}

function isOppositeIntent(
	previous: WheelBurstIntent,
	next: WheelBurstIntent,
): boolean {
	return (
		(previous === 'horizontal-negative' && next === 'horizontal-positive') ||
		(previous === 'horizontal-positive' && next === 'horizontal-negative') ||
		(previous === 'vertical-negative' && next === 'vertical-positive') ||
		(previous === 'vertical-positive' && next === 'vertical-negative')
	);
}

/**
 * Reduces DOM wheel events into explicit physical gesture sessions. Each
 * session emits at most one intent. A consumed session can restart only after
 * the full idle timeout, a confirmed fresh impulse after decay/a quiet gap,
 * or a strong reversal on the same axis. Fresh impulses may arrive rising or
 * peak-first; a gap or one delayed momentum frame alone is not a new action.
 */
export function updateWheelBurst(
	previous: WheelBurstState | null,
	sample: WheelBurstSample,
	options: WheelBurstOptions,
): WheelBurstUpdate {
	const sameBurst =
		previous !== null && !startsNewWheelBurst(previous, sample, options);
	const magnitude = getWheelSampleMagnitude(sample);
	const decaySamples = sameBurst && previous.consumed && magnitude < previous.lastMagnitude
		? Math.min(previous.decaySamples + 1, RESTART_DECAY_SAMPLES)
		: 0;
	const tailSamples =
		sameBurst &&
		previous.consumed &&
		magnitude <= options.restartTailMagnitude
			? Math.min(previous.tailSamples + 1, options.restartTailSamples)
			: sameBurst && previous.restartArmed
				? previous.tailSamples
				: 0;
	let restartCandidateAt: number | null = null;
	let restartCandidateIntent: WheelBurstIntent | null = null;
	let restartCandidateMagnitude = 0;
	let restartCandidateMayDecay = false;
	let restartCandidateMinimumMagnitude = 0;
	if (sameBurst && previous.consumed) {
		const sampleIntent = getDominantIntent(
			sample.deltaX,
			sample.deltaY,
			options.restartMinMagnitude,
			options.restartAxisDominance,
		);
		const gap = sample.at - previous.lastAt;
		const quietGapCandidate =
			gap >= options.restartQuietCandidateGapMs;
		const tailGrowthCandidate =
			previous.tailSamples > 0 &&
			gap <= options.restartCandidateMaxGapMs &&
			magnitude >= previous.lastMagnitude * options.restartGrowthRatio &&
			magnitude - previous.lastMagnitude >= options.restartGrowthDeltaPx;
		const renewedImpulse =
			magnitude >= previous.lastMagnitude * options.restartGrowthRatio &&
			magnitude - previous.lastMagnitude >= options.restartGrowthDeltaPx;
		const pulseAfterDecay = previous.decaySamples >= RESTART_DECAY_SAMPLES && renewedImpulse;
		const pulseAfterQuiet = quietGapCandidate &&
			magnitude >= previous.lastMagnitude * options.restartConfirmRatio &&
			magnitude - previous.lastMagnitude >= options.restartConfirmDeltaPx;
		if (
			previous.restartCandidateIntent === null &&
			sampleIntent === previous.consumedIntent &&
			magnitude >= options.restartMinMagnitude &&
			(quietGapCandidate || tailGrowthCandidate || pulseAfterDecay)
		) {
			restartCandidateAt = sample.at;
			restartCandidateIntent = sampleIntent;
			restartCandidateMagnitude = magnitude;
			restartCandidateMayDecay = pulseAfterDecay || pulseAfterQuiet;
			// With a large, separately evidenced rise, the old decayed baseline
			// is the reference—not a fixed fraction of the new peak. Otherwise a
			// legitimate steep flick such as 120→40 is lost just like 80→64 was.
			restartCandidateMinimumMagnitude = renewedImpulse
				? Math.max(options.restartMinMagnitude, previous.lastMagnitude)
				: magnitude * RESTART_RETAINED_PULSE_RATIO;
		}
	}
	const state: WheelBurstState = sameBurst
		? {
				...previous,
				deltaX: previous.deltaX + sample.deltaX,
				deltaY: previous.deltaY + sample.deltaY,
				decaySamples,
				lastMagnitude: magnitude,
				lastAt: sample.at,
				restartArmed:
					previous.restartArmed ||
					tailSamples >= options.restartTailSamples,
				restartCandidateAt,
				restartCandidateIntent,
				restartCandidateMagnitude,
				restartCandidateMayDecay,
				restartCandidateMinimumMagnitude,
				tailSamples,
			}
		: {
				consumed: false,
				consumedIntent: null,
				deltaX: sample.deltaX,
				deltaY: sample.deltaY,
				decaySamples: 0,
				lastMagnitude: magnitude,
				lastAt: sample.at,
				restartArmed: false,
				restartCandidateAt: null,
				restartCandidateIntent: null,
				restartCandidateMagnitude: 0,
				restartCandidateMayDecay: false,
				restartCandidateMinimumMagnitude: 0,
				tailSamples: 0,
			};

	if (state.consumed) {
		return { intent: null, startedNewBurst: !sameBurst, state };
	}

	const intent = getDominantIntent(
		state.deltaX,
		state.deltaY,
		options.thresholdPx,
		options.axisDominance,
	);
	if (!intent) {
		return { intent: null, startedNewBurst: !sameBurst, state };
	}

	state.consumed = true;
	state.consumedIntent = intent;
	state.restartArmed = false;
	state.restartCandidateAt = null;
	state.restartCandidateIntent = null;
	state.restartCandidateMagnitude = 0;
	state.restartCandidateMayDecay = false;
	state.restartCandidateMinimumMagnitude = 0;
	state.tailSamples = 0;
	return { intent, startedNewBurst: !sameBurst, state };
}
