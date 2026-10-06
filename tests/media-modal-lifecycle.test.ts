import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// Exercise the real event handlers without requiring the Obsidian desktop
// runtime. Browser media and the delayed mobile Modal.close() are narrow fakes.
const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/media-modal.ts', import.meta.url))],
	bundle: true,
	write: false,
	format: 'cjs',
	platform: 'browser',
	external: ['obsidian', 'electron'],
});

class ElementStub {
	readonly classes = new Set<string>();
	readonly attributes = new Map<string, string>();
	disabled = false;
	isConnected = true;
	addClass(value: string): void { this.classes.add(value); }
	removeClass(value: string): void { this.classes.delete(value); }
	hasClass(value: string): boolean { return this.classes.has(value); }
	setAttr(name: string, value: string): void { this.attributes.set(name, value); }
	instanceOf(type: unknown): boolean { return type === ElementStub; }
}

class ImageStub extends ElementStub {
	override instanceOf(type: unknown): boolean { return type === ImageStub; }
	getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
		return { left: 0, top: 0, width: 400, height: 300 };
	}
}

class VideoStub extends ElementStub {
	currentSrc = 'app://vault/clip.mp4';
	currentTime = 0;
	duration = 3;
	readyState = 1;
	paused = false;
	override instanceOf(type: unknown): boolean { return type === VideoStub; }
	pause(): void { this.paused = true; }
}

class TreeElementStub extends ElementStub {
	readonly children: TreeElementStub[] = [];
	readonly dataset: Record<string, string> = {};
	constructor(readonly tagName = 'DIV') { super(); }
	get childElementCount(): number { return this.children.length; }
	private appendNode(tag: string): TreeElementStub {
		const child = new TreeElementStub(tag.toUpperCase());
		this.children.push(child);
		return child;
	}
	createEl(tag: string): TreeElementStub { return this.appendNode(tag); }
	createDiv(): TreeElementStub { return this.appendNode('DIV'); }
	createSpan(): TreeElementStub { return this.appendNode('SPAN'); }
	empty(): void { this.children.length = 0; }
	contains(node: unknown): boolean {
		return this === node || this.children.some(child => child.contains(node));
	}
}

interface ViewerHarness {
	activePointers: Map<number, { x: number; y: number }>;
	close(): void;
	closeRequested: boolean;
	currentIndex: number;
	completeStagePageSettle(generation: number): void;
	completeNativeFilmstripScroll(): void;
	contentEl: { win: FakeWindow };
	filmstripNativeLastActivityAt: number | null;
	filmstripNativeOriginalIndex: number | null;
	filmstripNativePointerReleasedAt: number | null;
	filmstripNativeScrolling: boolean;
	filmstripInertiaFrame: number | null;
	filmstripScrub: {
		active: boolean;
		pointerId: number;
		pointerType: string;
		originalIndex: number;
	} | null;
	filmstripTouchIds: Set<number>;
	filmstripEl: { contains(video: unknown): boolean } | null;
	filmstripLoader: {
		observe(element: TreeElementStub, item: { kind: string }, aspect: unknown, metadata: (value: { width: number; height: number; durationSeconds: number | null }) => void): void;
		unobserve(element: unknown): void;
	} | null;
	handleFilmstripPointerCancel(event: PointerEvent): void;
	handleFilmstripTouchStart(event: TouchEvent): void;
	handleFilmstripTouchEnd(event: TouchEvent): void;
	handleStagePointerEnd(event: PointerEvent): void;
	handleStagePointerCancel(event: PointerEvent): void;
	mediaEl: ImageStub | VideoStub | null;
	mediaFitObserver: { disconnect(): void } | null;
	desktopChromeObserver: { disconnect(): void } | null;
	panX: number;
	panY: number;
	pinchGesture: { startDistance: number; startScale: number } | null;
	pointerStart: { id: number; mode: string; panX: number; panY: number } | null;
	previewScrubIndex(index: number): void;
	beginViewportResizeTransition(orientationFlip: boolean): void;
	rememberVideoDuration(item: { id: string }, durationSeconds: number): void;
	renderFilmstrip(): void;
	shareButtonEl: ElementStub | null;
	resetShareState(): void;
	shareCurrent(): Promise<void>;
	startVideoFrameRateMeasurement(video: VideoStub, item: { id: string }, generation: number): void;
	stagePageSettle: {
		commit: boolean;
		filmstripSync: null;
		generation: number;
		originIndex: number;
		source: 'pointer';
		targetIndex: number;
	} | null;
	stagePageSettleTimer: number | null;
	videoDetailsByMediaId: Map<string, { durationSeconds: number | null; frameRateUnavailable?: boolean }>;
	zoomScale: number;
}

interface FakeWindow {
	performance: { now(): number };
	clearTimeout(id: number): void;
	setTimeout(callback: () => void, delay: number): number;
	requestAnimationFrame(callback: () => void): number;
	cancelAnimationFrame(id: number): void;
	navigator: { canShare?: () => boolean; share?: () => Promise<void> };
	File: typeof File;
}

function createViewer(
	readBinary: () => Promise<ArrayBuffer> = async () => new ArrayBuffer(0),
	options: { android?: boolean; adapter?: unknown; webShare?: boolean; canShare?: () => boolean } = {},
) {
	let now = 0;
	let sequence = 0;
	let shares = 0;
	const timers = new Map<number, { callback: () => void; deadline: number }>();
	const frames = new Map<number, () => void>();
	const notices: string[] = [];
	const win: FakeWindow = {
		performance: { now: () => now },
		clearTimeout: (id) => { timers.delete(id); },
		setTimeout: (callback, delay) => {
			const id = ++sequence;
			timers.set(id, { callback, deadline: now + delay });
			return id;
		},
		requestAnimationFrame: (callback) => {
			const id = ++sequence;
			frames.set(id, callback);
			return id;
		},
		cancelAnimationFrame: (id) => { frames.delete(id); },
		navigator: options.webShare === false ? {} : {
			canShare: options.canShare ?? (() => true),
			share: async () => { shares += 1; },
		},
		File,
	};
	class ModalStub {
		readonly contentEl = { win, doc: { querySelector: () => null } };
		readonly containerEl = new ElementStub();
		readonly modalEl = new ElementStub();
		constructor(readonly app: unknown) {}
		close(): void { /* onClose is deferred by Obsidian on phones. */ }
	}
	const module = { exports: {} as {
		MediaLightbox: new (...args: unknown[]) => ViewerHarness;
	} };
	runInNewContext(compiled.outputFiles[0]!.text, {
		module,
		exports: module.exports,
		require: (id: string): unknown => {
			assert.equal(id, 'obsidian');
			return {
				Modal: ModalStub,
				Platform: { isPhone: true, isMobile: true, isMobileApp: true, isAndroidApp: options.android ?? false },
				setIcon: () => undefined,
				Notice: class { constructor(message: string) { notices.push(message); } },
			};
		},
		HTMLVideoElement: VideoStub,
		HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
		HTMLImageElement: ImageStub,
		HTMLElement: ElementStub,
	});
	const item = { id: 'video', kind: 'video', sectionPath: [], file: { name: 'clip.mp4', path: 'Attachments/clip.mp4', extension: 'mp4', stat: { mtime: 1 } } };
	const viewer = new module.exports.MediaLightbox(
		{ vault: { readBinary, adapter: options.adapter } }, [item, { ...item, id: 'next-video' }], 0, async () => undefined,
		() => undefined, () => undefined,
	);
	return {
		viewer, timers, frames, notices,
		setNow: (value: number): void => { now = value; },
		shares: (): number => shares,
	};
}

function touchEvent(...identifiers: number[]): TouchEvent {
	return { changedTouches: {
		length: identifiers.length,
		item: (index: number) => identifiers[index] === undefined ? null : { identifier: identifiers[index] },
	} } as unknown as TouchEvent;
}

function pointerEvent(pointerId: number): PointerEvent {
	return { pointerId, timeStamp: 100, pointerType: 'touch' } as PointerEvent;
}

void test('Android native pointercancel does not settle a filmstrip while the finger remains down', () => {
	const { viewer, timers, setNow } = createViewer();
	viewer.filmstripNativeOriginalIndex = 0;
	viewer.filmstripNativeLastActivityAt = 0;
	viewer.filmstripNativeScrolling = true;
	viewer.filmstripScrub = { active: true, pointerId: 5, pointerType: 'touch', originalIndex: 0 };
	viewer.handleFilmstripTouchStart(touchEvent(3));
	viewer.handleFilmstripPointerCancel(pointerEvent(5));
	assert.equal(viewer.filmstripScrub, null);
	assert.equal(viewer.filmstripNativePointerReleasedAt, null);
	assert.equal(timers.size, 0, 'No polling or snap timer while native touch is held');
	setNow(1000);
	viewer.completeNativeFilmstripScroll();
	assert.equal(viewer.filmstripNativeOriginalIndex, 0, 'A one-second pause does not end the drag');
	viewer.handleFilmstripTouchEnd(touchEvent(3));
	assert.equal(viewer.filmstripNativePointerReleasedAt, 1000);
	assert.equal(timers.size, 1);
	assert.equal([...timers.values()][0]?.deadline, 1220, 'Momentum grace starts at actual finger release');
});

void test('native filmstrip waits for the last touch, including touchcancel, before snapping', () => {
	const { viewer, timers } = createViewer();
	viewer.filmstripNativeOriginalIndex = 0;
	viewer.handleFilmstripTouchStart(touchEvent(1, 2));
	viewer.handleFilmstripTouchEnd(touchEvent(1));
	assert.equal(timers.size, 0);
	assert.equal(viewer.filmstripTouchIds.size, 1);
	viewer.handleFilmstripTouchEnd(touchEvent(2));
	assert.equal(timers.size, 1);
	assert.equal(viewer.filmstripTouchIds.size, 0);
});

void test('pointer-only filmstrip input still settles without Touch Events support', () => {
	const { viewer, timers } = createViewer();
	viewer.filmstripNativeOriginalIndex = 0;
	viewer.filmstripScrub = { active: true, pointerId: 5, pointerType: 'pen', originalIndex: 0 };
	viewer.handleFilmstripPointerCancel(pointerEvent(5));
	assert.equal(viewer.filmstripNativePointerReleasedAt, 0);
	assert.equal(timers.size, 1);
});

for (const cancel of [false, true]) {
	void test(`pinch preserves remaining contacts when a third pointer is ${cancel ? 'cancelled' : 'lifted'}`, () => {
		const { viewer } = createViewer();
		viewer.mediaEl = new ImageStub();
		viewer.zoomScale = 2;
		viewer.panX = 20;
		viewer.panY = 30;
		viewer.pinchGesture = { startDistance: 80, startScale: 1 };
		viewer.activePointers.set(1, { x: 100, y: 100 });
		viewer.activePointers.set(2, { x: 250, y: 100 });
		viewer.activePointers.set(3, { x: 200, y: 200 });
		if (cancel) viewer.handleStagePointerCancel(pointerEvent(3));
		else viewer.handleStagePointerEnd(pointerEvent(3));
		assert.equal(viewer.pinchGesture?.startDistance, 150);
		assert.equal(viewer.pinchGesture?.startScale, 2);
		assert.equal(viewer.pointerStart === null, true);
		viewer.handleStagePointerCancel(pointerEvent(2));
		assert.equal(viewer.pinchGesture, null);
		assert.equal(viewer.pointerStart?.id, 1);
		assert.equal(viewer.pointerStart?.mode, 'pan', 'Remaining finger must not navigate or dismiss');
		assert.equal(viewer.pointerStart?.panX, 20);
	});
}

void test('closing a phone viewer stops video and invalidates pending file sharing before delayed teardown', async () => {
	let resolveRead!: (bytes: ArrayBuffer) => void;
	const { viewer, shares, notices } = createViewer(() => new Promise((resolve) => { resolveRead = resolve; }));
	viewer.shareButtonEl = new ElementStub();
	const video = new VideoStub();
	viewer.mediaEl = video;
	const pending = viewer.shareCurrent();
	viewer.close();
	assert.equal(video.paused, true);
	assert.equal(viewer.closeRequested, true);
	resolveRead(new ArrayBuffer(3));
	await pending;
	assert.equal(shares(), 0);
	assert.deepEqual(notices, []);
});

void test('late share-read failure after closing does not notify over another view', async () => {
	let rejectRead!: (error: Error) => void;
	const { viewer, notices } = createViewer(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
	viewer.shareButtonEl = new ElementStub();
	const pending = viewer.shareCurrent();
	viewer.close();
	rejectRead(new Error('File no longer available'));
	await pending;
	assert.deepEqual(notices, []);
});

for (const unsupportedFile of [false, true]) {
	void test(`Android uses its native chooser without reading a file when Web Share is ${unsupportedFile ? 'unsupported for the file' : 'absent'}`, async () => {
		let reads = 0;
		const paths: string[] = [];
		const adapter = {
			async open(this: unknown, path: string): Promise<void> {
				assert.equal(this, adapter, 'Adapter path resolution retains its receiver');
				paths.push(path);
			},
		};
		const { viewer, shares, notices } = createViewer(async () => {
			reads += 1;
			return new ArrayBuffer(1);
		}, { android: true, adapter, webShare: unsupportedFile, canShare: () => false });
		viewer.shareButtonEl = new ElementStub();
		viewer.resetShareState();
		assert.equal(viewer.shareButtonEl.hasClass('is-hidden'), false);
		assert.equal(viewer.shareButtonEl.attributes.get('aria-label'), 'Share or open in another app');
		await viewer.shareCurrent();
		assert.deepEqual(paths, ['Attachments/clip.mp4']);
		assert.equal(reads, 0);
		assert.equal(shares(), 0);
		assert.equal(viewer.shareButtonEl.disabled, false);
		assert.deepEqual(notices, []);
	});
}

void test('missing native adapter API is safely unavailable rather than invoking an invented bridge', async () => {
	let reads = 0;
	const { viewer, notices } = createViewer(async () => {
		reads += 1;
		return new ArrayBuffer(1);
	}, { android: true, adapter: {}, webShare: false });
	viewer.shareButtonEl = new ElementStub();
	viewer.resetShareState();
	assert.equal(viewer.shareButtonEl.hasClass('is-hidden'), true);
	await viewer.shareCurrent();
	assert.equal(reads, 0);
	assert.deepEqual(notices, ['Sharing this file is not supported on this device.']);
});

void test('native chooser errors restore the control and report failure', async () => {
	const { viewer, notices } = createViewer(undefined, {
		android: true, webShare: false,
		adapter: { open: async () => { throw new Error('Provider unavailable'); } },
	});
	viewer.shareButtonEl = new ElementStub();
	await viewer.shareCurrent();
	assert.deepEqual(notices, ['Could not share or open this media.']);
	assert.equal(viewer.shareButtonEl.disabled, false);
	assert.equal(viewer.shareButtonEl.hasClass('is-preparing'), false);
});

void test('supported Web Share remains preferred over the Android-only native fallback', async () => {
	let opened = 0;
	let reads = 0;
	const { viewer, shares } = createViewer(async () => {
		reads += 1;
		return new ArrayBuffer(3);
	}, { android: true, adapter: { open: async () => { opened += 1; } } });
	viewer.shareButtonEl = new ElementStub();
	viewer.resetShareState();
	assert.equal(viewer.shareButtonEl.attributes.get('aria-label'), 'Share media');
	await viewer.shareCurrent();
	assert.equal(reads, 1);
	assert.equal(shares(), 1);
	assert.equal(opened, 0);
});

void test('an iOS adapter with an open method is never mistaken for the Android chooser', () => {
	const { viewer } = createViewer(undefined, {
		android: false, webShare: false,
		adapter: { open: async () => { assert.fail('Android-only bridge called on iOS'); } },
	});
	viewer.shareButtonEl = new ElementStub();
	viewer.resetShareState();
	assert.equal(viewer.shareButtonEl.hasClass('is-hidden'), true);
});

void test('late native chooser failure after close cannot notify over another view', async () => {
	let rejectOpen!: (error: Error) => void;
	const { viewer, notices } = createViewer(undefined, {
		android: true, webShare: false,
		adapter: { open: () => new Promise((_resolve, reject) => { rejectOpen = reject; }) },
	});
	viewer.shareButtonEl = new ElementStub();
	const pending = viewer.shareCurrent();
	viewer.close();
	rejectOpen(new Error('Chooser dismissed during viewer close'));
	await pending;
	assert.deepEqual(notices, []);
});

void test('WebViews without video frame callbacks retain an explicit unsupported FPS state', () => {
	const { viewer } = createViewer();
	const item = { id: 'video' };
	viewer.startVideoFrameRateMeasurement(new VideoStub(), item, 1);
	viewer.rememberVideoDuration(item, 61);
	assert.equal(viewer.videoDetailsByMediaId.get('video')?.frameRateUnavailable, true);
	assert.equal(viewer.videoDetailsByMediaId.get('video')?.durationSeconds, 61);
});

void test('video filmstrip renders decoder-backed image stills instead of native Android video posters', () => {
	const { viewer } = createViewer();
	const strip = new TreeElementStub();
	viewer.filmstripEl = strip;
	const observed: string[] = [];
	viewer.filmstripLoader = {
		observe: (element, item, _aspect, metadata) => {
			assert.equal(item.kind, 'video');
			observed.push(element.tagName);
			metadata({ width: 1920, height: 1080, durationSeconds: 61 });
		},
		unobserve: () => undefined,
	};
	viewer.renderFilmstrip();
	assert.deepEqual(observed, ['IMG', 'IMG']);
	assert.equal(strip.children.some(button => button.children.some(child => child.tagName === 'VIDEO')), false);
	assert.equal(viewer.videoDetailsByMediaId.get('video')?.durationSeconds, 61);
});

void test('delayed phone close immediately cancels swipe and inertia work and rejects late publication', () => {
	const { viewer, timers, frames } = createViewer();
	let fitDisconnected = false;
	let chromeDisconnected = false;
	viewer.mediaFitObserver = { disconnect(): void { fitDisconnected = true; } };
	viewer.desktopChromeObserver = { disconnect(): void { chromeDisconnected = true; } };
	viewer.stagePageSettle = {
		commit: true, filmstripSync: null, generation: 1,
		originIndex: 0, source: 'pointer', targetIndex: 1,
	};
	const pendingSettle = () => viewer.completeStagePageSettle(1);
	const pendingScrub = () => viewer.previewScrubIndex(1);
	viewer.stagePageSettleTimer = viewer.contentEl.win.setTimeout(pendingSettle, 180);
	viewer.filmstripInertiaFrame = viewer.contentEl.win.requestAnimationFrame(pendingScrub);
	viewer.close();
	assert.equal(fitDisconnected, true, 'Fit observer is disconnected before native onClose');
	assert.equal(viewer.mediaFitObserver, null);
	assert.equal(chromeDisconnected, true, 'Desktop chrome observer shares immediate close cleanup');
	assert.equal(viewer.desktopChromeObserver, null);
	assert.equal(timers.size, 0, 'Swipe timer is cancelled before native onClose');
	assert.equal(frames.size, 0, 'Inertia RAF is cancelled before native onClose');
	assert.equal(viewer.stagePageSettle, null);
	// Even callbacks already dequeued by the browser cannot change selection.
	pendingSettle();
	pendingScrub();
	viewer.beginViewportResizeTransition(true);
	assert.equal(viewer.currentIndex, 0);
	assert.equal(timers.size, 0, 'Rotation during native close cannot restart work');
	viewer.close();
	assert.equal(viewer.currentIndex, 0, 'Repeated close remains idempotent');
});
