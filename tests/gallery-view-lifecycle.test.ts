import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { TILE_RENDER_BATCH_SIZE } from '../src/constants';
import { buildMediaIndex, buildMediaSectionTree } from '../src/media-index';
import { buildVisibleMediaProjection } from '../src/gallery-search';
import type { IndexedMedia, MediaFileLike, MediaSectionTree } from '../src/types';
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
		unobserve?(element: object): void;
	} | null;
	renderRevision: number;
	currentTree: object | null;
	items: object[];
	mediaTrackingKeys: string[];
	showSections: boolean;
	searchOpen: boolean;
	searchQuery: string;
	mediaKindFilter: 'image' | 'video' | null;
	visibleMediaIndices: number[];
	searchButton: RenderElement | null;
	sectionToggleButton: RenderElement | null;
	filterButton: RenderElement | null;
	layoutButton: RenderElement | null;
	searchComponent: { inputEl: RenderElement } | null;
	countEl: RenderElement | null;
	searchStatusEl: RenderElement | null;
	displayedCollapsed: Set<string> | null;
	tilesByTrackingKey: Map<string, TestTile>;
	cancelPendingRender(): void;
	disposeSectionBody(body: object): void;
	enqueueTileTasks(tasks: TileTask[], revision: number): void;
	focusGalleryControl(tile: TestTile): void;
	recordLastViewedMedia(note: string, key: string): void;
	renderTile(grid: TileTask['grid'], item: object, index: number): void;
	setTileScale(value: number): void;
	setShowSections(show: boolean): void;
	refreshVisibleMedia(): void;
	refresh(force?: boolean): void;
	createGalleryItems(note: object, cache: object): object[];
	renderEmptyState(message: string): void;
	renderSummary(count: number, restoreSearchFocus: boolean): void;
	setupResizeHandling(): void;
	updateKeyboardFocusState(): void;
	scheduleKeyboardFocusState(): void;
	prepareRender(signature: string, media: object[], keys: string[], tree: object): number;
	rerenderCurrentProjection(reuseTiles?: boolean): void;
	renderCurrentProjection(revision?: number, collapsed?: Set<string>): void;
	renderHierarchy(tree: MediaSectionTree, collapsed: Set<string>, revision: number): void;
	toggleAllDisplayedSections(): void;
	handleToolbarKeydown(event: TestKeyEvent): void;
	handleSearchKeydown(event: TestKeyEvent): void;
	handleSearchQueryChange(value: string): void;
	handleGalleryKeydown(event: TestKeyEvent): void;
	showMediaFilterMenu(event: { detail: number }): void;
	getVisibleGalleryControls(): RenderElement[];
	findAdjacentTile(): RenderElement | null;
	findAdjacentGalleryControl(): RenderElement | null;
	getSectionHeaderFromEvent(): RenderElement | null;
	getTileFromEvent(): RenderElement | null;
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
}).then((result) => (notices: string[], menuCalls: MenuCall[]) => {
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
				setIcon(): void {},
				Menu: {
					forEvent: () => ({
						addItem(callback: (item: object) => void): void {
							const item = { setTitle(): object { return this; }, setIcon(): object { return this; }, setChecked(): object { return this; }, onClick(): object { return this; } };
							callback(item);
						},
						addSeparator(): void {},
						showAtPosition(position: { x: number; y: number }, document: object): void { menuCalls.push({ kind: 'position', position, document }); },
						showAtMouseEvent(event: object): void { menuCalls.push({ kind: 'pointer', event }); },
					}),
				},
			};
		},
		Element: class {},
		HTMLDetailsElement: class {},
		HTMLImageElement: class {},
		HTMLVideoElement: class {},
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
	menuCalls: MenuCall[];
	css: Record<string, string>;
	cssWrites: Record<string, string>[];
	resizeListeners: Set<() => void>;
	setContentWidth(width: number): void;
	classes: Set<string>;
	setFocusVisible(value: boolean): void;
	focusQueries: () => number;
}> {
	let nextFrame = 0;
	let nextTimer = 0;
	const frames = new Map<number, FrameRequestCallback>();
	const timers = new Map<number, () => void>();
	const notices: string[] = [];
	const menuCalls: MenuCall[] = [];
	const View = (await viewConstructor)(notices, menuCalls);
	const css: Record<string, string> = {};
	const cssWrites: Record<string, string>[] = [];
	const resizeListeners = new Set<() => void>();
	const classes = new Set<string>();
	let focusVisible = false;
	let focusQueries = 0;
	const view = new View({
		containerEl: {
			setCssProps(props: Record<string, string>): void {
				Object.assign(css, props);
				cssWrites.push(props);
			},
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
			clientWidth: 0,
			addClass(): void {},
			setAttr(): void {},
			before(): void {},
			contains: () => true,
			empty: (): void => { focusVisible = false; },
			querySelectorAll: () => [],
			removeAttribute(): void {},
			win: {
				addEventListener(type: string, callback: () => void): void {
					if (type === 'resize') resizeListeners.add(callback);
				},
				removeEventListener(type: string, callback: () => void): void {
					if (type === 'resize') resizeListeners.delete(callback);
				},
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
	}, { getShowSections: () => true, ...host });
	return {
		view,
		css,
		cssWrites,
		resizeListeners,
		setContentWidth: (width: number): void => { Object.assign(view.contentEl, { clientWidth: width }); },
		classes,
		setFocusVisible: (value: boolean): void => { focusVisible = value; },
		focusQueries: () => focusQueries,
		notices,
		menuCalls,
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
	readonly dataset: Record<string, string> = {};
	readonly children: RenderElement[] = [];
	readonly attributes = new Map<string, string>();
	readonly ownerDocument = {};
	parent: RenderElement | null = null;
	disabled = false;
	focused = false;
	tabIndex = 0;
	hidden = false;
	text = '';
	constructor(readonly tag = 'div') {}
	addClass(name: string): void { this.classes.add(name); }
	removeClass(name: string): void { this.classes.delete(name); }
	toggleClass(name: string, enabled: boolean): void { if (enabled) this.classes.add(name); else this.classes.delete(name); }
	setAttr(name: string, value: string): void { this.attributes.set(name, value); }
	removeAttribute(name: string): void { this.attributes.delete(name); }
	toggleAttribute(name: string, enabled: boolean): void { if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name); if (name === 'disabled') this.disabled = enabled; }
	setCssProps(): void {}
	setText(value: string): void { this.text = value; }
	appendText(value: string): void { this.text += value; }
	getClientRects(): object[] { return this.hidden ? [] : [{}]; }
	getBoundingClientRect(): { left: number; bottom: number } { return { left: 25, bottom: 45 }; }
	focus(): void { this.focused = true; }
	select(): void {}
	scrollIntoView(): void {}
	instanceOf(): boolean { return true; }
	empty(): void { for (const child of this.children) child.parent = null; this.children.length = 0; }
	contains(element: RenderElement): boolean { return element === this || this.children.some(child => child.contains(element)); }
	querySelectorAll(selector: string): RenderElement[] {
		const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
		return selector === '*' ? all : all.filter(child => selector.startsWith('.') ? child.classes.has(selector.slice(1)) : selector.split(', ').includes(child.tag));
	}
	appendChild(child: RenderElement): void {
		if (child.parent) {
			const index = child.parent.children.indexOf(child);
			if (index !== -1) child.parent.children.splice(index, 1);
		}
		this.children.push(child);
		child.parent = this;
	}
	private createNode(tag: string, options: { cls?: string | string[]; text?: string }): RenderElement {
		const child = new RenderElement(tag);
		if (options.cls) for (const name of Array.isArray(options.cls) ? options.cls : options.cls.split(' ')) child.addClass(name);
		if (options.text) child.text = options.text;
		this.appendChild(child);
		return child;
	}
	createEl(tag: string, options: { cls?: string | string[]; text?: string } = {}): RenderElement { return this.createNode(tag, options); }
	createSpan(options: { cls?: string; text?: string } = {}): RenderElement { return this.createNode('span', options); }
	createDiv(options: { cls?: string } = {}): RenderElement { return this.createNode('div', options); }
}

interface TestKeyEvent {
	key: string;
	target: object;
	defaultPrevented: boolean;
	isComposing?: boolean;
	shiftKey?: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

interface MenuCall {
	kind: 'pointer' | 'position';
	position?: { x: number; y: number };
	document?: object;
	event?: object;
}

function keyEvent(key: string, target: object, options: Partial<TestKeyEvent> = {}): TestKeyEvent {
	return { key, target, defaultPrevented: false, preventDefault(): void { this.defaultPrevented = true; }, stopPropagation(): void {}, ...options };
}

function installRenderedContent(view: TestGalleryView): RenderElement {
	const previous = view.contentEl as { win: object };
	const content = Object.assign(new RenderElement(), { win: previous.win });
	view.contentEl = content;
	return content;
}

function mediaFixture({
	offsetShift = 0,
	names = ['first.jpg', 'movie.mp4', 'last.jpg'],
	firstHeading = 'Alpha',
}: {
	offsetShift?: number;
	names?: readonly string[];
	firstHeading?: string;
} = {}): { items: IndexedMedia<MediaFileLike>[]; tree: MediaSectionTree } {
	const media = buildMediaIndex(
		names.map((link, index) => ({ link, position: { offset: offsetShift + index * 10 + 10, line: index, column: 0 } })),
		[
			{ heading: firstHeading, level: 1, position: { offset: offsetShift } },
			{ heading: 'Beta', level: 1, position: { offset: offsetShift + 25 } },
		],
		(link) => ({ name: link, path: link, extension: link.split('.').at(-1)!, stat: { mtime: 1, size: 2 } }),
		'No heading',
	);
	return { items: media, tree: buildMediaSectionTree(media, 'No heading') };
}

function installViewResizeObserver(view: TestGalleryView): {
	observed: object[];
	notify(): void;
	isDisconnected(): boolean;
} {
	const observed: object[] = [];
	let disconnected = false;
	let notify: () => void = () => undefined;
	Object.assign((view.contentEl as { win: object }).win, {
		ResizeObserver: class {
			constructor(callback: typeof notify) { notify = callback; }
			observe(element: object): void { observed.push(element); }
			disconnect(): void { disconnected = true; }
		},
	});
	return { observed, notify: (): void => { notify(); }, isDisconnected: (): boolean => disconnected };
}

function prepareRefreshView(view: TestGalleryView): void {
	view.app = { metadataCache: { getFileCache: () => ({}) } };
	Object.assign(view.contentEl, {
		ownerDocument: { activeElement: null },
		addEventListener(): void {},
		removeEventListener(): void {},
	});
	Object.assign((view.contentEl as { win: object }).win, {
		addEventListener(): void {},
	});
	view.renderSummary = () => undefined;
	view.renderCurrentProjection = () => undefined;
}

void test('flat tiles ignore saved collapse choices but retain content order, heading search, and viewer filtering', async () => {
	const h = await createView();
	const content = installRenderedContent(h.view);
	const fixture = mediaFixture();
	const collapsed = new Set([fixture.tree.children[0]!.structuralKey]);
	h.view.items = fixture.items;
	h.view.currentTree = fixture.tree;
	h.view.showSections = false;
	h.view.sectionToggleButton = new RenderElement('button');
	h.view.countEl = new RenderElement('span');
	h.view.lazyLoader = { refreshVisibility(): void {}, disconnect(): void {}, observe(): void {}, unobserve(): void {} };
	h.view.renderCurrentProjection(h.view.renderRevision, collapsed);
	h.flushFrame();
	assert.equal(content.children.length, 1);
	assert.equal(content.children[0]!.classes.has('section-gallery-grid'), true);
	assert.equal(content.querySelectorAll('.section-gallery-section').length, 0);
	assert.deepEqual(content.querySelectorAll('.section-gallery-tile').map(tile => tile.dataset.mediaIndex), ['0', '1', '2']);
	assert.equal(h.view.sectionToggleButton.disabled, true);
	h.view.toggleAllDisplayedSections();
	assert.deepEqual(Array.from(collapsed), [fixture.tree.children[0]!.structuralKey]);

	h.view.searchOpen = true;
	h.view.searchQuery = 'Alpha';
	h.view.mediaKindFilter = 'video';
	h.view.getCurrentCollapsedState = () => collapsed;
	h.view.rerenderCurrentProjection();
	h.flushFrame();
	assert.deepEqual(Array.from(h.view.visibleMediaIndices), [1], 'section titles still include matching media before type filtering');
	assert.equal(h.view.countEl.text, '1 / 3');
	assert.deepEqual(content.querySelectorAll('.section-gallery-tile').map(tile => tile.dataset.mediaIndex), ['1']);
	const projection = buildVisibleMediaProjection(h.view.items, h.view.visibleMediaIndices, 1);
	assert.deepEqual(projection?.originalIndices, [1]);
	assert.equal(projection?.items[0], fixture.items[1]);
	assert.equal(projection?.initialIndex, 0);
});

void test('show sections switches presentation live without rescanning or reloading existing thumbnails and restores collapse choices', async () => {
	const h = await createView();
	const content = installRenderedContent(h.view);
	const fixture = mediaFixture();
	const collapsed = new Set([fixture.tree.children[0]!.structuralKey]);
	h.view.items = fixture.items;
	h.view.currentTree = fixture.tree;
	h.view.showSections = false;
	h.view.getCurrentCollapsedState = () => collapsed;
	h.view.currentNotePath = 'gallery.md';
	h.view.mediaTrackingKeys = ['first', 'second', 'third'];
	let observed = 0;
	let unobserved = 0;
	h.view.lazyLoader = {
		refreshVisibility(): void {}, disconnect(): void {},
		observe(): void { observed += 1; }, unobserve(): void { unobserved += 1; },
	};
	h.view.renderCurrentProjection(h.view.renderRevision, collapsed);
	h.flushFrame();
	const firstTiles = content.querySelectorAll('.section-gallery-tile');
	h.view.recordLastViewedMedia('gallery.md', 'third');
	assert.equal(observed, 3);
	let renderedHierarchy: Set<string> | null = null;
	h.view.renderHierarchy = (_tree, state, revision) => {
		renderedHierarchy = state;
		const grid = content.createDiv({ cls: 'section-gallery-grid' });
		h.view.enqueueTileTasks([{ grid, index: 2, item: fixture.items[2]! }], revision);
	};
	h.view.refresh = () => { assert.fail('changing section visibility must not rescan the note'); };
	h.view.setShowSections(true);
	h.flushFrame();
	assert.equal(renderedHierarchy, collapsed);
	assert.equal(content.querySelectorAll('.section-gallery-tile')[0], firstTiles[2], 'keep the same loaded media node when moving between presentations');
	assert.equal(observed, 3);
	assert.equal(unobserved, 2, 'only the previously visible media now hidden by saved collapse are released');
	assert.equal(h.view.lastViewedTileEl, firstTiles[2]);
	assert.equal(content.querySelectorAll('.section-gallery-tile').filter(tile => tile.classes.has('is-last-viewed')).length, 1);
	assert.deepEqual(Array.from(collapsed), [fixture.tree.children[0]!.structuralKey]);
	const revision = h.view.renderRevision;
	h.view.setShowSections(true);
	assert.equal(h.view.renderRevision, revision, 'an unchanged setting does not rebuild the DOM');
});

void test('keyboard filter activation anchors the menu at its toolbar button while pointer clicks retain native placement', async () => {
	const h = await createView();
	const button = new RenderElement('button');
	h.view.filterButton = button;
	h.view.showMediaFilterMenu({ detail: 0 });
	assert.equal(h.menuCalls[0]?.kind, 'position');
	assert.equal(h.menuCalls[0]?.position?.x, 25);
	assert.equal(h.menuCalls[0]?.position?.y, 45);
	assert.equal(h.menuCalls[0]?.document, button.ownerDocument);
	const event = { detail: 1 };
	h.view.showMediaFilterMenu(event);
	assert.equal(h.menuCalls[1]?.kind, 'pointer');
	assert.equal(h.menuCalls[1]?.event, event);
});

void test('section visibility changed before a pending search render does not reuse stale filename highlights', async () => {
	const h = await createView();
	const content = installRenderedContent(h.view);
	const fixture = mediaFixture();
	const collapsed = new Set<string>();
	h.view.items = fixture.items;
	h.view.currentTree = fixture.tree;
	h.view.showSections = false;
	h.view.getCurrentCollapsedState = () => collapsed;
	let observed = 0;
	h.view.lazyLoader = { refreshVisibility(): void {}, disconnect(): void {}, observe(): void { observed += 1; }, unobserve(): void {} };
	h.view.renderCurrentProjection(h.view.renderRevision, collapsed);
	h.flushFrame();
	const previousMovieTile = content.querySelectorAll('.section-gallery-tile')[1];
	h.view.renderHierarchy = (_tree, _state, revision) => {
		const grid = content.createDiv({ cls: 'section-gallery-grid' });
		h.view.enqueueTileTasks([{ grid, index: 1, item: fixture.items[1]! }], revision);
	};
	h.view.searchOpen = true;
	h.view.handleSearchQueryChange('movie');
	h.view.setShowSections(true);
	h.flushFrame();
	const movieTile = content.querySelectorAll('.section-gallery-tile')[0]!;
	assert.notEqual(movieTile, previousMovieTile);
	assert.equal(movieTile.classes.has('is-search-match'), true);
	assert.equal(movieTile.querySelectorAll('.section-gallery-search-filename').length, 1);
	assert.equal(observed, 4, 'new matching labels require rebuilding the changed projection');
});

void test('desktop arrows connect results, enabled toolbar buttons, and the search field without hijacking caret or Tab keys', async () => {
	const h = await createView();
	const controls = Array.from({ length: 4 }, () => new RenderElement('button'));
	const search = controls[0]!;
	const collapse = controls[1]!;
	const filter = controls[2]!;
	const layout = controls[3]!;
	h.view.searchButton = search;
	h.view.sectionToggleButton = collapse;
	h.view.filterButton = filter;
	h.view.layoutButton = layout;
	const firstTile = new RenderElement('button');
	const input = new RenderElement('input');
	h.view.getVisibleGalleryControls = () => [firstTile];
	h.view.searchComponent = { inputEl: input };
	h.view.getSectionHeaderFromEvent = () => null;
	h.view.getTileFromEvent = () => firstTile;
	h.view.findAdjacentTile = () => null;
	h.view.findAdjacentGalleryControl = () => null;
	const upward = keyEvent('ArrowUp', firstTile);
	h.view.handleGalleryKeydown(upward);
	assert.equal(search.focused, true);
	assert.equal(upward.defaultPrevented, true);
	collapse.disabled = true;
	h.view.handleToolbarKeydown(keyEvent('ArrowRight', search));
	assert.equal(filter.focused, true, 'skip the disabled collapse control in flat mode');
	h.view.handleToolbarKeydown(keyEvent('ArrowRight', filter));
	assert.equal(layout.focused, true);
	layout.focused = false;
	const edge = keyEvent('ArrowRight', layout);
	h.view.handleToolbarKeydown(edge);
	assert.equal(edge.defaultPrevented, false, 'no wraparound at toolbar edges');
	h.view.handleToolbarKeydown(keyEvent('ArrowDown', search));
	assert.equal(firstTile.focused, true);
	h.view.searchOpen = true;
	h.view.handleToolbarKeydown(keyEvent('ArrowDown', filter));
	assert.equal(input.focused, true);
	search.focused = false;
	h.view.handleSearchKeydown(keyEvent('ArrowUp', input));
	assert.equal(search.focused, true);
	firstTile.focused = false;
	h.view.handleSearchKeydown(keyEvent('ArrowDown', input));
	assert.equal(firstTile.focused, true);
	for (const key of ['ArrowLeft', 'ArrowRight', 'Tab']) {
		const event = keyEvent(key, input);
		h.view.handleSearchKeydown(event);
		assert.equal(event.defaultPrevented, false, `${key} retains native text-field behavior`);
	}
	for (const key of ['Tab', 'ArrowLeft', 'ArrowDown']) {
		const event = keyEvent(key, filter, { shiftKey: true });
		h.view.handleToolbarKeydown(event);
		assert.equal(event.defaultPrevented, false, `${key} with Shift retains native behavior`);
	}
});

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

void test('unchanged refresh retains tracking keys but adopts fresh media and section offsets', async () => {
	const note = { path: 'gallery.md', basename: 'gallery' };
	const { view } = await createView({ getActiveNote: () => note });
	prepareRefreshView(view);
	let fixture = mediaFixture();
	view.createGalleryItems = () => fixture.items;
	view.refresh();
	const keys = view.mediaTrackingKeys;
	const tree = view.currentTree;
	const revision = view.renderRevision;
	const loader = view.lazyLoader;

	fixture = mediaFixture({ offsetShift: 50 });
	view.refresh();
	assert.equal(view.mediaTrackingKeys, keys, 'unchanged ordered media reuses the tracking key array');
	assert.equal(view.items, fixture.items, 'fresh media objects retain current embed positions');
	assert.equal(fixture.items[0]!.source.offset, 60);
	assert.notEqual(view.currentTree, tree, 'section source offsets must not remain stale');
	assert.deepEqual(Array.from((view.currentTree as MediaSectionTree).children, section => section.sourceOffset), [50, 75]);
	assert.equal(view.renderRevision, revision, 'unchanged visual content does not rerender');
	assert.equal(view.lazyLoader, loader, 'unchanged visual content keeps its loader');
	await view.onClose();
});

void test('forced refresh recomputes tracking keys even with an unchanged visual signature', async () => {
	const note = { path: 'gallery.md', basename: 'gallery' };
	const { view } = await createView({ getActiveNote: () => note });
	prepareRefreshView(view);
	const fixture = mediaFixture({ names: ['same.jpg', 'same.jpg', 'last.jpg'] });
	view.createGalleryItems = () => fixture.items;
	view.refresh();
	const keys = view.mediaTrackingKeys;
	const revision = view.renderRevision;
	view.refresh(true);
	assert.notEqual(view.mediaTrackingKeys, keys, 'force bypasses tracking key reuse');
	assert.deepEqual(Array.from(view.mediaTrackingKeys), Array.from(keys), 'duplicate occurrence identities remain stable');
	assert.ok(view.renderRevision > revision, 'force still rebuilds the projection');
	await view.onClose();
});

void test('media reordering and heading changes invalidate tracking key reuse', async () => {
	for (const change of [
		{ names: ['movie.mp4', 'first.jpg', 'last.jpg'] },
		{ firstHeading: 'Renamed' },
	]) {
		const note = { path: 'gallery.md', basename: 'gallery' };
		const { view } = await createView({ getActiveNote: () => note });
		prepareRefreshView(view);
		let fixture = mediaFixture();
		view.createGalleryItems = () => fixture.items;
		view.refresh();
		const keys = view.mediaTrackingKeys;
		const revision = view.renderRevision;
		fixture = mediaFixture(change);
		view.refresh();
		assert.notEqual(view.mediaTrackingKeys, keys, 'changed signature recomputes keys');
		assert.notDeepEqual(Array.from(view.mediaTrackingKeys), Array.from(keys));
		assert.ok(view.renderRevision > revision, 'changed content still rebuilds the projection');
		await view.onClose();
	}
});

void test('tile scale changes only the scoped layout variable without rebuilding tiles', async () => {
	const { view, css, pendingFrames } = await createView();
	const revision = view.renderRevision;
	view.setTileScale(146);
	assert.equal(css['--section-gallery-tile-scale'], '1.46');
	assert.equal(view.renderRevision, revision);
	assert.equal(pendingFrames(), 0);
	view.setTileScale(10000);
	assert.equal(css['--section-gallery-tile-scale'], '100');
	view.setTileScale(1000000);
	assert.equal(css['--section-gallery-tile-scale'], '1000', 'Malformed extremes remain safety bounded');
	assert.equal(view.renderRevision, revision, 'Large tiles still resize without rebuilding previews');
});

void test('pane ResizeObserver preserves the selected scale and media state while updating visibility only', async () => {
	const h = await createView({ getLayoutMode: () => 'square', getTileScale: () => 150 });
	const observer = installViewResizeObserver(h.view);
	h.view.refresh = () => undefined;
	await h.view.onOpen();
	assert.deepEqual(observer.observed, [h.view.contentEl], 'Only the existing content is observed');
	const fixture = mediaFixture();
	const keys = ['first', 'movie', 'last'];
	let refreshed = 0;
	let disconnected = 0;
	const loader = { refreshVisibility(): void { refreshed += 1; }, disconnect(): void { disconnected += 1; } };
	h.view.lazyLoader = loader;
	h.view.items = fixture.items;
	h.view.mediaTrackingKeys = keys;
	h.view.currentTree = fixture.tree;
	const tile: TestTile = {
		classes: new Set(), dataset: { mediaTrackingKey: 'first' },
		addClass(name): void { this.classes.add(name); },
		removeClass(name): void { this.classes.delete(name); },
		removeAttribute(): void {}, setAttr(): void {}, focus(): void {}, scrollIntoView(): void {},
	};
	h.view.lastViewedTileEl = tile;
	h.view.tilesByTrackingKey.set('first', tile);
	const revision = h.view.renderRevision;
	const writes = h.cssWrites.length;
	for (const width of [300, 180, 500, 0, 1000]) {
		h.setContentWidth(width);
		observer.notify();
		assert.equal(h.css['--section-gallery-tile-scale'], '1.5', 'Pane width cannot change the chosen scale');
	}
	assert.equal(refreshed, 5);
	assert.equal(disconnected, 0, 'Resizing does not invalidate the loader cache');
	assert.equal(h.view.lazyLoader, loader);
	assert.equal(h.view.items, fixture.items);
	assert.equal(h.view.mediaTrackingKeys, keys);
	assert.equal(h.view.currentTree, fixture.tree);
	assert.equal(h.view.lastViewedTileEl, tile);
	assert.equal(h.view.tilesByTrackingKey.get('first'), tile);
	assert.equal(h.view.renderRevision, revision);
	assert.equal(h.cssWrites.length, writes, 'Resizing does not rewrite layout variables');
	assert.equal(h.pendingFrames(), 0);
	assert.equal(h.pendingTimers(), 0);
	await h.view.onClose();
	assert.equal(observer.isDisconnected(), true);
	assert.equal(disconnected, 1);
	observer.notify();
	assert.equal(refreshed, 5, 'A closed view cannot refresh its former loader');
});

void test('fallback window resize preserves scale through hidden drawer changes and removes its listener on close', async () => {
	const h = await createView({ getLayoutMode: () => 'square', getTileScale: () => 120 });
	h.view.refresh = () => undefined;
	await h.view.onOpen();
	assert.equal(h.resizeListeners.size, 1);
	let refreshed = 0;
	let disconnected = 0;
	const loader = { refreshVisibility(): void { refreshed += 1; }, disconnect(): void { disconnected += 1; } };
	h.view.lazyLoader = loader;
	const revision = h.view.renderRevision;
	const writes = h.cssWrites.length;
	for (const width of [0, 180, 400, 1000]) {
		h.setContentWidth(width);
		for (const resize of h.resizeListeners) resize();
		assert.equal(h.css['--section-gallery-tile-scale'], '1.2');
	}
	assert.equal(refreshed, 4);
	assert.equal(disconnected, 0);
	assert.equal(h.view.lazyLoader, loader);
	assert.equal(h.view.renderRevision, revision);
	assert.equal(h.cssWrites.length, writes);
	assert.equal(h.pendingFrames(), 0);
	assert.equal(h.pendingTimers(), 0);
	await h.view.onClose();
	assert.equal(h.resizeListeners.size, 0);
	assert.equal(disconnected, 1);
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
