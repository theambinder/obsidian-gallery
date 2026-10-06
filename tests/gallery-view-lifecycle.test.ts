import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { TILE_RENDER_BATCH_SIZE } from '../src/constants';
import type { VideoTileMetadata } from '../src/video-metadata';

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
	app: { metadataCache: { getFileCache(note: object): object | null } };
	containerEl: object;
	contentEl: object;
	currentNotePath: string | null;
	focusStateFrame: number | null;
	lastViewedMediaByNote: Map<string, string>;
	lastViewedTileEl: TestTile | null;
	lazyLoader: {
		refreshVisibility(): void;
		disconnect(): void;
		observe?(element: object, item: object, visibility?: undefined, update?: (metadata: VideoTileMetadata) => void): void;
	} | null;
	renderRevision: number;
	currentTree: object | null;
	tilesByTrackingKey: Map<string, TestTile>;
	cancelPendingRender(): void;
	disposeSectionBody(body: object): void;
	enqueueTileTasks(tasks: TileTask[], revision: number): void;
	focusGalleryControl(tile: TestTile): void;
	recordLastViewedMedia(note: string, key: string): void;
	renderTile(grid: TileTask['grid'], item: object, index: number): void;
	setTileScale(value: number): void;
	refreshVisibleMedia(): void;
	refresh(): void;
	renderEmptyState(message: string): void;
	setupResizeHandling(): void;
	updateKeyboardFocusState(): void;
	scheduleKeyboardFocusState(): void;
	prepareRender(signature: string, media: object[], keys: string[], tree: object): number;
	rerenderCurrentProjection(): void;
	renderCurrentProjection(): void;
	getCurrentCollapsedState(): Set<string> | null;
	onOpen(): Promise<void>;
	onClose(): Promise<void>;
	toggleLayoutMode(): void;
	registrations: { element: object; type: string; callback: (event?: unknown) => void }[];
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
					registrations: { element: object; type: string; callback: (event?: unknown) => void }[] = [];
					constructor(leaf: { contentEl: unknown; containerEl: unknown }) {
						this.contentEl = leaf.contentEl;
						this.containerEl = leaf.containerEl;
					}
					registerDomEvent(element: object, type: string, callback: (event?: unknown) => void): void {
						this.registrations.push({ element, type, callback });
					}
					addAction(): void {}
				},
				Platform: { isMobile: false },
				Notice: class { constructor(message: string) { notices.push(message); } },
			};
		},
		Element: class {},
		HTMLDetailsElement: class {},
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
	classes: Set<string>;
	setFocusVisible(value: boolean): void;
	focusQueries: () => number;
}> {
	let nextFrame = 0;
	let nextTimer = 0;
	const frames = new Map<number, FrameRequestCallback>();
	const timers = new Map<number, () => void>();
	const notices: string[] = [];
	const View = (await viewConstructor)(notices);
	const css: Record<string, string> = {};
	const classes = new Set<string>();
	let focusVisible = false;
	let focusQueries = 0;
	const view = new View({
		containerEl: {
			setCssProps: (props: Record<string, string>) => Object.assign(css, props),
			addClass(name: string): void { classes.add(name); },
			removeClass(...names: string[]): void { for (const name of names) classes.delete(name); },
			toggleClass(name: string, enabled: boolean): void { if (enabled) classes.add(name); else classes.delete(name); },
			querySelector(selector: string): object | null {
				assert.equal(selector, ':focus-visible');
				focusQueries += 1;
				return focusVisible ? {} : null;
			},
			createSpan: () => ({ id: '', remove(): void {} }),
		},
		contentEl: {
			addClass(): void {},
			setAttr(): void {},
			before(): void {},
			contains: () => true,
			empty: (): void => { focusVisible = false; },
			querySelectorAll: () => [],
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
		classes,
		setFocusVisible: (value: boolean): void => { focusVisible = value; },
		focusQueries: () => focusQueries,
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

class RenderElement {
	readonly isConnected = true;
	readonly classes = new Set<string>();
	readonly dataset = {};
	readonly children: RenderElement[] = [];
	hidden = false;
	text = '';
	addClass(name: string): void { this.classes.add(name); }
	removeClass(name: string): void { this.classes.delete(name); }
	toggleClass(name: string, enabled: boolean): void { if (enabled) this.classes.add(name); else this.classes.delete(name); }
	setAttr(): void {}
	setCssProps(): void {}
	setText(value: string): void { this.text = value; }
	private createNode(options: { cls?: string; text?: string }): RenderElement {
		const child = new RenderElement();
		if (options.cls) child.addClass(options.cls);
		if (options.text) child.text = options.text;
		this.children.push(child);
		return child;
	}
	createEl(_tag: string, options: { cls?: string; text?: string } = {}): RenderElement { return this.createNode(options); }
	createSpan(options: { cls?: string; text?: string } = {}): RenderElement { return this.createNode(options); }
	createDiv(options: { cls?: string } = {}): RenderElement { return this.createNode(options); }
}

void test('pending note metadata uses plain-language loading copy and deduplicates refreshes', async () => {
	const note = { path: 'pending.md' };
	const { view } = await createView({ getActiveNote: () => note });
	const messages: string[] = [];
	view.app = {
		metadataCache: {
			getFileCache(file): null {
				assert.equal(file, note);
				return null;
			},
		},
	};
	view.renderEmptyState = (message) => { messages.push(message); };
	view.refresh();
	assert.deepEqual(messages, ['Gallery is waiting for this note to finish loading.']);
	const revision = view.renderRevision;
	view.refresh();
	assert.equal(view.renderRevision, revision);
	assert.equal(messages.length, 1, 'unchanged pending metadata does not render twice');
});

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

void test('keyboard focus state is registered on the gallery subtree, not the document', async () => {
	const h = await createView({ getLayoutMode: () => 'square', getTileScale: () => 100 });
	h.view.setupResizeHandling = () => undefined;
	h.view.refresh = () => undefined;
	await h.view.onOpen();
	const focusHandlers = h.view.registrations.filter(({ element }) => element === h.view.containerEl);
	assert.deepEqual(Array.from(focusHandlers, ({ type }) => type), ['focusin', 'focusout', 'keydown', 'pointerdown']);
	assert.equal(h.classes.has('has-keyboard-focus'), false);
	h.setFocusVisible(true);
	focusHandlers.find(({ type }) => type === 'focusin')?.callback();
	assert.equal(h.classes.has('has-keyboard-focus'), true);
	h.setFocusVisible(false);
	focusHandlers.find(({ type }) => type === 'focusout')?.callback();
	assert.equal(h.classes.has('has-keyboard-focus'), false);
});

void test('modality changes coalesce before paint and close cancels pending focus work', async () => {
	const h = await createView();
	h.view.scheduleKeyboardFocusState();
	h.view.scheduleKeyboardFocusState();
	assert.equal(h.pendingFrames(), 1);
	assert.equal(h.focusQueries(), 0, 'read after the event default action');
	h.setFocusVisible(true);
	h.flushFrame();
	assert.equal(h.focusQueries(), 1);
	assert.equal(h.classes.has('has-keyboard-focus'), true);
	assert.equal(h.view.focusStateFrame, null);
	h.setFocusVisible(false);
	h.view.scheduleKeyboardFocusState();
	h.flushFrame();
	assert.equal(h.classes.has('has-keyboard-focus'), false, 'pointer modality removes only the scoped state');
	h.setFocusVisible(true);
	h.view.updateKeyboardFocusState();
	h.view.scheduleKeyboardFocusState();
	await h.view.onClose();
	assert.equal(h.pendingFrames(), 0);
	assert.equal(h.classes.has('has-keyboard-focus'), false);
	const readsOnClose = h.focusQueries();
	h.flushFrame();
	assert.equal(h.focusQueries(), readsOnClose);
});

void test('handled summary keys refresh focus-visible even when expansion stops key bubbling without moving focus', async () => {
	const h = await createView({ getLayoutMode: () => 'square', getTileScale: () => 100 });
	h.view.setupResizeHandling = () => undefined;
	h.view.refresh = () => undefined;
	await h.view.onOpen();
	const details = { open: false, instanceOf: () => true };
	const header = { parentElement: details, instanceOf: () => true, closest: () => header };
	let propagationStopped = false;
	const event = {
		key: 'ArrowRight',
		target: header,
		targetNode: header,
		defaultPrevented: false,
		preventDefault(): void { this.defaultPrevented = true; },
		stopPropagation(): void { propagationStopped = true; },
	};
	const contentHandler = h.view.registrations.find(({ element, type }) => element === h.view.contentEl && type === 'keydown');
	const containerHandler = h.view.registrations.find(({ element, type }) => element === h.view.containerEl && type === 'keydown');
	assert.ok(contentHandler);
	assert.ok(containerHandler);
	assert.equal(h.classes.has('has-keyboard-focus'), false, 'summary was pointer-focused');
	h.setFocusVisible(true); // Native modality changes on first key, with no focus event.
	contentHandler.callback(event);
	if (!propagationStopped) containerHandler.callback(event);
	assert.equal(propagationStopped, true);
	assert.equal(event.defaultPrevented, true);
	assert.equal(details.open, true);
	assert.equal(h.pendingFrames(), 1, 'the consumed event still schedules one focus-state read');
	h.flushFrame();
	assert.equal(h.classes.has('has-keyboard-focus'), true);
});

void test('focused DOM replacement clears stale keyboard focus without requiring focusout', async () => {
	const h = await createView();
	h.setFocusVisible(true);
	h.view.updateKeyboardFocusState();
	assert.equal(h.classes.has('has-keyboard-focus'), true);
	h.view.prepareRender('replacement', [], [], {});
	assert.equal(h.classes.has('has-keyboard-focus'), false);
	h.view.currentTree = {};
	h.view.getCurrentCollapsedState = () => new Set();
	h.view.renderCurrentProjection = () => undefined;
	h.setFocusVisible(true);
	h.view.updateKeyboardFocusState();
	h.view.rerenderCurrentProjection();
	assert.equal(h.classes.has('has-keyboard-focus'), false);
	// A focused search field in the persistent toolbar must keep its state
	// while an unrelated section body is detached.
	h.setFocusVisible(true);
	h.view.disposeSectionBody({ contains: () => false, querySelectorAll: () => [], remove(): void {} });
	assert.equal(h.classes.has('has-keyboard-focus'), true);
	h.view.disposeSectionBody({ contains: () => false, querySelectorAll: () => [], remove: () => h.setFocusVisible(false) });
	assert.equal(h.classes.has('has-keyboard-focus'), false);
});

void test('video duration hook preserves filename placement before metadata and with unavailable duration', async () => {
	const { view } = await createView();
	let updateMetadata: ((metadata: VideoTileMetadata) => void) | undefined;
	view.lazyLoader = {
		refreshVisibility(): void {},
		disconnect(): void {},
		observe(_element, _item, _visibility, update): void { updateMetadata = update; },
	};
	const grid = new RenderElement();
	view.renderTile(grid, { kind: 'video', file: { name: 'clip.mp4', path: 'clip.mp4', stat: { mtime: 1, size: 2 } } }, 0);
	const tile = grid.children[0]!;
	const frame = tile.children.find(child => child.classes.has('section-gallery-video-frame'))!;
	const badge = frame.children.find(child => child.classes.has('section-gallery-video-duration'))!;
	assert.equal(tile.classes.has('has-video-duration'), true);
	assert.equal(badge.hidden, true, 'metadata has not arrived');
	assert.ok(updateMetadata);
	updateMetadata({ width: 1280, height: 720, durationSeconds: 61 });
	assert.equal(badge.text, '1:01');
	assert.equal(badge.hidden, false);
	updateMetadata({ width: 1280, height: 720, durationSeconds: Number.NaN });
	assert.equal(badge.hidden, true);
	assert.equal(tile.classes.has('has-video-duration'), true, 'same placement as the former presence-based selector');
	const imageGrid = new RenderElement();
	view.renderTile(imageGrid, { kind: 'image', file: { name: 'image.jpg' } }, 1);
	assert.equal(imageGrid.children[0]!.classes.has('has-video-duration'), false);
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
