import { Platform, type App, type TFile } from 'obsidian';
import {
	getEncodedImageDimensions,
	getMediaMimeType,
	type ImageDimensions,
} from './media-utils';
import type { GalleryMedia } from './types';
import type { VideoTileMetadata } from './video-metadata';
import { createVideoPreview } from './video-preview';
import { isRectVisibleWithinRoot, type RectLike } from './visibility';

type LazyMediaElement = HTMLImageElement | HTMLVideoElement;

interface LazyMediaState {
	attachedThumbnailKey: string | null;
	item: GalleryMedia;
	loading: boolean;
	nativeVideoFallback: boolean;
	nativeVideoCleanup: (() => void) | null;
	onAspectRatio?: (ratio: number) => void;
	onVideoMetadata?: (metadata: VideoTileMetadata) => void;
	queued: boolean;
	videoAbortController: AbortController | null;
	videoPreviewCancelled: boolean;
	visible: boolean;
}

interface ThumbnailEntry {
	aspectRatio: number;
	references: number;
	url: string;
	videoMetadata?: VideoTileMetadata;
}

interface ThumbnailResult {
	aspectRatio: number;
	key: string;
	url: string;
	videoMetadata?: VideoTileMetadata;
}

export interface LazyMediaLoaderOptions {
	cacheEntries?: number;
	concurrency?: number;
	imageRootMargin?: string;
	manualMarginPx?: number;
	thumbnailWidth?: number;
	videoRootMargin?: string;
}

const DEFAULT_THUMBNAIL_WIDTH = 384;
const MAX_MOBILE_FALLBACK_PIXELS = 24_000_000;

export class LazyMediaLoader {
	private activeJobs = 0;
	private readonly cache = new Map<string, ThumbnailEntry>();
	private readonly cacheEntries: number;
	private readonly concurrency: number;
	private disposed = false;
	private readonly imageObserver: IntersectionObserver | null;
	private readonly imageRootMargin: string;
	private readonly inflight = new Map<string, Promise<ThumbnailResult>>();
	private readonly pendingThumbnailReferences = new Map<string, number>();
	private manualFrame: number | null = null;
	private readonly manualMarginPx: number;
	private readonly mediaStates = new Map<LazyMediaElement, LazyMediaState>();
	private readonly queue: HTMLImageElement[] = [];
	private readonly root: Element;
	private readonly thumbnailWidth: number;
	private readonly videoObserver: IntersectionObserver | null;
	private readonly videoRootMargin: string;

	constructor(
		private readonly app: App,
		root: Element,
		options: LazyMediaLoaderOptions = {},
	) {
		this.root = root;
		this.cacheEntries = options.cacheEntries ?? (Platform.isMobile ? 64 : 128);
		this.concurrency = options.concurrency ?? (Platform.isMobile ? 1 : 3);
		this.manualMarginPx = options.manualMarginPx ?? 144;
		this.thumbnailWidth =
			options.thumbnailWidth ?? DEFAULT_THUMBNAIL_WIDTH;
		this.imageRootMargin = options.imageRootMargin ?? '144px 0px';
		this.videoRootMargin = options.videoRootMargin ?? '32px 0px';
		this.imageObserver = this.createObserver(this.imageRootMargin);
		this.videoObserver = this.createObserver(this.videoRootMargin);

		if (!this.imageObserver || !this.videoObserver) {
			this.root.addEventListener('scroll', this.scheduleManualCheck, {
				passive: true,
			});
			this.root.win.addEventListener('resize', this.scheduleManualCheck, {
				passive: true,
			});
		}
	}

	observe(
		media: LazyMediaElement,
		item: GalleryMedia,
		onAspectRatio?: (ratio: number) => void,
		onVideoMetadata?: (metadata: VideoTileMetadata) => void,
	): void {
		if (this.disposed) {
			return;
		}
		this.unobserve(media);
		const state: LazyMediaState = {
			attachedThumbnailKey: null,
			item,
			loading: false,
			nativeVideoFallback: false,
			nativeVideoCleanup: null,
			onAspectRatio,
			onVideoMetadata,
			queued: false,
			videoAbortController: null,
			videoPreviewCancelled: false,
			visible: false,
		};
		this.mediaStates.set(media, state);

		const observer = item.kind === 'video'
			? this.videoObserver
			: this.imageObserver;
		if (observer) {
			observer.observe(media);
			this.scheduleManualCheck();
			return;
		}
		this.scheduleManualCheck();
	}

	refreshVisibility(): void {
		this.scheduleManualCheck();
	}

	unobserve(media: LazyMediaElement): void {
		const state = this.mediaStates.get(media);
		if (!state) {
			return;
		}
		this.imageObserver?.unobserve(media);
		this.videoObserver?.unobserve(media);
		state.visible = false;
		this.unload(media, state);
		this.mediaStates.delete(media);
	}

	disconnect(): void {
		this.disposed = true;
		this.imageObserver?.disconnect();
		this.videoObserver?.disconnect();
		this.root.removeEventListener('scroll', this.scheduleManualCheck);
		this.root.win.removeEventListener('resize', this.scheduleManualCheck);
		if (this.manualFrame !== null) {
			this.root.win.cancelAnimationFrame(this.manualFrame);
			this.manualFrame = null;
		}
		this.queue.length = 0;
		for (const [media, state] of this.mediaStates) {
			state.visible = false;
			this.unload(media, state);
		}
		this.mediaStates.clear();
		for (const entry of this.cache.values()) {
			this.getUrlApi().revokeObjectURL(entry.url);
		}
		this.cache.clear();
	}

	private createObserver(rootMargin: string): IntersectionObserver | null {
		const rootWindow = this.root.win as Window & {
			IntersectionObserver?: typeof IntersectionObserver;
		};
		const Observer = rootWindow.IntersectionObserver;
		if (!Observer) {
			return null;
		}
		return new Observer(
			(entries) => {
				for (const entry of entries) {
					const media = entry.target as LazyMediaElement;
					this.setVisibility(media, entry.isIntersecting);
				}
			},
			{ root: this.root, rootMargin },
		);
	}

	private readonly scheduleManualCheck = (): void => {
		if (this.disposed || this.manualFrame !== null) {
			return;
		}
		this.manualFrame = this.root.win.requestAnimationFrame(() => {
			this.manualFrame = null;
			this.checkVisibleManually();
		});
	};

	private checkVisibleManually(): void {
		const rootRect = this.root.getBoundingClientRect();
		// The first/manual pass must use the same preload bands as the observers.
		// Otherwise it starts offscreen videos which the video observer unloads
		// immediately afterwards, repeatedly opening mobile decoder resources.
		const imageBounds = this.expandManualBounds(rootRect, this.imageRootMargin);
		const videoBounds = this.expandManualBounds(rootRect, this.videoRootMargin);
		for (const [media, state] of this.mediaStates) {
			const rect = media.getBoundingClientRect();
			const visible = isRectVisibleWithinRoot(
				state.item.kind === 'video' ? videoBounds : imageBounds,
				rect,
				0,
			);
			this.setVisibility(media, visible);
		}
	}

	private expandManualBounds(root: RectLike, margin: string): RectLike {
		const values = margin.trim().split(/\s+/u).map((value) => {
			if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)$/u.test(value)) {
				return Number.NaN;
			}
			const pixels = Number.parseFloat(value);
			// IntersectionObserver percentages on every side use the root width.
			return value.endsWith('%') ? (pixels * root.width) / 100 : pixels;
		});
		const valid = values.length >= 1 && values.length <= 4 &&
			values.every(Number.isFinite);
		const top = valid ? (values[0] ?? 0) : this.manualMarginPx;
		const right = valid ? (values[1] ?? top) : this.manualMarginPx;
		const bottom = valid ? (values[2] ?? top) : this.manualMarginPx;
		const left = valid ? (values[3] ?? right) : this.manualMarginPx;
		// Keep the original width/height so a collapsed root stays invisible even
		// after its preload margins have been applied.
		return {
			width: root.width,
			height: root.height,
			top: root.top - top,
			right: root.right + right,
			bottom: root.bottom + bottom,
			left: root.left - left,
		};
	}

	private setVisibility(media: LazyMediaElement, visible: boolean): void {
		const state = this.mediaStates.get(media);
		if (!state || state.visible === visible) {
			return;
		}
		state.visible = visible;
		if (!visible) {
			this.unload(media, state);
			return;
		}
		if (media.instanceOf(HTMLVideoElement)) {
			this.loadVideo(media, state);
			return;
		}
		this.enqueueImage(media, state);
	}

	private enqueueImage(
		media: HTMLImageElement,
		state: LazyMediaState,
	): void {
		if (state.queued || state.loading || media.hasAttribute('src')) {
			return;
		}
		state.queued = true;
		this.queue.push(media);
		this.drainQueue();
	}

	private takeNearestQueuedImage(): HTMLImageElement | undefined {
		if (this.queue.length < 2) {
			return this.queue.shift();
		}
		// Measure each queued tile once, only when a worker becomes available.
		// Sorting after every intersection callback repeatedly forces layout while
		// a mobile user scrolls through a long note.
		const rootRect = this.root.getBoundingClientRect();
		let closestIndex = 0;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const [index, media] of this.queue.entries()) {
			const mediaRect = media.getBoundingClientRect();
			const deltaX =
				(mediaRect.left + mediaRect.right - rootRect.left - rootRect.right) / 2;
			const deltaY =
				(mediaRect.top + mediaRect.bottom - rootRect.top - rootRect.bottom) / 2;
			const distance = deltaX * deltaX + deltaY * deltaY;
			if (distance < closestDistance) {
				closestDistance = distance;
				closestIndex = index;
			}
		}
		return this.queue.splice(closestIndex, 1)[0];
	}

	private drainQueue(): void {
		while (
			!this.disposed &&
			this.activeJobs < this.concurrency &&
			this.queue.length > 0
		) {
			const media = this.takeNearestQueuedImage();
			if (!media) {
				break;
			}
			const state = this.mediaStates.get(media);
			if (!state) {
				continue;
			}
			state.queued = false;
			if (!state.visible || state.loading || media.hasAttribute('src')) {
				continue;
			}
			this.activeJobs += 1;
			state.loading = true;
			void this.loadImage(media, state).finally(() => {
				state.loading = false;
				this.activeJobs -= 1;
				if (state.videoPreviewCancelled) {
					state.videoPreviewCancelled = false;
					if (!this.disposed && state.visible && this.mediaStates.get(media) === state) {
						this.enqueueImage(media, state);
					}
				}
				this.drainQueue();
			});
		}
	}

	private async loadImage(
		media: HTMLImageElement,
		state: LazyMediaState,
	): Promise<void> {
		const thumbnailKey = this.getThumbnailKey(state.item);
		this.pendingThumbnailReferences.set(
			thumbnailKey, (this.pendingThumbnailReferences.get(thumbnailKey) ?? 0) + 1,
		);
		const controller = state.item.kind === 'video'
			? new (this.root.win as Window & { AbortController: typeof AbortController }).AbortController()
			: null;
		state.videoAbortController = controller;
		try {
			if (state.nativeVideoFallback) {
				await this.loadNativeVideoFallback(media, state);
				return;
			}
			const result = controller
				? await this.getVideoThumbnail(state.item, thumbnailKey, controller.signal, (metadata) => {
					if (!this.disposed && state.visible && this.mediaStates.get(media) === state) {
						state.onVideoMetadata?.(metadata);
					}
				})
				: await this.getThumbnail(state.item.file, thumbnailKey);
			if (
				this.disposed ||
				!state.visible ||
				this.mediaStates.get(media) !== state
			) {
				return;
			}
			this.attachThumbnail(media, state, result);
			state.onAspectRatio?.(result.aspectRatio);
			if (result.videoMetadata) state.onVideoMetadata?.(result.videoMetadata);
		} catch {
			if (
				!this.disposed &&
				!controller?.signal.aborted &&
				state.visible &&
				this.mediaStates.get(media) === state
			) {
				if (Platform.isIosApp && state.item.kind === 'video') {
					// Some WKWebView/local codec combinations can render native video
					// but cannot export its frame to canvas. Keep the Android still path;
					// retry iOS using the original native preview only once per visibility.
					state.nativeVideoFallback = true;
					await this.loadNativeVideoFallback(media, state);
				} else {
					this.getMediaContainer(media)?.addClass('has-error');
				}
			}
		} finally {
			state.videoAbortController = null;
			const pending = (this.pendingThumbnailReferences.get(thumbnailKey) ?? 1) - 1;
			if (pending > 0) this.pendingThumbnailReferences.set(thumbnailKey, pending);
			else this.pendingThumbnailReferences.delete(thumbnailKey);
			this.evictCache();
		}
	}

	private loadVideo(
		media: HTMLVideoElement,
		state: LazyMediaState,
	): void {
		this.getMediaContainer(media)?.removeClass('has-error');
		media.src = state.item.resourceUrl;
		media.load();
	}

	private async loadNativeVideoFallback(media: HTMLImageElement, state: LazyMediaState): Promise<void> {
		if (this.disposed || !state.visible || state.nativeVideoCleanup) return;
		const container = this.getMediaContainer(media);
		if (!media.parentElement) {
			container?.addClass('has-error');
			return;
		}
		const win = this.root.win as Window & { createEl: typeof createEl };
		const video = win.createEl('video');
		video.className = `${media.className} section-gallery-native-video-preview`;
		video.setAttr('aria-hidden', 'true');
		video.muted = true;
		video.defaultMuted = true;
		video.playsInline = true;
		video.controls = false;
		video.autoplay = false;
		video.preload = 'metadata';
		let timer: number | null = null;
		let seekRequested = false;
		let releaseSlot!: () => void;
		const readyOrClosed = new Promise<void>(resolve => { releaseSlot = resolve; });
		const isActive = (): boolean => !this.disposed && state.visible &&
			this.mediaStates.get(media) === state && state.nativeVideoCleanup === cleanup;
		const cleanup = (): void => {
			if (timer !== null) win.clearTimeout(timer);
			timer = null;
			video.onloadedmetadata = null;
			video.onloadeddata = null;
			video.oncanplay = null;
			video.onseeked = null;
			video.onerror = null;
			video.pause();
			video.removeAttribute('src');
			video.load();
			video.remove();
			media.removeClass('section-gallery-native-preview-anchor');
			state.nativeVideoCleanup = null;
			releaseSlot();
		};
		const fail = (): void => {
			if (!isActive()) return;
			cleanup();
			container?.removeClass('is-loaded');
			container?.addClass('has-error');
		};
		const ready = (): void => {
			if (!isActive() || video.readyState < 1) return;
			state.onVideoMetadata?.({ durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight });
			if (video.readyState >= 2 && !video.seeking && video.videoWidth > 0 && video.videoHeight > 0) {
				if (timer !== null) win.clearTimeout(timer);
				timer = null;
				state.onAspectRatio?.(video.videoWidth / video.videoHeight);
				container?.removeClass('has-error');
				container?.addClass('is-loaded');
				releaseSlot();
			} else if (!seekRequested && Number.isFinite(video.duration) && video.duration > 0) {
				try {
					video.currentTime = Math.min(0.001, video.duration / 2);
					seekRequested = true;
				} catch { /* Metadata may arrive before this resource becomes seekable. */ }
			}
		};
		state.nativeVideoCleanup = cleanup;
		video.onloadedmetadata = ready;
		video.onloadeddata = ready;
		video.oncanplay = ready;
		video.onseeked = ready;
		video.onerror = fail;
		media.addClass('section-gallery-native-preview-anchor');
		// Keep native stills first so filmstrip morphs target the visible media,
		// while the original image remains the loader's observed layout anchor.
		media.insertAdjacentElement('beforebegin', video);
		container?.removeClass('has-error');
		timer = win.setTimeout(fail, 8000);
		try {
			video.src = state.item.resourceUrl;
			video.load();
		} catch { fail(); }
		// Keep first-frame loading in the same bounded queue as canvas extraction.
		// Offscreen teardown also settles this promise and releases its worker.
		return readyOrClosed;
	}

	private unload(media: LazyMediaElement, state: LazyMediaState): void {
		state.nativeVideoCleanup?.();
		if (state.videoAbortController) {
			state.videoPreviewCancelled = true;
			state.videoAbortController.abort();
		}
		if (state.queued && !media.instanceOf(HTMLVideoElement)) {
			const queueIndex = this.queue.indexOf(media);
			if (queueIndex !== -1) {
				this.queue.splice(queueIndex, 1);
			}
		}
		state.queued = false;
		if (media.instanceOf(HTMLVideoElement)) {
			media.pause();
			media.removeAttribute('src');
			media.load();
		} else {
			this.releaseThumbnail(media, state);
		}
		this.getMediaContainer(media)?.removeClass('is-loaded');
	}

	private attachThumbnail(
		media: HTMLImageElement,
		state: LazyMediaState,
		result: ThumbnailResult,
	): void {
		const entry = this.cache.get(result.key);
		if (!entry) {
			return;
		}
		entry.references += 1;
		this.releaseThumbnail(media, state);
		state.attachedThumbnailKey = result.key;
		this.getMediaContainer(media)?.removeClass('has-error');
		media.src = result.url;
	}

	private getMediaContainer(media: LazyMediaElement): HTMLElement | null {
		return media.closest(
			'.section-gallery-tile, .section-gallery-filmstrip-item',
		);
	}

	private releaseThumbnail(
		media: HTMLImageElement,
		state: LazyMediaState,
	): void {
		if (state.attachedThumbnailKey) {
			const entry = this.cache.get(state.attachedThumbnailKey);
			if (entry) {
				entry.references = Math.max(0, entry.references - 1);
			}
			state.attachedThumbnailKey = null;
		}
		media.removeAttribute('src');
		this.evictCache();
	}

	private getThumbnailKey(item: GalleryMedia): string {
		const file = item.file;
		return [
			item.kind,
			file.path,
			file.stat.mtime,
			file.stat.size,
			this.thumbnailWidth,
		].join(':');
	}

	private async getThumbnail(file: TFile, key: string): Promise<ThumbnailResult> {
		const cached = this.cache.get(key);
		if (cached) {
			this.cache.delete(key);
			this.cache.set(key, cached);
			return { key, url: cached.url, aspectRatio: cached.aspectRatio };
		}

		const pending = this.inflight.get(key);
		if (pending) {
			return pending;
		}
		const promise = this.generateThumbnail(file, key);
		this.inflight.set(key, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(key);
		}
	}

	private async getVideoThumbnail(
		item: GalleryMedia,
		key: string,
		signal: AbortSignal,
		onMetadata: (metadata: VideoTileMetadata) => void,
	): Promise<ThumbnailResult> {
		const cached = this.cache.get(key);
		if (cached) {
			this.cache.delete(key);
			this.cache.set(key, cached);
			return { ...cached, key };
		}
		const preview = await createVideoPreview({
			document: this.root.doc,
			maxSize: this.thumbnailWidth,
			onMetadata,
			resourceUrl: item.resourceUrl,
			signal,
		});
		this.assertActive();
		if (signal.aborted) throw new Error('Video preview cancelled.');
		// Independent callers may finish the same video concurrently on desktop.
		// Reuse the existing URL without replacing an attached cache entry.
		const completed = this.cache.get(key);
		if (completed) return { ...completed, key };
		const entry: ThumbnailEntry = {
			aspectRatio: preview.metadata.width / preview.metadata.height,
			references: 0,
			url: this.getUrlApi().createObjectURL(preview.blob),
			videoMetadata: preview.metadata,
		};
		this.cache.set(key, entry);
		this.evictCache(key);
		return { ...entry, key };
	}

	private async generateThumbnail(
		file: TFile,
		key: string,
	): Promise<ThumbnailResult> {
		const bytes = await this.app.vault.readBinary(file);
		this.assertActive();
		const BlobConstructor = (
			this.root.win as Window & { Blob: typeof Blob }
		).Blob;
		const source = new BlobConstructor([bytes], {
			type: getMediaMimeType(file.extension),
		});
		const dimensions = getEncodedImageDimensions(bytes, file.extension);
		const thumbnail = await this.renderThumbnail(source, dimensions);
		this.assertActive();
		const url = this.getUrlApi().createObjectURL(thumbnail.blob);
		this.cache.set(key, {
			aspectRatio: thumbnail.aspectRatio,
			references: 0,
			url,
		});
		this.evictCache(key);
		return { aspectRatio: thumbnail.aspectRatio, key, url };
	}

	private async renderThumbnail(
		source: Blob,
		dimensions: ImageDimensions | null,
	): Promise<{ aspectRatio: number; blob: Blob }> {
		const rootWindow = this.root.win as Window & {
			createImageBitmap?: typeof createImageBitmap;
		};
		if (rootWindow.createImageBitmap) {
			try {
				const target = this.fitThumbnailSize(dimensions);
				const bitmap = await rootWindow.createImageBitmap(source, {
					resizeQuality: 'medium',
					// With an unknown header ratio, one resize dimension lets the
					// decoder preserve the image's intrinsic aspect ratio.
					...(dimensions ? { resizeHeight: target.height } : {}),
					resizeWidth: target.width,
				});
				try {
					this.assertActive();
					const bitmapTarget = this.fitThumbnailSize(bitmap);
					const canvas = this.drawToCanvas(
						bitmap,
						bitmapTarget.width,
						bitmapTarget.height,
					);
					const blob = await this.canvasToBlob(canvas);
					return {
						aspectRatio:
							dimensions?.width && dimensions.height
								? dimensions.width / dimensions.height
								: bitmap.width / bitmap.height,
						blob,
					};
				} finally {
					bitmap.close();
				}
			} catch {
				this.assertActive();
				return this.renderThumbnailWithImage(source, dimensions);
			}
		}
		return this.renderThumbnailWithImage(source, dimensions);
	}

	private async renderThumbnailWithImage(
		source: Blob,
		dimensions: ImageDimensions | null,
	): Promise<{ aspectRatio: number; blob: Blob }> {
		this.assertActive();
		if (
			Platform.isMobile &&
			(!dimensions ||
				dimensions.width * dimensions.height > MAX_MOBILE_FALLBACK_PIXELS)
		) {
			throw new Error('This image is too large to thumbnail safely.');
		}
		const sourceUrl = this.getUrlApi().createObjectURL(source);
		const rootWindow = this.root.doc.win as Window & {
			createEl: typeof createEl;
		};
		const image = rootWindow.createEl('img');
		image.decoding = 'async';
		image.src = sourceUrl;
		try {
			await image.decode();
			this.assertActive();
			const target = this.fitThumbnailSize({
				height: image.naturalHeight,
				width: image.naturalWidth,
			});
			const canvas = this.drawToCanvas(
				image,
				target.width,
				target.height,
			);
			const blob = await this.canvasToBlob(canvas);
			return {
				aspectRatio: image.naturalWidth / image.naturalHeight,
				blob,
			};
		} finally {
			image.removeAttribute('src');
			this.getUrlApi().revokeObjectURL(sourceUrl);
		}
	}

	private fitThumbnailSize(
		dimensions: ImageDimensions | null,
	): ImageDimensions {
		if (!dimensions) {
			return { height: this.thumbnailWidth, width: this.thumbnailWidth };
		}
		const scale = Math.min(
			1,
			this.thumbnailWidth / dimensions.width,
			this.thumbnailWidth / dimensions.height,
		);
		return {
			height: Math.max(1, Math.round(dimensions.height * scale)),
			width: Math.max(1, Math.round(dimensions.width * scale)),
		};
	}

	private drawToCanvas(
		source: CanvasImageSource,
		width: number,
		height: number,
	): HTMLCanvasElement {
		const rootWindow = this.root.doc.win as Window & {
			createEl: typeof createEl;
		};
		const canvas = rootWindow.createEl('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) {
			throw new Error('Canvas is unavailable.');
		}
		context.drawImage(source, 0, 0, width, height);
		return canvas;
	}

	private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
		return new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('Could not encode thumbnail.'));
					}
				},
				'image/webp',
				0.76,
			);
		}).finally(() => {
			// Release the pixel backing store on failed encodes as well.
			canvas.width = 1;
			canvas.height = 1;
		});
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error('Thumbnail loader is closed.');
		}
	}

	private getUrlApi(): typeof URL {
		return (this.root.win as Window & { URL: typeof URL }).URL;
	}

	private evictCache(protectedKey?: string): void {
		while (this.cache.size > this.cacheEntries) {
			const candidate = [...this.cache].find(
				([key, entry]) =>
					key !== protectedKey && entry.references === 0 &&
					!this.pendingThumbnailReferences.has(key),
			);
			if (!candidate) {
				return;
			}
			const [key, entry] = candidate;
			this.cache.delete(key);
			this.getUrlApi().revokeObjectURL(entry.url);
		}
	}
}
