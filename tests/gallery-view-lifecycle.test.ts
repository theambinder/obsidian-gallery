import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { TILE_RENDER_BATCH_SIZE } from '../src/constants';

interface TileTask {
	grid: { isConnected: boolean };
	index: number;
	item: object;
}

interface TestTile {
	classes: Set<string>;
	dataset: { mediaTrackingKey: string };
	addClass(name: string): void;
	removeClass(name: string): void;
	removeAttribute(name: string): void;
	setAttr(name: string, value: string): void;
	focus(): void;
	scrollIntoView(): void;
}

interface TestGalleryView {
	currentNotePath: string | null;
	lastViewedMediaByNote: Map<string, string>;
	lastViewedTileEl: TestTile | null;
	lazyLoader: { refreshVisibility(): void; disconnect(): void } | null;
	renderRevision: number;
	tilesByTrackingKey: Map<string, TestTile>;
	cancelPendingRender(): void;
	disposeSectionBody(body: object): void;
	enqueueTileTasks(tasks: TileTask[], revision: number): void;
	focusGalleryControl(tile: TestTile): void;
	recordLastViewedMedia(note: string, key: string): void;
	renderTile(grid: TileTask['grid'], item: object, index: number): void;
	setTileScale(value: number): void;
	refreshVisibleMedia(): void;
	onClose(): Promise<void>;
	toggleLayoutMode(): void;
}

// Exercise the real view methods with only the Obsidian host replaced. No DOM
// library is necessary for scheduling and selection, and no browser globals or
// live vault are touched by these regression tests.
const viewConstructor = build({
	entryPoints: ['src/gallery-view.ts'],
	bundle: true,
	external: ['obsidian', 'electron'],
	format: 'cjs',
	platform: 'node',
	write: false,
}).then((result) => (notices: string[]) => {
	const module = { exports: {} };
	const nodeRequire = createRequire(import.meta.url);
	runInNewContext(result.outputFiles[0]!.text, {
		module,
		require: (specifier: string): unknown => {
			if (specifier !== 'obsidian') {
				return nodeRequire(specifier) as unknown;
			}
			return {
				ItemView: class {
					contentEl: unknown;
					containerEl: unknown;
					constructor(leaf: { contentEl: unknown; containerEl: unknown }) {
						this.contentEl = leaf.contentEl;
						this.containerEl = leaf.containerEl;
					}
				},
				Platform: { isMobile: false },
				Notice: class { constructor(message: string) { notices.push(message); } },
			};
		},
	});
	return (module.exports as {
		SectionGalleryView: new (leaf: object, host: object) => TestGalleryView;
	}).SectionGalleryView;
});

async function createView(host: object = {}): Promise<{
	view: TestGalleryView;
	flushFrame: () => void;
	pendingFrames: () => number;
	flushTimers: () => void;
	pendingTimers: () => number;
	notices: string[];
	css: Record<string, string>;
}> {
	let nextFrame = 0;
	let nextTimer = 0;
	const frames = new Map<number, FrameRequestCallback>();
	const timers = new Map<number, () => void>();
	const notices: string[] = [];
	const View = (await viewConstructor)(notices);
	const css: Record<string, string> = {};
	const view = new View({
		containerEl: {
			setCssProps: (props: Record<string, string>) => Object.assign(css, props),
			removeClass(): void {},
		},
		contentEl: {
			removeAttribute(): void {},
			win: {
				removeEventListener(): void {},
				setTimeout(callback: () => void): number { timers.set(++nextTimer, callback); return nextTimer; },
				clearTimeout(timer: number): void { timers.delete(timer); },
				requestAnimationFrame(callback: FrameRequestCallback): number {
					frames.set(++nextFrame, callback);
					return nextFrame;
				},
				cancelAnimationFrame(frame: number): void {
					frames.delete(frame);
				},
			},
		},
	}, host);
	return {
		view,
		css,
		notices,
		flushFrame(): void {
			const callbacks = Array.from(frames.values());
			frames.clear();
			for (const callback of callbacks) {
				callback(0);
			}
		},
		pendingFrames: () => frames.size,
		flushTimers(): void {
			const callbacks = Array.from(timers.values());
			timers.clear();
			for (const callback of callbacks) callback();
		},
		pendingTimers: () => timers.size,
	};
}

function tileTask(index: number, isConnected = true): TileTask {
	return { grid: { isConnected }, index, item: {} };
}

void test('tile scale changes only the scoped layout variable without rebuilding tiles', async () => {
	const { view, css, pendingFrames } = await createView();
	const revision = view.renderRevision;
	view.setTileScale(146);
	assert.equal(css['--section-gallery-tile-scale'], '1.5');
	assert.equal(view.renderRevision, revision);
	assert.equal(pendingFrames(), 0);
	view.setTileScale(10000);
	assert.equal(css['--section-gallery-tile-scale'], '1.8');
});

void test('many small sections share one per-frame tile budget', async () => {
	const { view, flushFrame, pendingFrames } = await createView();
	const rendered: number[] = [];
	view.renderTile = (_grid, _item, index) => rendered.push(index);
	for (let section = 0; section < TILE_RENDER_BATCH_SIZE * 3; section += 1) {
		view.enqueueTileTasks([tileTask(section)], view.renderRevision);
	}
	assert.equal(rendered.length, 0, 'building section shells must yield before tiles');
	assert.equal(pendingFrames(), 1);
	flushFrame();
	assert.equal(rendered.length, TILE_RENDER_BATCH_SIZE);
	flushFrame();
	assert.equal(rendered.length, TILE_RENDER_BATCH_SIZE * 2);
	flushFrame();
	assert.deepEqual(rendered, Array.from({ length: TILE_RENDER_BATCH_SIZE * 3 }, (_, i) => i));
	assert.equal(pendingFrames(), 0);
});

void test('search or note replacement cancels old tile work and restarts the queue', async () => {
	const { view, flushFrame, pendingFrames } = await createView();
	const rendered: number[] = [];
	view.renderTile = (_grid, _item, index) => rendered.push(index);
	const previousRevision = view.renderRevision;
	view.enqueueTileTasks(Array.from({ length: 100 }, (_, index) => tileTask(index)), previousRevision);
	flushFrame();
	view.cancelPendingRender();
	assert.equal(pendingFrames(), 0);
	view.enqueueTileTasks([tileTask(1000)], previousRevision);
	assert.equal(pendingFrames(), 0, 'a stale details callback must not enqueue tiles');
	view.enqueueTileTasks([tileTask(2000)], view.renderRevision);
	flushFrame();
	assert.deepEqual(rendered, [...Array.from({ length: TILE_RENDER_BATCH_SIZE }, (_, i) => i), 2000]);
});

void test('detached tiles are skipped without starving the browser for an unbounded batch', async () => {
	const { view, flushFrame, pendingFrames } = await createView();
	const rendered: number[] = [];
	view.renderTile = (_grid, _item, index) => rendered.push(index);
	view.enqueueTileTasks([
		...Array.from({ length: TILE_RENDER_BATCH_SIZE }, (_, index) => tileTask(index, false)),
		tileTask(2000),
	], view.renderRevision);
	flushFrame();
	assert.equal(rendered.length, 0);
	assert.equal(pendingFrames(), 1);
	flushFrame();
	assert.deepEqual(rendered, [2000]);
});

void test('collapsing a large section removes queued tiles before the next visible section', async () => {
	const { view, flushFrame, pendingFrames } = await createView();
	const rendered: number[] = [];
	view.renderTile = (_grid, _item, index) => rendered.push(index);
	const hiddenTasks = Array.from({ length: 100 }, (_, index) => tileTask(index));
	const hiddenGrids = new Set(hiddenTasks.map((task) => task.grid));
	view.enqueueTileTasks([...hiddenTasks, tileTask(2000)], view.renderRevision);
	view.disposeSectionBody({
		contains: (grid: TileTask['grid']) => hiddenGrids.has(grid),
		querySelectorAll: () => [],
		remove: () => {
			for (const grid of hiddenGrids) {
				grid.isConnected = false;
			}
		},
	});
	flushFrame();
	assert.deepEqual(rendered, [2000]);
	assert.equal(pendingFrames(), 0);
});

void test('keyboard selection advances the single last-viewed marker and focus entry point', async () => {
	const { view } = await createView();
	const tile = (key: string): TestTile => ({
		classes: new Set(),
		dataset: { mediaTrackingKey: key },
		addClass(name): void { this.classes.add(name); },
		removeClass(name): void { this.classes.delete(name); },
		removeAttribute(): void {},
		setAttr(): void {},
		focus(): void {},
		scrollIntoView(): void {},
	});
	const first = tile('first');
	const second = tile('second');
	view.currentNotePath = 'gallery.md';
	view.tilesByTrackingKey.set('first', first);
	view.tilesByTrackingKey.set('second', second);
	view.recordLastViewedMedia('gallery.md', 'first');
	view.focusGalleryControl(second);
	assert.equal(first.classes.has('is-last-viewed'), false);
	assert.equal(second.classes.has('is-last-viewed'), true);
	assert.equal(view.lastViewedTileEl, second);
	assert.equal(view.lastViewedMediaByNote.get('gallery.md'), 'second');
});

void test('visibility refresh coalesces delayed work and cancels both retries on close', async () => {
	const h = await createView();
	let refreshed = 0;
	let disconnected = 0;
	h.view.lazyLoader = {
		refreshVisibility: () => { refreshed += 1; },
		disconnect: () => { disconnected += 1; },
	};
	h.view.refreshVisibleMedia();
	h.view.refreshVisibleMedia();
	assert.equal(refreshed, 2, 'each explicit request checks current visibility');
	assert.equal(h.pendingFrames(), 1);
	assert.equal(h.pendingTimers(), 1);
	await h.view.onClose();
	assert.equal(h.pendingFrames(), 0);
	assert.equal(h.pendingTimers(), 0);
	h.flushFrame();
	h.flushTimers();
	assert.equal(refreshed, 2);
	assert.equal(disconnected, 1);
});

void test('visibility retries run normally while the same loader remains active', async () => {
	const h = await createView();
	let refreshed = 0;
	h.view.lazyLoader = { refreshVisibility: () => { refreshed += 1; }, disconnect(): void {} };
	h.view.refreshVisibleMedia();
	h.flushFrame();
	h.flushTimers();
	assert.equal(refreshed, 3);
	assert.equal(h.pendingFrames(), 0);
	assert.equal(h.pendingTimers(), 0);
});

void test('layout control handles persistence errors with a notice', async () => {
	const savedModes: string[] = [];
	const h = await createView({
		setLayoutMode: (mode: string) => {
			savedModes.push(mode);
			return Promise.reject(new Error('Storage unavailable'));
		},
	});
	h.view.toggleLayoutMode();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(savedModes, ['aspect']);
	assert.equal(h.notices.length, 1);
	assert.match(h.notices[0]!, /Could not save the gallery layout/);
});
