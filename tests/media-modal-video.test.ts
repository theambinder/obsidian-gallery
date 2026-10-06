import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

class ElementStub {
	readonly classes = new Set<string>();
	readonly children: ElementStub[] = [];
	readonly properties = new Map<string, string>();
	readonly style = {
		setProperty: (name: string, value: string): void => { this.properties.set(name, value); },
		removeProperty: (name: string): void => { this.properties.delete(name); },
	};
	removed = false;
	addClass(value: string): void { this.classes.add(value); }
	removeClass(value: string): void { this.classes.delete(value); }
	hasClass(value: string): boolean { return this.classes.has(value); }
	toggleClass(value: string, enabled: boolean): void { if (enabled) this.classes.add(value); else this.classes.delete(value); }
	remove(): void { this.removed = true; }
	empty(): void { this.children.length = 0; }
	createEl(tag: string): ElementStub {
		const node = tag === 'video' ? new VideoStub() : new ElementStub();
		this.children.push(node);
		return node;
	}
	instanceOf(type: unknown): boolean { return type === ElementStub; }
}

class VideoStub extends ElementStub {
	controls = false;
	playsInline = false;
	preload = '';
	poster = '';
	src = '';
	readyState = 1; // iPhone can remain HAVE_METADATA until native Play is tapped.
	videoWidth = 1280;
	videoHeight = 720;
	duration = 2;
	paused = true;
	onloadedmetadata: (() => void) | null = null;
	onloadeddata: (() => void) | null = null;
	playCalls = 0;
	load(): void {}
	pause(): void { this.paused = true; }
	removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
	play(): Promise<void> { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
	override instanceOf(type: unknown): boolean { return type === VideoStub; }
}

interface Viewer {
	mediaStageEl: ElementStub;
	mediaEl: VideoStub | null;
	mediaTitleEl: ElementStub;
	sectionTitleEl: ElementStub;
	counterEl: ElementStub;
	statusEl: ElementStub;
	scrubPreviewEl: ElementStub | null;
	filmstripButtons: { querySelector(): { currentSrc: string } }[];
	renderCurrent(preservePosition?: boolean, preservePreview?: boolean): void;
	updateCurrentText(): void;
	renderFilmstrip(): void;
	refreshNeighborImagePreloads(): void;
	resetShareState(): void;
	rememberMediaDimensions(): void;
	rememberVideoDuration(): void;
	startVideoFrameRateMeasurement(): void;
	disposeStageMedia(): void;
}

const bundle = build({ entryPoints: ['src/media-modal.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['obsidian', 'electron'] });

async function createViewer() {
	class ModalStub {
		modalEl = new ElementStub();
		contentEl = { win: { clearTimeout(): void {}, cancelAnimationFrame(): void {} } };
	}
	const module = { exports: {} as { MediaLightbox: new (...args: unknown[]) => Viewer } };
	runInNewContext((await bundle).outputFiles[0]!.text, {
		module,
		require: () => ({ Modal: ModalStub, Platform: { isMobile: true, isPhone: true, isIosApp: true } }),
		HTMLVideoElement: VideoStub,
		HTMLImageElement: class {},
	});
	const item = { id: 'video', kind: 'video', resourceUrl: 'capacitor://localhost/clip.mp4' };
	const viewer = new module.exports.MediaLightbox({}, [item], 0, () => undefined, () => undefined, () => undefined);
	viewer.mediaStageEl = new ElementStub();
	viewer.mediaTitleEl = new ElementStub();
	viewer.sectionTitleEl = new ElementStub();
	viewer.counterEl = new ElementStub();
	viewer.statusEl = new ElementStub();
	for (const name of ['updateCurrentText', 'renderFilmstrip', 'refreshNeighborImagePreloads', 'resetShareState', 'rememberMediaDimensions', 'rememberVideoDuration', 'startVideoFrameRateMeasurement'] as const) viewer[name] = () => undefined;
	return viewer;
}

void test('video opened directly exposes native playback controls before any loadeddata event', async () => {
	const viewer = await createViewer();
	viewer.renderCurrent();
	const video = viewer.mediaEl;
	assert.ok(video instanceof VideoStub);
	assert.equal(video.controls, true);
	assert.equal(video.playsInline, true);
	assert.equal(video.preload, 'metadata');
	assert.equal(viewer.mediaStageEl.hasClass('is-scrubbing'), false);
	assert.equal(video.src, 'capacitor://localhost/clip.mp4');
	assert.equal(video.playCalls, 0, 'Opening a viewer must not autoplay');
});

void test('settled video replaces a scrub still with visible native controls even when HAVE_METADATA persists forever', async () => {
	const viewer = await createViewer();
	const preview = new ElementStub();
	viewer.scrubPreviewEl = preview;
	viewer.mediaStageEl.addClass('is-scrubbing');
	viewer.filmstripButtons = [{ querySelector: () => ({ currentSrc: 'blob:cached-video-still' }) }];
	viewer.renderCurrent(true, true);
	const video = viewer.mediaEl!;
	assert.equal(viewer.mediaStageEl.hasClass('is-scrubbing'), false, 'Native controls must not depend on a decoded frame');
	assert.equal(viewer.scrubPreviewEl, null);
	assert.equal(preview.removed, true);
	assert.equal(video.controls, true);
	assert.equal(video.poster, 'blob:cached-video-still', 'Use the still as a native poster, not a blocking sibling');
	video.onloadedmetadata?.();
	assert.equal(video.properties.get('--section-gallery-media-ratio'), String(1280 / 720));
	assert.equal(video.hasClass('has-fit-ratio'), true, 'Native video shares the exact contain aspect ratio with stills');
	assert.equal(video.readyState, 1);
	assert.equal(viewer.mediaStageEl.hasClass('is-scrubbing'), false);
	await video.play();
	assert.equal(video.paused, false);
	viewer.disposeStageMedia();
	assert.equal(video.paused, true);
	assert.equal(video.src, '');
});
