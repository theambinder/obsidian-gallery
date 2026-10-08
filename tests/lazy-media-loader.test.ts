import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { App } from 'obsidian';
import type { GalleryMedia } from '../src/types';
import type { LazyMediaLoaderOptions } from '../src/lazy-media-loader';
import type { VideoTileMetadata } from '../src/video-metadata';

// Obsidian supplies its runtime module in the app. Bundle only this loader with
// a platform stub so lifecycle tests exercise its real public API under Node.
async function buildLoader(ios: boolean, mobile = true) {
const bundle = await build({
	absWorkingDir: dirname(fileURLToPath(new URL('../package.json', import.meta.url))),
	bundle: true,
	banner: { js: 'class HTMLVideoElement {}' },
	entryPoints: ['src/lazy-media-loader.ts'],
	format: 'esm',
	platform: 'node',
	write: false,
	plugins: [{
		name: 'obsidian-test-platform',
		setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({
				path: 'obsidian', namespace: 'test-platform',
			}));
			builder.onLoad({ filter: /.*/, namespace: 'test-platform' }, () => ({
				contents: `export const Platform = { isMobile: ${mobile}, isIosApp: ${ios} };`,
			}));
		},
	}],
});
const output = bundle.outputFiles[0];
assert.ok(output);
// The import contains only the locally compiled entrypoint above, never input.
// eslint-disable-next-line no-unsanitized/method -- Test imports trusted local compiler output only.
return await import(
	`data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`
) as typeof import('../src/lazy-media-loader');
}

const { LazyMediaLoader } = await buildLoader(false);
const { LazyMediaLoader: IosLazyMediaLoader } = await buildLoader(true);
const { LazyMediaLoader: DesktopLazyMediaLoader } = await buildLoader(false, false);

class FakeImage {
	readonly attributes = new Map<string, string>();
	readonly classes = new Set<string>();
	readonly containerClasses = new Set<string>();
	readonly nativeVideos: PreviewVideo[] = [];
	className = 'section-gallery-thumbnail';
	parentElement: object | null = {};
	measurements = 0;
	top = 0;
	left = 0;
	isVideo = false;
	loadCalls = 0;
	srcAssignments = 0;
	get src(): string { return this.attributes.get('src') ?? ''; }
	set src(value: string) { this.srcAssignments += 1; this.attributes.set('src', value); }
	hasAttribute(name: string): boolean { return this.attributes.has(name); }
	removeAttribute(name: string): void { this.attributes.delete(name); }
	instanceOf(): boolean { return this.isVideo; }
	pause(): void {}
	load(): void { this.loadCalls += 1; }
	addClass(name: string): void { this.classes.add(name); }
	removeClass(name: string): void { this.classes.delete(name); }
	insertAdjacentElement(position: string, video: PreviewVideo): void {
		assert.equal(position, 'beforebegin', 'Native still must be the first thumbnail for filmstrip morphing');
		this.nativeVideos.push(video);
	}
	closest() {
		return {
			addClass: (name: string) => this.containerClasses.add(name),
			removeClass: (name: string) => this.containerClasses.delete(name),
			hasClass: (name: string) => this.containerClasses.has(name),
		};
	}
	getBoundingClientRect() {
		this.measurements += 1;
		return {
			left: this.left, right: this.left + 100, top: this.top, bottom: this.top + 100,
			width: 100, height: 100,
		};
	}
}

class PreviewVideo extends EventTarget {
	className = '';
	controls = false;
	autoplay = false;
	muted = false;
	defaultMuted = false;
	playsInline = false;
	preload = '';
	removed = false;
	playCalls = 0;
	onloadedmetadata: (() => void) | null = null;
	onloadeddata: (() => void) | null = null;
	oncanplay: (() => void) | null = null;
	onseeked: (() => void) | null = null;
	onerror: (() => void) | null = null;
	currentTime = 0;
	duration = 10;
	loadCalls = 0;
	pauseCalls = 0;
	readyState = 0;
	seeking = false;
	src = '';
	videoHeight = 1080;
	videoWidth = 1920;
	load(): void { this.loadCalls += 1; }
	pause(): void { this.pauseCalls += 1; }
	play(): Promise<void> { this.playCalls += 1; return Promise.resolve(); }
	setAttr(): void {}
	remove(): void { this.removed = true; }
	removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
	emit(name: string): void {
		this.dispatchEvent(new Event(name));
		const handler = ({ loadedmetadata: this.onloadedmetadata, loadeddata: this.onloadeddata, canplay: this.oncanplay, seeked: this.onseeked, error: this.onerror } as Record<string, (() => void) | null>)[name];
		handler?.();
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

function pngBytes(width = 1920, height = 1080): ArrayBuffer {
	const bytes = new ArrayBuffer(24);
	const view = new DataView(bytes);
	view.setUint32(0, 0x89504e47);
	view.setUint32(4, 0x0d0a1a0a);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

function item(path: string, extension = 'png'): GalleryMedia {
	return {
		file: { path, extension, stat: { mtime: 1, size: 24 } },
		kind: extension === 'mp4' ? 'video' : 'image', resourceUrl: path,
	} as GalleryMedia;
}

function harness(concurrency?: number, options: LazyMediaLoaderOptions = {}, ios = false, mobile = true) {
	const reads: string[] = [];
	const pendingReads = new Map<string, ReturnType<typeof deferred<ArrayBuffer>>>();
	const bitmapOptions: ImageBitmapOptions[] = [];
	const bitmaps: { width: number; height: number; closed: boolean }[] = [];
	const canvases: { width: number; height: number }[] = [];
	const canvasBackingStores: { width: number; height: number }[] = [];
	const pendingEncodes: BlobCallback[] = [];
	const createdUrls: string[] = [];
	const createdBlobs: Blob[] = [];
	const revokedUrls: string[] = [];
	const encodeRequests: { type: string; quality: number | undefined }[] = [];
	const observers: { emit(image: FakeImage, visible: boolean): void; emitMany(images: FakeImage[], visible: boolean): void }[] = [];
	const previewVideos: PreviewVideo[] = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	let bitmapFactory: ((options: ImageBitmapOptions) => Promise<ImageBitmap>) | null = null;
	let objectUrls = 0;
	let deferEncodes = false;
	let thumbnailBytes = 9;
	let webpEncoderAvailable = true;
	let jpegBytes = 9;
	let jpegEncoderFails = false;
	let canvasOpaque = true;
	let alphaReadFails = false;
	let manualCheck: FrameRequestCallback | null = null;
	class FakeObserver {
		constructor(private callback: IntersectionObserverCallback) {
			observers.push(this);
		}
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
		emit(image: FakeImage, visible: boolean): void {
			this.emitMany([image], visible);
		}
		emitMany(images: FakeImage[], visible: boolean): void {
			this.callback(images.map(image =>
				({ target: image, isIntersecting: visible }) as unknown as IntersectionObserverEntry,
			), this as unknown as IntersectionObserver);
		}
	}
	const win = {
		Blob,
		AbortController,
		IntersectionObserver: FakeObserver,
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			manualCheck = callback;
			return 1;
		},
		cancelAnimationFrame: () => undefined,
		removeEventListener: () => undefined,
		setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
		clearTimeout: (id: number) => { timers.delete(id); },
		URL: {
			createObjectURL: (blob: Blob) => {
				const url = `blob:test-${++objectUrls}`;
				createdUrls.push(url);
				createdBlobs.push(blob);
				return url;
			},
			revokeObjectURL: (url: string) => { revokedUrls.push(url); },
		},
		createImageBitmap: async (_source: Blob, options: ImageBitmapOptions) => {
			bitmapOptions.push(options);
			if (bitmapFactory) return bitmapFactory(options);
			const bitmap = {
				width: options.resizeWidth ?? 384,
				height: options.resizeHeight ?? 128,
				closed: false,
				close() { this.closed = true; },
			};
			bitmaps.push(bitmap);
			return bitmap;
		},
		createEl: (tag: string) => {
			if (tag === 'video') {
				const video = new PreviewVideo();
				previewVideos.push(video);
				return video;
			}
			const canvas = {
				width: 0, height: 0,
				getContext: () => ({
					drawImage: () => undefined,
					getImageData: () => {
						if (alphaReadFails) throw new Error('Canvas inspection unavailable');
						const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255);
						if (!canvasOpaque) data[3] = 128;
						return { data };
					},
				}),
				toBlob(callback: BlobCallback, type = 'image/png', quality?: number) {
					canvases.push({ width: this.width, height: this.height });
					encodeRequests.push({ type, quality });
					const encodedType = type === 'image/webp' && !webpEncoderAvailable ? 'image/png' : type;
					const complete = () => callback(type === 'image/jpeg' && jpegEncoderFails ? null : new Blob([
						new Uint8Array(type === 'image/jpeg' ? jpegBytes : thumbnailBytes),
					], { type: encodedType }));
					if (deferEncodes) pendingEncodes.push(complete);
					else complete();
				},
			};
			canvasBackingStores.push(canvas);
			return canvas;
		},
	};
	const root = {
		win, doc: { win, defaultView: win },
		removeEventListener: () => undefined,
		getBoundingClientRect: () => ({
			left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100,
		}),
	};
	const app = {
		vault: {
			readBinary(file: { path: string }) {
				reads.push(file.path);
				const pending = deferred<ArrayBuffer>();
				pendingReads.set(file.path, pending);
				return pending.promise;
			},
		},
	};
	const loader = new (ios ? IosLazyMediaLoader : mobile ? LazyMediaLoader : DesktopLazyMediaLoader)(
		app as unknown as App, root as unknown as Element, { concurrency, ...options },
	);
	return {
		loader, reads, pendingReads, bitmapOptions, bitmaps, canvases, canvasBackingStores,
		createdUrls, createdBlobs, encodeRequests, pendingEncodes, revokedUrls, previewVideos, timers,
		deferEncoding() { deferEncodes = true; },
		completeEncoding() { pendingEncodes.shift()?.(new Blob([new Uint8Array(thumbnailBytes)])); },
		setThumbnailBytes(bytes: number) { thumbnailBytes = bytes; },
		usePngCanvasFallback(bytes: number, fallbackJpegBytes: number, opaque = true) {
			webpEncoderAvailable = false;
			thumbnailBytes = bytes;
			jpegBytes = fallbackJpegBytes;
			canvasOpaque = opaque;
		},
		failJpegEncoder() { jpegEncoderFails = true; },
		failAlphaRead() { alphaReadFails = true; },
		setBitmapFactory(factory: (options: ImageBitmapOptions) => Promise<ImageBitmap>) {
			bitmapFactory = factory;
		},
		observe(image: FakeImage, media: GalleryMedia, onRatio?: (ratio: number) => void, onMetadata?: (metadata: VideoTileMetadata) => void) {
			loader.observe(image as unknown as HTMLImageElement, media, onRatio, onMetadata);
		},
		show(image: FakeImage, visible = true) { observers[0]?.emit(image, visible); },
		showMany(images: FakeImage[], visible = true) { observers[0]?.emitMany(images, visible); },
		checkVisibility() {
			const callback = manualCheck;
			manualCheck = null;
			callback?.(0);
		},
	};
}

async function settle(): Promise<void> {
	await new Promise<void>((resolve) => { setImmediate(resolve); });
}

async function completeImage(h: ReturnType<typeof harness>, path: string, image: FakeImage): Promise<void> {
	const pending = h.pendingReads.get(path);
	assert.ok(pending, `Expected a vault read for ${path}`);
	pending.resolve(pngBytes());
	await settle();
	assert.ok(image.src.startsWith('blob:'));
	// Obsidian's thumbnail onload callback supplies this state in production.
	image.containerClasses.add('is-loaded');
}

void test('iOS canvas failure uses a bounded paused native preview without hiding the observed image geometry', async () => {
	const h = harness(1, {}, true);
	const image = new FakeImage();
	const metadata: VideoTileMetadata[] = [];
	h.observe(image, item('clip.mp4', 'mp4'), undefined, value => metadata.push(value));
	h.show(image);
	h.previewVideos[0]!.emit('error');
	await settle();
	const native = image.nativeVideos[0]!;
	assert.ok(native);
	assert.equal(native.className, 'section-gallery-thumbnail section-gallery-native-video-preview');
	assert.equal(image.classes.has('section-gallery-native-preview-anchor'), true);
	assert.equal(image.hasAttribute('hidden'), false);
	assert.equal(native.muted, true);
	assert.equal(native.playsInline, true);
	assert.equal(native.controls, false);
	assert.equal(native.autoplay, false);
	assert.equal(native.preload, 'metadata');
	native.readyState = 1;
	native.emit('loadedmetadata');
	assert.equal(native.currentTime, 0.001);
	assert.equal(image.containerClasses.has('is-loaded'), false, 'metadata alone is not a visible frame');
	assert.equal(metadata.at(-1)?.durationSeconds, 10);
	native.readyState = 2;
	native.emit('seeked');
	await settle();
	assert.equal(image.containerClasses.has('is-loaded'), true);
	assert.equal(h.timers.size, 0);
	assert.equal(native.playCalls, 0);
	assert.equal(h.reads.length, 0);
	h.show(image, false);
	assert.equal(native.src, '');
	assert.equal(native.removed, true);
	assert.equal(image.classes.has('section-gallery-native-preview-anchor'), false);
	assert.equal(native.onloadedmetadata, null);
	h.show(image);
	await settle();
	assert.equal(h.previewVideos.length, 3, 're-entry loads native once, without another canvas decoder attempt');
	const reentered = image.nativeVideos[1]!;
	h.loader.disconnect();
	assert.equal(reentered.src, '');
	assert.equal(reentered.removed, true);
	assert.equal(h.timers.size, 0);
});

void test('iOS native fallback retains its queue slot until frame, error or offscreen cleanup', async () => {
	const h = harness(1, {}, true);
	const first = new FakeImage();
	const second = new FakeImage();
	h.observe(first, item('first.mp4', 'mp4'));
	h.observe(second, item('second.mp4', 'mp4'));
	h.show(first);
	h.show(second);
	h.previewVideos[0]!.emit('error');
	await settle();
	assert.equal(h.previewVideos.length, 2, 'second video must wait while the first native fallback loads');
	const staleReady = first.nativeVideos[0]!.onloadeddata!;
	h.show(first, false);
	await settle();
	assert.equal(h.previewVideos.length, 3, 'offscreen cancellation releases the single worker');
	first.nativeVideos[0]!.readyState = 2;
	staleReady();
	assert.equal(first.containerClasses.has('is-loaded'), false, 'a dequeued stale callback cannot restore the frame');
	h.loader.disconnect();
});

void test('iOS native decode failure stays unavailable without repeated loading while visible', async () => {
	const h = harness(1, {}, true);
	const image = new FakeImage();
	h.observe(image, item('bad.mp4', 'mp4'));
	h.show(image);
	h.previewVideos[0]!.emit('error');
	await settle();
	image.nativeVideos[0]!.emit('error');
	await settle();
	h.show(image);
	h.checkVisibility();
	await settle();
	assert.equal(h.previewVideos.length, 2);
	assert.equal(image.containerClasses.has('has-error'), true);
	assert.equal(image.containerClasses.has('is-loaded'), false);
	assert.equal(image.nativeVideos[0]!.removed, true);
	assert.equal(h.timers.size, 0);
});

void test('iOS native fallback timeout releases the decoder and does not retry indefinitely', async () => {
	const h = harness(1, {}, true);
	const image = new FakeImage();
	h.observe(image, item('stalled.mp4', 'mp4'));
	h.show(image);
	h.previewVideos[0]!.emit('error');
	await settle();
	for (const callback of [...h.timers.values()]) callback();
	await settle();
	assert.equal(image.containerClasses.has('has-error'), true);
	assert.equal(image.nativeVideos[0]!.src, '');
	assert.equal(h.timers.size, 0);
	h.checkVisibility();
	assert.equal(h.previewVideos.length, 2);
});

void test('Android decode failure keeps the cached-image error path and never creates native video tiles', async () => {
	const h = harness();
	const image = new FakeImage();
	h.observe(image, item('unsupported.mp4', 'mp4'));
	h.show(image);
	h.previewVideos[0]!.emit('error');
	await settle();
	assert.equal(image.nativeVideos.length, 0);
	assert.equal(image.containerClasses.has('has-error'), true);
	assert.equal(h.previewVideos.length, 1);
});

void test('closing a gallery during a vault read does not decode detached images', async () => {
	const h = harness();
	const image = new FakeImage();
	h.observe(image, item('a.png'));
	h.show(image);
	h.loader.disconnect();
	h.pendingReads.get('a.png')?.resolve(pngBytes());
	await settle();
	assert.equal(h.bitmapOptions.length, 0);
	assert.equal(image.src, '');
});

void test('a late bitmap is closed without creating a canvas after disconnect', async () => {
	const h = harness();
	const decoded = deferred<ImageBitmap>();
	h.setBitmapFactory(() => decoded.promise);
	const image = new FakeImage();
	h.observe(image, item('a.png'));
	h.show(image);
	h.pendingReads.get('a.png')?.resolve(pngBytes());
	await settle();
	h.loader.disconnect();
	let closed = false;
	decoded.resolve({
		width: 384, height: 216, close() { closed = true; },
	});
	await settle();
	assert.equal(closed, true);
	assert.equal(h.canvases.length, 0);
});

void test('rapid re-entry cannot occupy multiple decode workers for one tile', async () => {
	const h = harness(2);
	const first = new FakeImage();
	const second = new FakeImage();
	h.observe(first, item('a.png'));
	h.observe(second, item('b.png'));
	h.show(first);
	h.show(first, false);
	h.show(first);
	h.show(second);
	assert.deepEqual(h.reads, ['a.png', 'b.png']);
	h.pendingReads.get('a.png')?.resolve(pngBytes());
	h.pendingReads.get('b.png')?.resolve(pngBytes());
	await settle();
	assert.ok(first.src);
	assert.ok(second.src);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 2);
});

void test('pending scroll work measures once per tile when a worker frees and skips hidden tiles', async () => {
	const h = harness();
	const images = [0, 200, 20, 40].map((top) => {
		const image = new FakeImage();
		image.top = top;
		return image;
	});
	for (const [index, image] of images.entries()) {
		h.observe(image, item(`${index}.png`));
		h.show(image);
	}
	const hidden = images[3];
	assert.ok(hidden);
	h.show(hidden, false);
	assert.equal(images.reduce((count, image) => count + image.measurements, 0), 0);
	h.pendingReads.get('0.png')?.resolve(pngBytes());
	await settle();
	assert.deepEqual(h.reads, ['0.png', '2.png']);
	assert.equal(images[1]?.measurements, 1);
	assert.equal(images[2]?.measurements, 1);
	assert.equal(hidden.measurements, 0);
	h.loader.disconnect();
	h.pendingReads.get('2.png')?.resolve(pngBytes());
	await settle();
});

void test('an unrecognized image header keeps its decoder-provided aspect ratio', async () => {
	const h = harness();
	const image = new FakeImage();
	let ratio = 0;
	h.observe(image, item('a.jxl', 'jxl'), (value) => { ratio = value; });
	h.show(image);
	h.pendingReads.get('a.jxl')?.resolve(new ArrayBuffer(8));
	await settle();
	assert.equal(h.bitmapOptions[0]?.resizeHeight, undefined);
	assert.equal(ratio, 3);
	assert.deepEqual(h.canvases, [{ width: 384, height: 128 }]);
	h.loader.disconnect();
});

void test('canvas allocations remain thumbnail-sized if a WebView ignores bitmap resize', async () => {
	const h = harness();
	h.setBitmapFactory(() => Promise.resolve({
		width: 4000, height: 3000, close() {},
	} as ImageBitmap));
	const image = new FakeImage();
	h.observe(image, item('a.png'));
	h.show(image);
	h.pendingReads.get('a.png')?.resolve(pngBytes(4000, 3000));
	await settle();
	assert.deepEqual(h.canvases, [{ width: 384, height: 288 }]);
	h.loader.disconnect();
});

void test('manual visibility does not load videos in the wider image preload band', async () => {
	const h = harness();
	const video = new FakeImage();
	video.isVideo = true;
	video.top = 150;
	const image = new FakeImage();
	image.top = 150;
	h.observe(video, item('a.mp4', 'mp4'));
	h.observe(image, item('a.png'));
	h.checkVisibility();
	assert.equal(video.src, '');
	assert.equal(video.loadCalls, 0);
	assert.deepEqual(h.reads, ['a.png']);
	h.loader.disconnect();
	h.pendingReads.get('a.png')?.resolve(pngBytes());
	await settle();
});

void test('manual filmstrip visibility respects horizontal video margins', () => {
	const h = harness(1, {
		imageRootMargin: '0px 160px',
		videoRootMargin: '0px 48px',
		manualMarginPx: 160,
	});
	const near = new FakeImage();
	near.isVideo = true;
	near.left = 140;
	const far = new FakeImage();
	far.isVideo = true;
	far.left = 160;
	h.observe(near, item('near.mp4', 'mp4'));
	h.observe(far, item('far.mp4', 'mp4'));
	h.checkVisibility();
	assert.equal(near.src, 'near.mp4');
	assert.equal(far.src, '');
	assert.equal(far.loadCalls, 0);
	h.loader.disconnect();
});

void test('video stills share the thumbnail worker limit and cache without whole-video vault reads', async () => {
	const h = harness();
	const first = new FakeImage();
	const second = new FakeImage();
	const metadata: VideoTileMetadata[] = [];
	h.observe(first, item('a.mp4', 'mp4'), undefined, (value) => { metadata.push(value); });
	h.observe(second, item('b.mp4', 'mp4'));
	h.show(first);
	h.show(second);
	assert.equal(h.previewVideos.length, 1, 'Only one mobile decoder may load at once');
	const decoder = h.previewVideos[0];
	assert.ok(decoder);
	decoder.readyState = 1;
	decoder.emit('loadedmetadata');
	assert.equal(metadata[0]?.durationSeconds, 10);
	decoder.readyState = 2;
	decoder.emit('seeked');
	await settle();
	assert.ok(first.src.startsWith('blob:'));
	assert.equal(h.previewVideos.length, 2, 'Next visible video starts only after first decoder closes');
	assert.deepEqual(h.reads, []);
	h.show(second, false);
	await settle();
	h.show(first, false);
	h.show(first);
	await settle();
	assert.equal(h.previewVideos.length, 2, 'Revisiting a tile reuses its generated image');
	assert.ok(first.src.startsWith('blob:'));
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 1);
});

void test('a cancelled video preview can restart after immediate scroll re-entry', async () => {
	const h = harness();
	const image = new FakeImage();
	h.observe(image, item('a.mp4', 'mp4'));
	h.show(image);
	h.show(image, false);
	h.show(image);
	await settle();
	assert.equal(h.previewVideos.length, 2);
	assert.equal(h.previewVideos[0]?.src, '');
	const active = h.previewVideos[1];
	assert.ok(active);
	active.readyState = 2;
	active.emit('loadeddata');
	await settle();
	assert.ok(image.src.startsWith('blob:'));
	assert.deepEqual(h.reads, []);
	h.loader.disconnect();
});

void test('simultaneous completed previews cannot evict each other before their tiles attach', async () => {
	const h = harness(2, { cacheEntries: 1 });
	const first = new FakeImage();
	const second = new FakeImage();
	h.observe(first, item('a.mp4', 'mp4'));
	h.observe(second, item('b.mp4', 'mp4'));
	h.show(first);
	h.show(second);
	for (const decoder of h.previewVideos) {
		decoder.readyState = 2;
		decoder.emit('loadeddata');
	}
	await settle();
	assert.ok(first.src.startsWith('blob:'), 'First completed frame remains pinned until attach');
	assert.ok(second.src.startsWith('blob:'));
	assert.equal(h.revokedUrls.length, 0, 'Attached frames can exceed the reusable cache budget');
	h.show(first, false);
	assert.equal(h.revokedUrls.length, 1, 'Hidden frames become evictable immediately');
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 2);
});

void test('more than 64 visited thumbnails stay encoded for the open note and return without another vault read', async () => {
	const h = harness(1, { retainedBytes: 0 });
	const visited: FakeImage[] = [];
	for (let index = 0; index < 65; index += 1) {
		const image = new FakeImage();
		const path = `visited-${index}.png`;
		visited.push(image);
		h.observe(image, item(path));
		h.show(image);
		await completeImage(h, path, image);
		h.show(image, false);
		assert.equal(image.src, '', 'Decoded source retention is disabled for this test');
	}
	const first = visited[0]!;
	h.show(first);
	assert.equal(first.src, h.createdUrls[0], 'Encoded cache reattaches synchronously before any worker');
	assert.equal(first.containerClasses.has('is-loaded'), true);
	assert.equal(first.containerClasses.has('is-cached-preview'), true);
	assert.equal(h.reads.length, 65);
	assert.equal(h.canvases.length, 65);
	assert.equal(h.revokedUrls.length, 0);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 65);
	assert.equal(new Set(h.revokedUrls).size, 65);
	assert.ok(visited.every(image => !image.containerClasses.has('is-cached-preview')));
});

void test('recent offscreen decoded sources keep their src and loaded state without reassignment or a fade', async () => {
	const h = harness(1);
	const image = new FakeImage();
	h.observe(image, item('recent.png'));
	h.show(image);
	await completeImage(h, 'recent.png', image);
	const url = image.src;
	const assignments = image.srcAssignments;
	h.show(image, false);
	assert.equal(image.src, url);
	assert.equal(image.containerClasses.has('is-loaded'), true);
	h.show(image);
	assert.equal(image.src, url);
	assert.equal(image.srcAssignments, assignments);
	assert.equal(image.containerClasses.has('is-loaded'), true);
	assert.equal(h.reads.length, 1);
	assert.equal(image.containerClasses.has('is-cached-preview'), true);
	h.loader.disconnect();
	assert.equal(image.src, '');
	assert.equal(image.containerClasses.has('is-cached-preview'), false);
	assert.deepEqual(h.revokedUrls, [url]);
});

for (const ios of [false, true]) {
	for (const count of [100, 341]) {
		void test(`${ios ? 'iOS' : 'Android'} sequential scroll of ${count} opaque PNG-fallback thumbnails reuses the open-note cache on return`, async () => {
			const h = harness(undefined, {}, ios);
			// Reproduce a WebView which accepts WebP as input but silently encodes
			// canvas output as large PNGs. 341 compact 33 KiB stills fit 16 MiB;
			// the same previews encoded as 256 KiB PNGs did not fit the old 8 MiB.
			h.usePngCanvasFallback(256 * 1024, 33 * 1024);
			const visited: FakeImage[] = [];
			for (let index = 0; index < count; index += 1) {
				const image = new FakeImage();
				const path = `long-note-${index}.png`;
				visited.push(image);
				h.observe(image, item(path));
				h.show(image);
				await completeImage(h, path, image);
				h.show(image, false);
			}
			const decodedThumbnailBytes = 384 * 216 * 4;
			const retainedCount = Math.floor((24 * 1024 * 1024) / decodedThumbnailBytes);
			assert.equal(visited.filter(image => image.src).length, retainedCount,
				'Offscreen decoded sources stay within the actual-pixel retention budget');
			assert.equal(visited[0]!.src, '', 'Old decoded sources are released rather than held without a limit');
			const recent = visited.at(-1)!;
			const recentAssignments = recent.srcAssignments;
			h.show(recent);
			assert.equal(recent.srcAssignments, recentAssignments, 'A recent decoded source is repinned without src reassignment');
			h.show(recent, false);
			const initialReadCount = h.reads.length;
			const initialDecodeCount = h.bitmapOptions.length;
			const initialEncodeCount = h.encodeRequests.length;
			for (const image of visited) {
				h.show(image);
				assert.ok(image.src.startsWith('blob:'), 'Cached still is attached synchronously, not through the lazy worker');
				assert.equal(image.containerClasses.has('is-loaded'), true);
				assert.equal(image.containerClasses.has('is-cached-preview'), true);
				h.show(image, false);
			}
			await settle();
			assert.equal(h.reads.length, initialReadCount, 'Returning never rereads the full-resolution source while its encoded preview is cached');
			assert.equal(h.bitmapOptions.length, initialDecodeCount, 'No second full-source decode is scheduled by the loader');
			assert.equal(h.encodeRequests.length, initialEncodeCount, 'No second thumbnail render/encode is scheduled');
			assert.equal(h.createdBlobs.length, count);
			assert.ok(h.createdBlobs.every(blob => blob.type === 'image/jpeg' && blob.size === 33 * 1024));
			assert.ok(h.createdBlobs.reduce((bytes, blob) => bytes + blob.size, 0) <= 16 * 1024 * 1024);
			assert.equal(h.revokedUrls.length, 0);
			h.loader.disconnect();
			assert.ok(visited.every(image => image.src === '' && !image.containerClasses.has('is-cached-preview')));
			assert.equal(h.revokedUrls.length, count);
			assert.equal(new Set(h.revokedUrls).size, count);
			assert.ok(h.bitmaps.every(bitmap => bitmap.closed));
			assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
		});
	}
}

void test('mobile WebP encoder fallback uses high-quality JPEG only for a confirmed opaque canvas', async () => {
	const h = harness(1, {}, true);
	h.usePngCanvasFallback(256 * 1024, 20 * 1024);
	const image = new FakeImage();
	h.observe(image, item('opaque.png'));
	h.show(image);
	await completeImage(h, 'opaque.png', image);
	assert.deepEqual(h.encodeRequests, [
		{ type: 'image/webp', quality: 0.76 },
		{ type: 'image/jpeg', quality: 0.84 },
	]);
	assert.equal(h.createdBlobs[0]?.type, 'image/jpeg');
	assert.equal(h.createdBlobs[0]?.size, 20 * 1024);
	assert.deepEqual(h.canvases, [{ width: 384, height: 216 }, { width: 384, height: 216 }]);
	assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
	h.loader.disconnect();
});

void test('mobile PNG-fallback note cache prevents repeated source I/O even when decoded retention is disabled', async () => {
	const h = harness(1, { retainedBytes: 0 }, true);
	h.usePngCanvasFallback(256 * 1024, 33 * 1024);
	let first!: FakeImage;
	for (let index = 0; index < 100; index += 1) {
		const image = new FakeImage();
		const path = `encoded-note-${index}.png`;
		if (index === 0) first = image;
		h.observe(image, item(path));
		h.show(image);
		await completeImage(h, path, image);
		h.show(image, false);
		assert.equal(image.src, '');
	}
	h.show(first);
	assert.equal(h.reads.length, 100, 'Returning to an older cached preview must not enqueue a 101st original-file read');
	assert.equal(first.src, h.createdUrls[0]);
	assert.equal(first.containerClasses.has('is-cached-preview'), true);
	assert.equal(h.bitmapOptions.length, 100);
	assert.equal(h.encodeRequests.length, 200);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 100);
});

void test('mobile PNG fallback keeps transparency and unknown alpha without JPEG flattening', async () => {
	for (const alphaUnavailable of [false, true]) {
		const h = harness(1, {}, true);
		h.usePngCanvasFallback(100 * 1024, 20 * 1024, alphaUnavailable);
		if (alphaUnavailable) h.failAlphaRead();
		const image = new FakeImage();
		h.observe(image, item('transparent.png'));
		h.show(image);
		await completeImage(h, 'transparent.png', image);
		assert.equal(h.encodeRequests.length, 1, 'Uncertain or nonopaque pixels must retain their lossless PNG');
		assert.equal(h.createdBlobs[0]?.type, 'image/png');
		assert.equal(h.createdBlobs[0]?.size, 100 * 1024);
		h.loader.disconnect();
	}
});

void test('a failed or larger mobile JPEG fallback keeps the successful PNG and closes its canvas', async () => {
	for (const jpegFails of [false, true]) {
		const h = harness(1, {}, true);
		h.usePngCanvasFallback(100, 200);
		if (jpegFails) h.failJpegEncoder();
		const image = new FakeImage();
		h.observe(image, item('fallback-safe.png'));
		h.show(image);
		await completeImage(h, 'fallback-safe.png', image);
		assert.equal(h.encodeRequests.length, 2);
		assert.equal(h.createdBlobs[0]?.type, 'image/png');
		assert.equal(h.createdBlobs[0]?.size, 100);
		assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
		h.loader.disconnect();
	}
});

void test('closing a mobile note during asynchronous JPEG fallback frees its canvas without publishing a stale URL', async () => {
	const h = harness(1, {}, true);
	h.usePngCanvasFallback(256 * 1024, 33 * 1024);
	h.deferEncoding();
	const image = new FakeImage();
	h.observe(image, item('late-jpeg.png'));
	h.show(image);
	h.pendingReads.get('late-jpeg.png')!.resolve(pngBytes());
	await settle();
	assert.equal(h.pendingEncodes.length, 1);
	h.completeEncoding();
	await settle();
	assert.equal(h.pendingEncodes.length, 1, 'JPEG fallback is still pending after the unsupported WebP encoder returned PNG');
	assert.equal(h.encodeRequests.at(-1)?.type, 'image/jpeg');
	h.loader.disconnect();
	h.completeEncoding();
	await settle();
	assert.equal(image.src, '');
	assert.deepEqual(h.createdUrls, []);
	assert.deepEqual(h.revokedUrls, []);
	assert.ok(h.bitmaps.every(bitmap => bitmap.closed));
	assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
});

void test('file changes during mobile JPEG fallback discard the old result and retry only the fresh identity', async () => {
	const h = harness(1, {}, true);
	h.usePngCanvasFallback(256 * 1024, 33 * 1024);
	h.deferEncoding();
	const image = new FakeImage();
	const media = item('jpeg-change.png');
	h.observe(image, media);
	h.show(image);
	h.pendingReads.get('jpeg-change.png')!.resolve(pngBytes());
	await settle();
	h.completeEncoding();
	await settle();
	assert.equal(h.encodeRequests.at(-1)?.type, 'image/jpeg');
	media.file.stat.mtime += 1;
	h.completeEncoding();
	await settle();
	assert.equal(image.src, '');
	assert.deepEqual(h.createdUrls, []);
	assert.equal(h.reads.length, 2);
	h.pendingReads.get('jpeg-change.png')!.resolve(pngBytes());
	await settle();
	h.completeEncoding();
	await settle();
	h.completeEncoding();
	await settle();
	assert.ok(image.src.startsWith('blob:'));
	assert.equal(h.createdUrls.length, 1);
	assert.equal(h.createdBlobs[0]?.type, 'image/jpeg');
	assert.ok(h.bitmaps.every(bitmap => bitmap.closed));
	assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
	h.loader.disconnect();
	assert.deepEqual(h.revokedUrls, h.createdUrls);
});

void test('desktop WebP/PNG encoding retains its existing behavior without the mobile fallback', async () => {
	const h = harness(1, {}, false, false);
	h.usePngCanvasFallback(100 * 1024, 20 * 1024);
	const image = new FakeImage();
	h.observe(image, item('desktop.png'));
	h.show(image);
	await completeImage(h, 'desktop.png', image);
	assert.equal(h.encodeRequests.length, 1);
	assert.equal(h.createdBlobs[0]?.type, 'image/png');
	h.loader.disconnect();
});

void test('large transparent mobile previews still obey the encoded byte budget and revoke evicted URLs once', async () => {
	const h = harness(1, {}, true);
	h.usePngCanvasFallback(1024 * 1024, 20 * 1024, false);
	const visited: FakeImage[] = [];
	for (let index = 0; index < 20; index += 1) {
		const image = new FakeImage();
		const path = `large-transparent-${index}.png`;
		visited.push(image);
		h.observe(image, item(path));
		h.show(image);
		await completeImage(h, path, image);
		h.show(image, false);
	}
	assert.equal(h.revokedUrls.length, 4, 'The reusable encoded cache is bounded at 16 MiB even with expensive transparent PNGs');
	assert.ok(visited.slice(0, 4).every(image => image.src === ''));
	assert.ok(visited.slice(4).every(image => image.src.startsWith('blob:')));
	const recent = visited.at(-1)!;
	h.show(recent);
	assert.equal(h.reads.length, 20);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 20);
	assert.equal(new Set(h.revokedUrls).size, 20);
});

void test('decoded offscreen budget detaches the oldest source but leaves its encoded thumbnail reusable', async () => {
	const h = harness(1, { retainedBytes: 384 * 384 * 4 });
	const first = new FakeImage();
	const second = new FakeImage();
	h.observe(first, item('first.png'));
	h.observe(second, item('second.png'));
	h.show(first);
	await completeImage(h, 'first.png', first);
	const firstUrl = first.src;
	h.show(first, false);
	assert.equal(first.src, firstUrl);
	h.show(second);
	await completeImage(h, 'second.png', second);
	const secondUrl = second.src;
	h.show(second, false);
	assert.equal(first.src, '');
	assert.equal(first.containerClasses.has('is-loaded'), false);
	assert.equal(second.src, secondUrl);
	assert.deepEqual(h.revokedUrls, []);
	h.show(first);
	assert.equal(first.src, firstUrl);
	assert.equal(first.containerClasses.has('is-loaded'), true);
	assert.equal(h.reads.length, 2);
	h.show(first, false);
	assert.equal(second.src, '', 'The next retained source is evicted oldest-first');
	assert.equal(first.src, firstUrl);
	h.loader.disconnect();
	assert.equal(new Set(h.revokedUrls).size, 2);
});

void test('compressed count and byte budgets evict LRU thumbnails and revoke each URL once', async () => {
	for (const options of [{ cacheEntries: 2 }, { cacheBytes: 18 }]) {
		const h = harness(1, options);
		const images: FakeImage[] = [];
		for (const path of ['a.png', 'b.png', 'c.png']) {
			const image = new FakeImage();
			images.push(image);
			h.observe(image, item(path));
			h.show(image);
			await completeImage(h, path, image);
			h.show(image, false);
		}
		assert.equal(images[0]!.src, '', 'Encoded eviction detaches its retained source first');
		assert.deepEqual(h.revokedUrls, [h.createdUrls[0]]);
		h.show(images[1]!);
		assert.equal(h.reads.length, 3, 'A surviving encoded cache hit performs no vault read');
		h.show(images[1]!, false);
		h.show(images[0]!);
		await completeImage(h, 'a.png', images[0]!);
		assert.equal(h.reads.filter(path => path === 'a.png').length, 2);
		assert.equal(images[2]!.src, '', 'Touching b made c the oldest evictable entry');
		h.loader.disconnect();
		assert.equal(h.revokedUrls.length, h.createdUrls.length);
		assert.equal(new Set(h.revokedUrls).size, h.createdUrls.length);
	}
});

void test('a cached thumbnail bypasses a stalled video even with an explicit single worker', async () => {
	const h = harness(1, { retainedBytes: 0 });
	const image = new FakeImage();
	const video = new FakeImage();
	h.observe(image, item('cached.png'));
	h.observe(video, item('stalled.mp4', 'mp4'));
	h.show(image);
	await completeImage(h, 'cached.png', image);
	const url = image.src;
	h.show(image, false);
	h.show(video);
	assert.equal(h.previewVideos.length, 1);
	h.show(image);
	assert.equal(image.src, url);
	assert.equal(image.containerClasses.has('is-loaded'), true);
	assert.deepEqual(h.reads, ['cached.png']);
	assert.equal(h.previewVideos[0]!.src, 'stalled.mp4');
	h.loader.disconnect();
	await settle();
	assert.equal(h.previewVideos[0]!.src, '');
});

void test('batched visibility prioritizes actual viewport images, viewport videos, then overscan', async () => {
	for (const manual of [false, true]) {
		const h = harness(1);
		const overscanImage = new FakeImage();
		overscanImage.top = 101;
		const overscanVideo = new FakeImage();
		overscanVideo.top = 115;
		const viewportVideo = new FakeImage();
		const viewportImage = new FakeImage();
		viewportImage.top = 95;
		viewportImage.left = 95;
		const images = [overscanImage, overscanVideo, viewportVideo, viewportImage];
		for (const [image, media] of [
			[overscanImage, item('overscan.png')], [overscanVideo, item('overscan.mp4', 'mp4')],
			[viewportVideo, item('visible.mp4', 'mp4')], [viewportImage, item('visible.png')],
		] as const) h.observe(image, media);
		if (manual) h.checkVisibility();
		else h.showMany(images);
		assert.deepEqual(h.reads, ['visible.png'], 'Viewport tier beats the closer overscan image');
		assert.equal(h.previewVideos.length, 0);
		await completeImage(h, 'visible.png', viewportImage);
		assert.equal(h.previewVideos[0]!.src, 'visible.mp4');
		h.previewVideos[0]!.readyState = 2;
		h.previewVideos[0]!.emit('loadeddata');
		await settle();
		assert.deepEqual(h.reads, ['visible.png', 'overscan.png']);
		await completeImage(h, 'overscan.png', overscanImage);
		assert.equal(h.previewVideos[1]!.src, 'overscan.mp4');
		h.loader.disconnect();
		await settle();
	}
});

void test('mobile defaults let one image progress beside a stalled video without adding image or video decoders', async () => {
	const h = harness();
	const firstVideo = new FakeImage();
	const secondVideo = new FakeImage();
	const firstImage = new FakeImage();
	const secondImage = new FakeImage();
	h.observe(firstVideo, item('first.mp4', 'mp4'));
	h.observe(secondVideo, item('second.mp4', 'mp4'));
	h.observe(firstImage, item('first.png'));
	h.observe(secondImage, item('second.png'));
	h.show(firstVideo);
	h.show(secondVideo);
	h.show(firstImage);
	h.show(secondImage);
	assert.equal(h.previewVideos.length, 1, 'A blocked video at the queue head cannot start a second decoder');
	assert.deepEqual(h.reads, ['first.png'], 'The eligible image behind that video gets its independent slot');
	await completeImage(h, 'first.png', firstImage);
	assert.deepEqual(h.reads, ['first.png', 'second.png']);
	assert.equal(h.previewVideos.length, 1);
	h.show(firstVideo, false);
	await settle();
	assert.equal(h.previewVideos.length, 2, 'Cancellation releases the video lane');
	assert.equal(h.previewVideos[0]!.src, '');
	h.loader.disconnect();
	h.pendingReads.get('second.png')?.resolve(pngBytes());
	await settle();
});

void test('explicit mobile worker limits and desktop defaults retain their existing global concurrency', async () => {
	const mobile = harness(1);
	const video = new FakeImage();
	const waitingImage = new FakeImage();
	mobile.observe(video, item('serial.mp4', 'mp4'));
	mobile.observe(waitingImage, item('serial.png'));
	mobile.show(video);
	mobile.show(waitingImage);
	assert.deepEqual(mobile.reads, []);
	mobile.loader.disconnect();
	await settle();
	const desktop = harness(undefined, {}, false, false);
	for (const path of ['a.png', 'b.png', 'c.png', 'd.png']) {
		const image = new FakeImage();
		desktop.observe(image, item(path));
		desktop.show(image);
	}
	assert.deepEqual(desktop.reads, ['a.png', 'b.png', 'c.png']);
	desktop.loader.disconnect();
	for (const pending of desktop.pendingReads.values()) pending.resolve(pngBytes());
	await settle();
	assert.equal(desktop.bitmapOptions.length, 0);
});

void test('native iOS fallback occupies only the mobile video lane and keeps existing offscreen teardown', async () => {
	const h = harness(undefined, {}, true);
	const video = new FakeImage();
	const image = new FakeImage();
	h.observe(video, item('native.mp4', 'mp4'));
	h.observe(image, item('image.png'));
	h.show(video);
	h.previewVideos[0]!.emit('error');
	await settle();
	const native = video.nativeVideos[0]!;
	h.show(image);
	assert.deepEqual(h.reads, ['image.png']);
	assert.equal(native.playCalls, 0);
	assert.equal(h.previewVideos.length, 2);
	h.show(video, false);
	await settle();
	assert.equal(native.src, '');
	assert.equal(native.removed, true);
	assert.equal(h.timers.size, 0);
	h.loader.disconnect();
	h.pendingReads.get('image.png')?.resolve(pngBytes());
	await settle();
});

void test('visible duplicate attachments pin one encoded URL until its retained copies can be safely evicted', async () => {
	const h = harness(2, { cacheEntries: 1 });
	const first = new FakeImage();
	const duplicate = new FakeImage();
	const other = new FakeImage();
	h.observe(first, item('shared.png'));
	h.observe(duplicate, item('shared.png'));
	h.show(first);
	h.show(duplicate);
	await completeImage(h, 'shared.png', first);
	duplicate.containerClasses.add('is-loaded');
	const sharedUrl = first.src;
	assert.equal(duplicate.src, sharedUrl);
	assert.deepEqual(h.reads, ['shared.png']);
	h.show(first, false);
	h.observe(other, item('other.png'));
	h.show(other);
	await completeImage(h, 'other.png', other);
	assert.equal(first.src, sharedUrl, 'A visible duplicate still pins the shared URL');
	assert.deepEqual(h.revokedUrls, []);
	h.show(duplicate, false);
	assert.equal(first.src, '');
	assert.equal(duplicate.src, '');
	assert.ok(other.src.startsWith('blob:'));
	assert.deepEqual(h.revokedUrls, [sharedUrl]);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 2);
	assert.equal(new Set(h.revokedUrls).size, 2);
});

void test('reobserving a changed file identity invalidates its retained source and old encoded URL', async () => {
	const h = harness(1);
	const image = new FakeImage();
	const media = item('changing.png');
	h.observe(image, media);
	h.show(image);
	await completeImage(h, 'changing.png', image);
	const oldUrl = image.src;
	h.show(image, false);
	media.file.stat.mtime += 1;
	h.observe(image, media);
	assert.equal(image.src, '');
	assert.deepEqual(h.revokedUrls, [oldUrl]);
	h.show(image);
	await completeImage(h, 'changing.png', image);
	assert.notEqual(image.src, oldUrl);
	assert.equal(h.reads.length, 2);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 2);
	assert.equal(new Set(h.revokedUrls).size, 2);
});

void test('a mutable file identity changing during bitmap decode closes stale pixels and retries the visible tile', async () => {
	const h = harness(1);
	const firstBitmap = deferred<ImageBitmap>();
	let closed = false;
	let decodeCalls = 0;
	h.setBitmapFactory(() => ++decodeCalls === 1 ? firstBitmap.promise : Promise.resolve({
		width: 384, height: 216, close() {},
	} as ImageBitmap));
	const image = new FakeImage();
	const media = item('mutating.png');
	h.observe(image, media);
	h.show(image);
	h.pendingReads.get('mutating.png')!.resolve(pngBytes());
	await settle();
	media.file.stat.mtime += 1;
	firstBitmap.resolve({ width: 384, height: 216, close() { closed = true; } });
	await settle();
	assert.equal(closed, true);
	assert.equal(h.canvases.length, 0, 'Stale bitmap must not allocate a canvas or publish a URL');
	assert.deepEqual(h.createdUrls, []);
	assert.deepEqual(h.reads, ['mutating.png', 'mutating.png']);
	await completeImage(h, 'mutating.png', image);
	assert.equal(h.createdUrls.length, 1);
	h.loader.disconnect();
	assert.equal(h.revokedUrls.length, 1);
});

void test('late encodes after note close free canvas backing and bitmap resources without creating a URL', async () => {
	const h = harness(1);
	h.deferEncoding();
	const image = new FakeImage();
	h.observe(image, item('late.png'));
	h.show(image);
	h.pendingReads.get('late.png')!.resolve(pngBytes());
	await settle();
	assert.equal(h.pendingEncodes.length, 1);
	h.loader.disconnect();
	h.completeEncoding();
	await settle();
	assert.equal(image.src, '');
	assert.deepEqual(h.createdUrls, []);
	assert.deepEqual(h.revokedUrls, []);
	assert.ok(h.bitmaps.every(bitmap => bitmap.closed));
	assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
});

void test('unobserving a retained node detaches it while the open-note encoded cache can serve a replacement', async () => {
	const h = harness(1);
	const first = new FakeImage();
	h.observe(first, item('replacement.png'));
	h.show(first);
	await completeImage(h, 'replacement.png', first);
	const url = first.src;
	h.show(first, false);
	h.loader.unobserve(first as unknown as HTMLImageElement);
	assert.equal(first.src, '');
	assert.equal(first.containerClasses.has('is-loaded'), false);
	const replacement = new FakeImage();
	h.observe(replacement, item('replacement.png'));
	h.show(replacement);
	assert.equal(replacement.src, url);
	assert.equal(replacement.containerClasses.has('is-loaded'), true);
	assert.equal(replacement.containerClasses.has('is-cached-preview'), true);
	assert.equal(h.reads.length, 1);
	h.loader.disconnect();
	assert.deepEqual(h.revokedUrls, [url]);
	assert.equal(replacement.containerClasses.has('is-cached-preview'), false);
});

void test('cached-preview state clears on encoded eviction rather than leaking into a fresh image load', async () => {
	const h = harness(1, { cacheEntries: 1 });
	const first = new FakeImage();
	const second = new FakeImage();
	h.observe(first, item('old.png'));
	h.observe(second, item('new.png'));
	h.show(first);
	await completeImage(h, 'old.png', first);
	h.show(first, false);
	h.show(first);
	assert.equal(first.containerClasses.has('is-cached-preview'), true);
	h.show(first, false);
	h.show(second);
	await completeImage(h, 'new.png', second);
	assert.equal(first.src, '');
	assert.equal(first.containerClasses.has('is-cached-preview'), false);
	assert.equal(second.containerClasses.has('is-cached-preview'), false);
	h.loader.disconnect();
});

void test('explicit single-worker filmstrip keeps cache hits immediate and finishes visible images before a waiting video', async () => {
	const h = harness(1, {
		cacheEntries: 40,
		thumbnailWidth: 160,
		retainedBytes: 0,
		imageRootMargin: '0px 160px',
		videoRootMargin: '0px 48px',
		manualMarginPx: 160,
	});
	const cached = new FakeImage();
	h.observe(cached, item('filmstrip-cached.png'));
	h.show(cached);
	await completeImage(h, 'filmstrip-cached.png', cached);
	const cachedUrl = cached.src;
	h.show(cached, false);
	const video = new FakeImage();
	const first = new FakeImage();
	const second = new FakeImage();
	h.observe(video, item('filmstrip.mp4', 'mp4'));
	h.observe(first, item('filmstrip-first.png'));
	h.observe(second, item('filmstrip-second.png'));
	h.showMany([video, first, second]);
	assert.deepEqual(h.reads, ['filmstrip-cached.png', 'filmstrip-first.png']);
	assert.equal(h.previewVideos.length, 0);
	h.show(cached);
	assert.equal(cached.src, cachedUrl);
	assert.equal(cached.containerClasses.has('is-cached-preview'), true);
	await completeImage(h, 'filmstrip-first.png', first);
	assert.equal(h.reads.at(-1), 'filmstrip-second.png');
	assert.equal(h.previewVideos.length, 0);
	await completeImage(h, 'filmstrip-second.png', second);
	assert.equal(h.previewVideos.length, 1, 'A finite visible-image batch releases the serial slot to video');
	assert.equal(h.previewVideos[0]!.src, 'filmstrip.mp4');
	assert.ok(h.canvases.every(canvas => canvas.width === 160 && canvas.height === 90));
	h.loader.disconnect();
	await settle();
});

void test('file identity changes during asynchronous encode publish only the fresh retry result', async () => {
	const h = harness(1);
	h.deferEncoding();
	const image = new FakeImage();
	const media = item('encoding-change.png');
	h.observe(image, media);
	h.show(image);
	h.pendingReads.get('encoding-change.png')!.resolve(pngBytes());
	await settle();
	assert.equal(h.pendingEncodes.length, 1);
	media.file.stat.size += 1;
	h.completeEncoding();
	await settle();
	assert.deepEqual(h.createdUrls, []);
	assert.equal(image.src, '');
	assert.equal(h.reads.length, 2);
	h.pendingReads.get('encoding-change.png')!.resolve(pngBytes());
	await settle();
	assert.equal(h.pendingEncodes.length, 1);
	h.completeEncoding();
	await settle();
	assert.ok(image.src.startsWith('blob:'));
	assert.equal(h.createdUrls.length, 1);
	assert.ok(h.bitmaps.every(bitmap => bitmap.closed));
	assert.ok(h.canvasBackingStores.every(canvas => canvas.width === 1 && canvas.height === 1));
	h.loader.disconnect();
	assert.deepEqual(h.revokedUrls, h.createdUrls);
});

void test('native fallback timeout releases the default mobile video lane without interrupting image loading', async () => {
	const h = harness(undefined, {}, true);
	const first = new FakeImage();
	const second = new FakeImage();
	const image = new FakeImage();
	h.observe(first, item('timeout-first.mp4', 'mp4'));
	h.observe(second, item('timeout-second.mp4', 'mp4'));
	h.observe(image, item('timeout-image.png'));
	h.show(first);
	h.show(second);
	h.previewVideos[0]!.emit('error');
	await settle();
	h.show(image);
	assert.deepEqual(h.reads, ['timeout-image.png']);
	assert.equal(h.previewVideos.length, 2);
	for (const callback of [...h.timers.values()]) callback();
	await settle();
	assert.equal(first.nativeVideos[0]!.removed, true);
	assert.equal(h.previewVideos.length, 3);
	assert.equal(h.previewVideos[2]!.src, 'timeout-second.mp4');
	await completeImage(h, 'timeout-image.png', image);
	assert.equal(h.previewVideos.length, 3, 'Image completion never opens another video decoder');
	h.loader.disconnect();
	await settle();
	assert.equal(h.timers.size, 0);
});
