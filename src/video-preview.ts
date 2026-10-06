import type { VideoTileMetadata } from './video-metadata';

export interface VideoPreview {
	blob: Blob;
	metadata: VideoTileMetadata;
}

export interface VideoPreviewOptions {
	document: Document;
	maxSize: number;
	onMetadata?: (metadata: VideoTileMetadata) => void;
	resourceUrl: string;
	signal: AbortSignal;
	timeoutMs?: number;
}

/**
 * Decodes one visible thumbnail through the browser's ranged media loader.
 * No playback, whole-file vault reads, or long-lived video decoder is needed.
 * The resulting image also avoids Chromium's native controls-less video poster.
 */
export function createVideoPreview(options: VideoPreviewOptions): Promise<VideoPreview> {
	const { document, signal } = options;
	const win = document.defaultView;
	if (!win || signal.aborted) {
		return Promise.reject(new Error('Video preview cancelled.'));
	}
	const rootWindow = document.win as Window & { createEl: typeof createEl };
	return new Promise((resolve, reject) => {
		const video = rootWindow.createEl('video');
		let canvas: HTMLCanvasElement | null = null;
		let finished = false;
		let encoding = false;
		let stopped = false;
		let seekRequested = false;
		let metadata: VideoTileMetadata | null = null;
		let timeout: number | null = null;
		const stopVideo = (): void => {
			if (stopped) return;
			stopped = true;
			video.removeEventListener('loadedmetadata', handleReady);
			video.removeEventListener('durationchange', handleReady);
			video.removeEventListener('loadeddata', handleReady);
			video.removeEventListener('canplay', handleReady);
			video.removeEventListener('seeked', handleReady);
			video.removeEventListener('progress', handleReady);
			video.removeEventListener('error', handleError);
			video.pause();
			video.removeAttribute('src');
			video.load();
		};
		const cleanup = (): void => {
			if (timeout !== null) win.clearTimeout(timeout);
			timeout = null;
			signal.removeEventListener('abort', handleAbort);
			stopVideo();
			if (canvas) {
				canvas.width = 1;
				canvas.height = 1;
			}
		};
		const fail = (message: string): void => {
			if (finished) return;
			finished = true;
			cleanup();
			reject(new Error(message));
		};
		const handleAbort = (): void => fail('Video preview cancelled.');
		const handleError = (): void => fail('This device could not decode the video preview.');
		const handleReady = (): void => {
			if (finished || encoding || signal.aborted) return;
			if (video.readyState < 1) return;
			if (!metadata || metadata.width !== video.videoWidth || metadata.height !== video.videoHeight ||
				!Object.is(metadata.durationSeconds, video.duration)) {
				metadata = {
					durationSeconds: video.duration,
					width: video.videoWidth,
					height: video.videoHeight,
				};
				options.onMetadata?.(metadata);
			}
			if (video.readyState < 2 || video.seeking) {
				if (!seekRequested && Number.isFinite(video.duration) && video.duration > 0) {
					try {
						video.currentTime = Math.min(0.001, video.duration / 2);
						seekRequested = true;
					} catch {
						// Some Android local resources become seekable after metadata.
						// A later canplay/progress event may retry; timeout stays bounded.
					}
				}
				return;
			}
			if (metadata.width <= 0 || metadata.height <= 0) return;
			encoding = true;
			try {
				const size = Math.max(1, options.maxSize);
				const scale = Math.min(1, size / metadata.width, size / metadata.height);
				canvas = rootWindow.createEl('canvas');
				canvas.width = Math.max(1, Math.round(metadata.width * scale));
				canvas.height = Math.max(1, Math.round(metadata.height * scale));
				const context = canvas.getContext('2d');
				if (!context) {
					fail('Canvas is unavailable for this video preview.');
					return;
				}
				context.drawImage(video, 0, 0, canvas.width, canvas.height);
				// The pixels are now owned by the canvas; stop buffering immediately.
				stopVideo();
				const capturedMetadata = metadata;
				canvas.toBlob((blob) => {
					if (finished) return;
					if (!blob || signal.aborted) {
						fail('Could not encode video preview.');
						return;
					}
					finished = true;
					cleanup();
					resolve({ blob, metadata: capturedMetadata });
				}, 'image/webp', 0.76);
			} catch {
				fail('This device could not capture the video preview.');
			}
		};
		video.muted = true;
		video.defaultMuted = true;
		video.playsInline = true;
		video.controls = false;
		video.autoplay = false;
		video.crossOrigin = 'anonymous';
		// Metadata-only preload is insufficient for a decoded frame on Android.
		// Visibility, the shared job limit, timeout and stopVideo bound this load.
		video.preload = 'auto';
		video.addEventListener('loadedmetadata', handleReady);
		video.addEventListener('durationchange', handleReady);
		video.addEventListener('loadeddata', handleReady);
		video.addEventListener('canplay', handleReady);
		video.addEventListener('seeked', handleReady);
		video.addEventListener('progress', handleReady);
		video.addEventListener('error', handleError);
		signal.addEventListener('abort', handleAbort, { once: true });
		timeout = win.setTimeout(() => fail('Video preview timed out.'), options.timeoutMs ?? 8000);
		try {
			video.src = options.resourceUrl;
			video.load();
		} catch {
			handleError();
		}
	});
}
