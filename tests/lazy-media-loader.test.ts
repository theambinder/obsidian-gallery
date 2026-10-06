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
async function buildLoader(ios: boolean) {
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
				contents: `export const Platform = { isMobile: true, isIosApp: ${ios} };`,
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
	get src(): string { return this.attributes.get('src') ?? ''; }
	set src(value: string) { this.attributes.set('src', value); }
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

function harness(concurrency = 1, options: LazyMediaLoaderOptions = {}, ios = false) {
	const reads: string[] = [];
	const pendingReads = new Map<string, ReturnType<typeof deferred<ArrayBuffer>>>();
	const bitmapOptions: ImageBitmapOptions[] = [];
	const bitmaps: { width: number; height: number; closed: boolean }[] = [];
	const canvases: { width: number; height: number }[] = [];
	const revokedUrls: string[] = [];
	const observers: { emit(image: FakeImage, visible: boolean): void }[] = [];
	const previewVideos: PreviewVideo[] = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	let bitmapFactory: ((options: ImageBitmapOptions) => Promise<ImageBitmap>) | null = null;
	let objectUrls = 0;
	let manualCheck: FrameRequestCallback | null = null;
	class FakeObserver {
		constructor(private callback: IntersectionObserverCallback) {
			observers.push(this);
		}
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
		emit(image: FakeImage, visible: boolean): void {
			this.callback([
				{ target: image, isIntersecting: visible } as unknown as IntersectionObserverEntry,
			], this as unknown as IntersectionObserver);
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
			createObjectURL: () => `blob:test-${++objectUrls}`,
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
				getContext: () => ({ drawImage: () => undefined }),
				toBlob(callback: BlobCallback) {
					canvases.push({ width: this.width, height: this.height });
					callback(new Blob(['thumbnail']));
				},
			};
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
	const loader = new (ios ? IosLazyMediaLoader : LazyMediaLoader)(
		app as unknown as App, root as unknown as Element, { concurrency, ...options },
	);
	return {
		loader, reads, pendingReads, bitmapOptions, bitmaps, canvases, revokedUrls, previewVideos, timers,
		setBitmapFactory(factory: (options: ImageBitmapOptions) => Promise<ImageBitmap>) {
			bitmapFactory = factory;
		},
		observe(image: FakeImage, media: GalleryMedia, onRatio?: (ratio: number) => void, onMetadata?: (metadata: VideoTileMetadata) => void) {
			loader.observe(image as unknown as HTMLImageElement, media, onRatio, onMetadata);
		},
		show(image: FakeImage, visible = true) { observers[0]?.emit(image, visible); },
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
