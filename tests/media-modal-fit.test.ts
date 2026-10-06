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

class ImageStub {
	readonly properties = new Map<string, string>();
	readonly classes = new Set<string>();
	readonly style = {
		width: '', height: '',
		setProperty: (name: string, value: string): void => { this.properties.set(name, value); },
		removeProperty: (name: string): void => {
			this.properties.delete(name);
			if (name === 'width' || name === 'height') Object.assign(this.style, { [name]: '' });
		},
	};
	naturalWidth = 90;
	naturalHeight = 160;
	width = 0;
	height = 0;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	decode(): Promise<void> { return Promise.resolve(); }
	addClass(value: string): void { this.classes.add(value); }
	removeClass(value: string): void { this.classes.delete(value); }
	getContext(): { drawImage(): void } { return { drawImage(): void {} }; }
}

interface Item { id: string; resourceUrl: string }
interface Preload { image: ImageStub; index: number; ready: boolean; generation: number; resourceUrl: string }
interface Viewer {
	contentEl: ImageStub;
	mediaStageEl: ImageStub | null;
	closeRequested: boolean;
	dimensionsByMediaId: Map<string, { width: number; height: number }>;
	neighborImagePreloads: Map<number, Preload>;
	sizeThumbnailPreview(image: ImageStub, item: Item, thumbnail?: ImageStub): void;
	setMediaFitRatio(image: ImageStub, width: number, height: number): void;
	completeNeighborImagePreload(preload: Preload): Promise<void>;
	drawRotationFreezeCanvas(source: ImageStub, width: number, height: number): ImageStub;
	startMediaFitObserver(): void;
	stopMediaFitObserver(): void;
}

function createViewer(mobile = true, supportsObserver = true) {
	const observers: ResizeObserverStub[] = [];
	class ResizeObserverStub {
		target: ImageStub | null = null;
		disconnected = false;
		constructor(private readonly callback: (entries: { target: ImageStub; contentRect: { width: number; height: number } }[]) => void) {
			observers.push(this);
		}
		observe(target: ImageStub): void { this.target = target; }
		disconnect(): void { this.disconnected = true; }
		deliver(width: number, height: number): void {
			assert.ok(this.target);
			this.callback([{ target: this.target, contentRect: { width, height } }]);
		}
	}
	const win = {
		ResizeObserver: supportsObserver ? ResizeObserverStub : undefined,
		createEl: () => new ImageStub(),
	};
	class ContentStub extends ImageStub { win = win; doc = { win }; }
	class ModalStub { contentEl = new ContentStub(); }
	const module = { exports: {} as { MediaLightbox: new (...args: unknown[]) => Viewer } };
	runInNewContext(compiled.outputFiles[0]!.text, {
		module, exports: module.exports,
		require: () => ({ Modal: ModalStub, Platform: { isMobileApp: mobile } }),
	});
	const items = [{ id: 'first', resourceUrl: 'original:first' }, { id: 'second', resourceUrl: 'original:second' }];
	const viewer = new module.exports.MediaLightbox({}, items, 0, () => undefined, () => undefined, () => undefined);
	return { viewer, items, observers };
}

void test('mobile thumbnail uses original ratio with a painted-size box rather than inline thumbnail pixels', () => {
	const { viewer, items } = createViewer();
	const image = new ImageStub();
	Object.assign(image.style, { width: '90px', height: '160px' });
	viewer.dimensionsByMediaId.set('first', { width: 1080, height: 1920 });
	viewer.sizeThumbnailPreview(image, items[0]!, new ImageStub());
	assert.equal(image.style.width, '');
	assert.equal(image.style.height, '');
	assert.equal(image.properties.get('--section-gallery-media-ratio'), String(1080 / 1920));
	assert.equal(image.classes.has('has-fit-ratio'), true);
});

void test('uncached preview uses the decoded thumbnail ratio, then resets it for a differently shaped item', () => {
	const { viewer, items } = createViewer();
	const image = new ImageStub();
	viewer.sizeThumbnailPreview(image, items[0]!, new ImageStub());
	assert.equal(image.properties.get('--section-gallery-media-ratio'), String(90 / 160));
	viewer.sizeThumbnailPreview(image, items[1]!);
	assert.equal(image.classes.has('has-fit-ratio'), false, 'A reused scrub node must not inherit the old aspect ratio');
	image.naturalWidth = 160;
	image.naturalHeight = 90;
	image.onload?.();
	assert.equal(image.properties.get('--section-gallery-media-ratio'), String(160 / 90));
	assert.equal(image.onload, null);
});

for (const [label, mobile, observer] of [['desktop', false, true], ['older mobile WebView without ResizeObserver', true, false]] as const) {
	void test(`${label} keeps its existing thumbnail fit fallback`, () => {
		const { viewer, items } = createViewer(mobile, observer);
		const image = new ImageStub();
		viewer.dimensionsByMediaId.set('first', { width: 1080, height: 1920 });
		viewer.sizeThumbnailPreview(image, items[0]!);
		assert.equal(image.style.width, '1080px');
		assert.equal(image.style.height, '1920px');
		viewer.sizeThumbnailPreview(image, items[1]!);
		assert.equal(image.style.width, '100%');
		assert.equal(image.style.height, '100%');
	});
}

void test('decoded neighbor carries its contain ratio before swipe preview and promotion', async () => {
	const { viewer, items } = createViewer();
	const image = new ImageStub();
	const preload = { image, index: 1, generation: 1, ready: false, resourceUrl: items[1]!.resourceUrl };
	viewer.neighborImagePreloads.set(1, preload);
	await viewer.completeNeighborImagePreload(preload);
	assert.equal(preload.ready, true);
	assert.equal(image.properties.get('--section-gallery-media-ratio'), String(90 / 160));
	assert.equal(viewer.dimensionsByMediaId.get('second')?.height, 160);
});

void test('cancelled neighbor decode never publishes stale ratio or dimensions', async () => {
	const { viewer, items } = createViewer();
	const image = new ImageStub();
	const preload = { image, index: 1, generation: 1, ready: false, resourceUrl: items[1]!.resourceUrl };
	viewer.neighborImagePreloads.set(1, preload);
	const pending = viewer.completeNeighborImagePreload(preload);
	viewer.neighborImagePreloads.delete(1);
	await pending;
	assert.equal(preload.ready, false);
	assert.equal(image.classes.has('has-fit-ratio'), false);
	assert.equal(viewer.dimensionsByMediaId.has('second'), false);
});

void test('rotation proxy retains source aspect ratio, not the viewport or capped pixel box', () => {
	const { viewer } = createViewer();
	const source = new ImageStub();
	const canvas = viewer.drawRotationFreezeCanvas(source, 403, 701);
	assert.equal(Math.max(canvas.width, canvas.height), 320);
	assert.equal(canvas.properties.get('--section-gallery-media-ratio'), String(403 / 701));
	assert.equal(canvas.classes.has('has-fit-ratio'), true);
});

void test('unloaded and invalid metadata never publishes an unusable contain ratio', () => {
	const { viewer } = createViewer();
	const image = new ImageStub();
	for (const [width, height] of [[0, 0], [90, 0], [-1, 90], [Infinity, 90], [90, NaN]]) {
		viewer.setMediaFitRatio(image, width!, height!);
		assert.equal(image.classes.has('has-fit-ratio'), false);
	}
});

void test('mobile fit observes content bounds throughout UI transitions without reading layout', () => {
	const { viewer, observers } = createViewer();
	viewer.mediaStageEl = new ImageStub();
	viewer.startMediaFitObserver();
	assert.equal(observers.length, 1);
	assert.equal(viewer.contentEl.classes.has('has-mobile-fit-bounds'), false);
	for (const height of [596, 700, 800, 860]) {
		observers[0]!.deliver(424, height);
		assert.equal(viewer.contentEl.properties.get('--section-gallery-media-fit-width'), '424px');
		assert.equal(viewer.contentEl.properties.get('--section-gallery-media-fit-height'), `${height}px`);
		assert.equal(viewer.contentEl.classes.has('has-mobile-fit-bounds'), true);
	}
	observers[0]!.deliver(0, 0);
	assert.equal(viewer.contentEl.properties.get('--section-gallery-media-fit-height'), '860px', 'Detached/zero frames must not collapse the media');
});

void test('fit observer disconnects and ignores already-queued callbacks after close or replacement', () => {
	const { viewer, observers } = createViewer();
	viewer.mediaStageEl = new ImageStub();
	viewer.startMediaFitObserver();
	observers[0]!.deliver(424, 596);
	viewer.stopMediaFitObserver();
	assert.equal(observers[0]!.disconnected, true);
	observers[0]!.deliver(900, 400);
	assert.equal(viewer.contentEl.properties.get('--section-gallery-media-fit-height'), '596px');
	viewer.startMediaFitObserver();
	observers[1]!.deliver(424, 860);
	observers[0]!.deliver(900, 400);
	assert.equal(viewer.contentEl.properties.get('--section-gallery-media-fit-height'), '860px');
	viewer.closeRequested = true;
	observers[1]!.deliver(900, 400);
	assert.equal(viewer.contentEl.properties.get('--section-gallery-media-fit-height'), '860px');
	viewer.stopMediaFitObserver();
});

void test('desktop and unsupported hosts never start a mobile fit observer', () => {
	for (const [mobile, supported] of [[false, true], [true, false]]) {
		const { viewer, observers } = createViewer(mobile, supported);
		viewer.mediaStageEl = new ImageStub();
		viewer.startMediaFitObserver();
		assert.equal(observers.length, 0);
	}
});
