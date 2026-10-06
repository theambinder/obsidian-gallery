const MAX_FRAME_INTERVAL_SECONDS = 0.25;
const MAX_FRAME_RATE_INTERVALS = 8;
const MIN_FRAME_RATE_INTERVALS = 6;

export interface ContainedVideoOffsets {
	readonly blockPercent: number;
	readonly inlinePercent: number;
}

export interface VideoFrameRateEstimatorState {
	readonly approximateFps: number | null;
	readonly intervals: readonly number[];
	readonly lastMediaTime: number | null;
	readonly lastPresentedFrames?: number | null;
}

export interface VideoTileMetadata {
	readonly durationSeconds: number;
	readonly height: number;
	readonly width: number;
}

/** Formats a finite media duration as m:ss or h:mm:ss. */
export function formatMediaDuration(durationSeconds: number): string | null {
	if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
		return null;
	}
	const wholeSeconds = Math.floor(durationSeconds);
	const seconds = wholeSeconds % 60;
	const totalMinutes = Math.floor(wholeSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	const paddedSeconds = String(seconds).padStart(2, '0');
	if (hours === 0) {
		return `${minutes}:${paddedSeconds}`;
	}
	return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
}

/**
 * Returns the letterbox offsets for an object-fit: contain video in a square
 * root. Percentages are measured inward from the corresponding root edges.
 */
export function getContainedVideoOffsets(
	videoWidth: number,
	videoHeight: number,
): ContainedVideoOffsets | null {
	if (
		!Number.isFinite(videoWidth) ||
		!Number.isFinite(videoHeight) ||
		videoWidth <= 0 ||
		videoHeight <= 0
	) {
		return null;
	}
	return {
		blockPercent: (1 - Math.min(1, videoHeight / videoWidth)) * 50,
		inlinePercent: (1 - Math.min(1, videoWidth / videoHeight)) * 50,
	};
}

export function createVideoFrameRateEstimatorState(): VideoFrameRateEstimatorState {
	return {
		approximateFps: null,
		intervals: [],
		lastMediaTime: null,
		lastPresentedFrames: null,
	};
}

/**
 * Reduces requestVideoFrameCallback mediaTime samples into an approximate FPS.
 * Invalid samples and seek-sized gaps establish a new baseline but never
 * influence the estimate. The estimate is the reciprocal median of the six to
 * eight most recent valid presentation intervals.
 */
export function updateVideoFrameRateEstimator(
	state: VideoFrameRateEstimatorState,
	mediaTime: number,
	presentedFrames?: number,
): VideoFrameRateEstimatorState {
	if (!Number.isFinite(mediaTime)) {
		return state;
	}
	const frameCount =
		presentedFrames !== undefined &&
		Number.isSafeInteger(presentedFrames) &&
		presentedFrames >= 0
			? presentedFrames
			: null;
	if (state.lastMediaTime === null) {
		return {
			...state,
			lastMediaTime: mediaTime,
			lastPresentedFrames: frameCount,
		};
	}

	const elapsed = mediaTime - state.lastMediaTime;
	const frameDelta =
		frameCount !== null && state.lastPresentedFrames != null
			? frameCount - state.lastPresentedFrames
			: 1;
	if (elapsed <= 0 || elapsed > MAX_FRAME_INTERVAL_SECONDS || frameDelta <= 0) {
		return {
			approximateFps: null,
			intervals: [],
			lastMediaTime: mediaTime,
			lastPresentedFrames: frameCount,
		};
	}

	// Android can present several frames between main-thread callbacks. Count
	// those frames instead of reporting the callback frequency as the video FPS.
	const interval = elapsed / frameDelta;
	const intervals = [...state.intervals, interval].slice(
		-MAX_FRAME_RATE_INTERVALS,
	);
	return {
		approximateFps:
			intervals.length >= MIN_FRAME_RATE_INTERVALS
				? 1 / getMedian(intervals)
				: null,
		intervals,
		lastMediaTime: mediaTime,
		lastPresentedFrames: frameCount,
	};
}

export function formatApproximateFrameRate(
	framesPerSecond: number | null,
): string | null {
	if (
		framesPerSecond === null ||
		!Number.isFinite(framesPerSecond) ||
		framesPerSecond <= 0
	) {
		return null;
	}
	const rounded = Number(framesPerSecond.toFixed(2));
	return `≈ ${rounded} FPS`;
}

function getMedian(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const midpoint = Math.floor(sorted.length / 2);
	const upper = sorted[midpoint];
	if (upper === undefined) {
		return Number.NaN;
	}
	if (sorted.length % 2 === 1) {
		return upper;
	}
	const lower = sorted[midpoint - 1];
	return lower === undefined ? upper : (lower + upper) / 2;
}
