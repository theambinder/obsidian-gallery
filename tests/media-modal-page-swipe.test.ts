import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/media-modal.ts', import.meta.url))],
	bundle: true, write: false, format: 'cjs', platform: 'browser',
	external: ['obsidian', 'electron'],
});

class ElementStub {
	readonly classes = new Set<string>();
	readonly properties = new Map<string, string>();
	readonly captures = new Set<number>();
	isConnected = true;
	clientWidth = 400;
	style = {
		setProperty: (name: string, value: string): void => { this.properties.set(name, value); },
		getPropertyValue: (name: string): string => this.properties.get(name) ?? '',
		removeProperty: (name: string): void => { this.properties.delete(name); },
	};
	addClass(value: string): void { this.classes.add(value); }
	removeClass(value: string): void { this.classes.delete(value); }
	hasClass(value: string): boolean { return this.classes.has(value); }
	toggleClass(value: string, enabled: boolean): void {
		if (enabled) this.addClass(value); else this.removeClass(value);
	}
	instanceOf(type: unknown): boolean { return type === ElementStub; }
	closest(): null { return null; }
	getBoundingClientRect(): { width: number } { return { width: this.clientWidth }; }
	setPointerCapture(id: number): void { this.captures.add(id); }
	hasPointerCapture(id: number): boolean { return this.captures.has(id); }
	releasePointerCapture(id: number): void { this.captures.delete(id); }
}

interface Settle {
	commit: boolean;
	filmstripSync: unknown;
	generation: number;
	originIndex: number;
	targetIndex: number;
}

interface ViewerHarness {
	currentIndex: number;
	mediaStageEl: ElementStub;
	stagePageSwipe: { deltaX: number; velocityX: number; viewportWidth: number; filmstripSync: unknown } | null;
	stagePageSettle: Settle | null;
	handleStagePointerDown(event: PointerEvent): void;
	handleStagePointerMove(event: PointerEvent): void;
	handleStagePointerEnd(event: PointerEvent): void;
	handleStagePointerCancel(event: PointerEvent): void;
	renderStagePagePreview(index: number, delta: number): void;
	updateStagePageFilmstripSync(motion: { filmstripSync: unknown }, offset: number): void;
	applyStagePageFilmstripMorph(sync: unknown, offset: number): void;
	finishStagePageFilmstripSettle(sync: unknown, index: number): void;
	clearStagePageFilmstripMorph(sync: unknown): void;
	renderCurrent(): void;
	renderFilmstrip(): void;
	snapFilmstripToCurrent(): void;
	showScrubPreview(index: number): void;
	updateFilmstripGeometry(): void;
}

function createViewer(reducedMotion = false) {
	let now = 0;
	let sequence = 0;
	const frames = new Map<number, FrameRequestCallback>();
	const timers = new Map<number, () => void>();
	const published: number[] = [];
	const carouselOffsets: number[] = [];
	const previewIndices: number[] = [];
	const win = {
		performance: { now: () => now },
		matchMedia: () => ({ matches: reducedMotion }),
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			const id = ++sequence;
			frames.set(id, callback);
			return id;
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
		setTimeout: (callback: () => void) => {
			const id = ++sequence;
			timers.set(id, callback);
			return id;
		},
		clearTimeout: (id: number) => timers.delete(id),
	};
	class ModalStub {
		contentEl = { win };
		modalEl = new ElementStub();
	}
	const module = { exports: {} as { MediaLightbox: new (...args: unknown[]) => ViewerHarness } };
	runInNewContext(compiled.outputFiles[0]!.text, {
		module, exports: module.exports,
		require: (id: string): unknown => {
			assert.equal(id, 'obsidian');
			return { Modal: ModalStub, Platform: { isMobileApp: true }, setIcon: () => undefined };
		},
		HTMLVideoElement: class {}, HTMLImageElement: class {},
		Element: ElementStub, HTMLElement: ElementStub,
	});
	const viewer = new module.exports.MediaLightbox(
		{}, [0, 1, 2, 3].map((id) => ({ id: String(id), kind: 'image' })),
		1, async () => undefined, () => undefined, () => undefined,
	);
	viewer.mediaStageEl = new ElementStub();
	// Keep the real pointer/release/frame state machines; only DOM/media loading
	// is faked, so tests do not duplicate gesture math or commit decisions.
	viewer.renderStagePagePreview = (index) => { previewIndices.push(index); };
	viewer.updateStagePageFilmstripSync = (motion) => {
		motion.filmstripSync = { viewportWidth: 400 };
	};
	viewer.applyStagePageFilmstripMorph = (_sync, offset) => { carouselOffsets.push(offset); };
	viewer.finishStagePageFilmstripSettle = () => undefined;
	viewer.clearStagePageFilmstripMorph = () => undefined;
	viewer.renderCurrent = () => { published.push(viewer.currentIndex); };
	viewer.renderFilmstrip = () => undefined;
	viewer.snapFilmstripToCurrent = () => undefined;
	viewer.showScrubPreview = () => undefined;
	viewer.updateFilmstripGeometry = () => undefined;
	const event = (x: number, at: number, y = 200): PointerEvent => ({
		pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y,
		timeStamp: at, preventDefault: () => undefined,
	}) as PointerEvent;
	return {
		viewer, event, timers, frames, published, carouselOffsets, previewIndices,
		frame: (at: number): void => {
			now = at;
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(at);
		},
	};
}

void test('touch page follows actual travel, then page and carousel share every settle frame', () => {
	const { viewer, event, frame, carouselOffsets, published, timers } = createViewer();
	viewer.handleStagePointerDown(event(300, 0));
	viewer.handleStagePointerMove(event(160, 100));
	assert.equal(viewer.mediaStageEl.properties.get('--section-gallery-page-offset-x'), '-140px');
	assert.equal(viewer.currentIndex, 1, 'Dragging does not publish a new active media');
	viewer.handleStagePointerEnd(event(160, 101));
	assert.equal(viewer.stagePageSettle?.targetIndex, 2);
	frame(0);
	frame(90);
	assert.equal(
		Number.parseFloat(viewer.mediaStageEl.properties.get('--section-gallery-page-offset-x') ?? ''),
		carouselOffsets.at(-1),
		'The large page and the active carousel morph use the identical offset',
	);
	assert.equal(viewer.currentIndex, 1);
	frame(180);
	assert.deepEqual(published, [2]);
	assert.equal(viewer.stagePageSettle, null);
	assert.equal(timers.size, 0, 'No extra timer lockout remains after visual completion');
	frame(300);
	assert.deepEqual(published, [2], 'One touch cannot advance several media');
	viewer.handleStagePointerDown(event(250, 181));
	viewer.handleStagePointerMove(event(390, 260));
	assert.notEqual(viewer.stagePageSwipe, null, 'Next drag is accepted immediately after completion');
});

void test('quick flick survives a duplicate-position pointerup but a held short drag returns', () => {
	for (const releaseAt of [41, 400]) {
		const { viewer, event } = createViewer();
		viewer.handleStagePointerDown(event(300, 0));
		viewer.handleStagePointerMove(event(250, 40));
		viewer.handleStagePointerEnd(event(250, releaseAt));
		assert.equal(viewer.stagePageSettle?.commit, releaseAt === 41);
	}
});

void test('a new touch grabs the settling page without a jump or discarded drag', () => {
	const { viewer, event, frame, timers, published } = createViewer();
	viewer.handleStagePointerDown(event(300, 0));
	viewer.handleStagePointerMove(event(160, 100));
	viewer.handleStagePointerEnd(event(160, 101));
	frame(0); frame(60);
	const beforeGrab = Number.parseFloat(
		viewer.mediaStageEl.properties.get('--section-gallery-page-offset-x') ?? '',
	);
	viewer.handleStagePointerDown(event(200, 161));
	assert.equal(viewer.stagePageSettle, null);
	assert.equal(timers.size, 0, 'The old completion timer cannot publish during the new drag');
	assert.equal(viewer.stagePageSwipe?.deltaX, beforeGrab);
	viewer.handleStagePointerMove(event(225, 180));
	assert.equal(viewer.stagePageSwipe?.deltaX, beforeGrab + 25);
	frame(300);
	assert.deepEqual(published, [], 'Holding the page stops old settle callbacks');
});

void test('a deliberate reverse flick cancels a long drag instead of moving against the finger', () => {
	const { viewer, event, frame, published } = createViewer();
	viewer.handleStagePointerDown(event(300, 0));
	viewer.handleStagePointerMove(event(100, 200));
	viewer.handleStagePointerMove(event(160, 220));
	viewer.handleStagePointerEnd(event(160, 221));
	assert.equal(viewer.stagePageSettle?.commit, false);
	frame(0); frame(180);
	assert.equal(viewer.currentIndex, 1);
	assert.deepEqual(published, []);
});

void test('OS pointercancel always returns the page, including beyond its distance threshold', () => {
	const { viewer, event, frame, published } = createViewer();
	viewer.handleStagePointerDown(event(300, 0));
	viewer.handleStagePointerMove(event(0, 100));
	viewer.handleStagePointerCancel(event(0, 110));
	assert.equal(viewer.stagePageSettle?.commit, false);
	frame(0); frame(180);
	assert.equal(viewer.currentIndex, 1);
	assert.deepEqual(published, []);
});

void test('reduced motion commits exactly once without animation frames or settle timer', () => {
	const { viewer, event, frame, published, frames, timers } = createViewer(true);
	viewer.handleStagePointerDown(event(300, 0));
	viewer.handleStagePointerMove(event(100, 100));
	viewer.handleStagePointerEnd(event(100, 101));
	frame(0);
	assert.deepEqual(published, [2]);
	assert.equal(frames.size, 0);
	assert.equal(timers.size, 0);
});
