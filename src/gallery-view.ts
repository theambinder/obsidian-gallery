import {
	ItemView,
	Menu,
	Notice,
	Platform,
	SearchComponent,
	setIcon,
	type CachedMetadata,
	type TFile,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	TILE_RENDER_BATCH_SIZE,
	VIEW_NAME,
	VIEW_TYPE_SECTION_GALLERY,
} from './constants';
import { LazyMediaLoader } from './lazy-media-loader';
import { showMediaContextMenu } from './media-context-menu';
import {
	findGalleryControlFallbackIndex,
	findGalleryToolbarControlIndex,
	getSectionNavigationIntent,
	isGalleryArrowKey,
	type GalleryArrowKey,
} from './gallery-keyboard-navigation';
import {
	buildVisibleMediaProjection,
	clearGallerySearchCollapseForNoteChange,
	createGallerySearchExcerpt,
	filterMediaSectionTree,
	normalizeGallerySearchQuery,
	segmentGallerySearchText,
	type GallerySearchResult,
	type GallerySearchTextSegment,
} from './gallery-search';
import {
	buildLastViewedMediaKeys,
	shouldRestoreLastViewedMediaFocus,
} from './last-viewed-media';
import { buildMediaIndex, buildMediaSectionTree } from './media-index';
import { normalizeTileScale } from './settings';
import {
	getRatioIconArrowPaths,
	RATIO_ICON_FRAME_PATH,
} from './ratio-icon';
import {
	formatMediaDuration,
	getContainedVideoOffsets,
	type VideoTileMetadata,
} from './video-metadata';
import type {
	EmbedReference,
	GalleryLayoutMode,
	GalleryMedia,
	HeadingReference,
	MediaKind,
	MediaSectionNode,
	MediaSectionTree,
} from './types';

export interface GalleryViewHost {
	getActiveNote(): TFile | null;
	getLayoutMode(): GalleryLayoutMode;
	getTileScale(): number;
	getShowSections(): boolean;
	openLightbox(
		media: readonly GalleryMedia[],
		initialIndex: number,
		onViewed: (item: GalleryMedia, index: number) => void,
		restoreFocus?: () => void,
	): void;
	revealSource(media: GalleryMedia): Promise<void>;
	setLayoutMode(mode: GalleryLayoutMode): Promise<void>;
}

interface TileRenderTask {
	grid: HTMLElement;
	index: number;
	item: GalleryMedia;
}

let nextGalleryRegionLabelId = 0;
let nextGallerySearchId = 0;

export class SectionGalleryView extends ItemView {
	private readonly collapsedByNote = new Map<string, Set<string>>();
	private countEl: HTMLElement | null = null;
	private currentNotePath: string | null = null;
	private currentTree: MediaSectionTree | null = null;
	private displayedCollapsed: Set<string> | null = null;
	private displayedTree: MediaSectionTree | null = null;
	private filterButton: HTMLButtonElement | null = null;
	private focusStateFrame: number | null = null;
	private items: GalleryMedia[] = [];
	private readonly lastViewedMediaByNote = new Map<string, string>();
	private lastViewedTileEl: HTMLButtonElement | null = null;
	private layoutButton: HTMLButtonElement | null = null;
	private layoutMode: GalleryLayoutMode = 'square';
	private lazyLoader: LazyMediaLoader | null = null;
	private mediaKindFilter: MediaKind | null = null;
	private mediaTrackingKeys: string[] = [];
	private pendingTileTasks: TileRenderTask[] = [];
	private pendingTileCursor = 0;
	private renderFrame: number | null = null;
	private renderRevision = 0;
	private renderSignature: string | null = null;
	private readonly reusableTilesByIndex = new Map<number, HTMLButtonElement>();
	private regionLabelEl: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private readonly searchCollapsed = new Set<string>();
	private searchButton: HTMLButtonElement | null = null;
	private searchComponent: SearchComponent | null = null;
	private searchOpen = false;
	private searchQuery = '';
	private searchRenderFrame: number | null = null;
	private searchResult: GallerySearchResult | null = null;
	private searchRowEl: HTMLElement | null = null;
	private searchStatusEl: HTMLElement | null = null;
	private sectionToggleButton: HTMLButtonElement | null = null;
	private showSections = true;
	private summaryEl: HTMLElement | null = null;
	private readonly tilesByTrackingKey = new Map<
		string,
		HTMLButtonElement
	>();
	private videoTileMetadata = new Map<string, VideoTileMetadata>();
	private visibleMediaIndices: readonly number[] = [];
	private visibleRefreshFrame: number | null = null;
	private visibleRefreshTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: GalleryViewHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SECTION_GALLERY;
	}

	getDisplayText(): string {
		return VIEW_NAME;
	}

	getIcon(): string {
		return 'images';
	}

	onOpen(): Promise<void> {
		this.containerEl.addClass('section-gallery-view');
		this.contentEl.addClass('section-gallery-content');
		this.contentEl.tabIndex = 0;
		this.contentEl.setAttr('role', 'region');
		this.contentEl.removeAttribute('aria-label');
		this.regionLabelEl = this.containerEl.createSpan({
			cls: 'section-gallery-screen-reader-only',
			text: 'Gallery media',
		});
		nextGalleryRegionLabelId += 1;
		this.regionLabelEl.id = `section-gallery-region-label-${nextGalleryRegionLabelId}`;
		this.contentEl.before(this.regionLabelEl);
		this.contentEl.setAttr('aria-labelledby', this.regionLabelEl.id);
		this.layoutMode = this.host.getLayoutMode();
		this.showSections = this.host.getShowSections();
		this.setTileScale(this.host.getTileScale());
		this.addAction('refresh-cw', 'Refresh gallery', () => this.refresh(true));
		this.registerDomEvent(this.contentEl, 'click', (event) => {
			this.handleGalleryClick(event);
		});
		this.registerDomEvent(this.contentEl, 'contextmenu', (event) => {
			this.handleGalleryContextMenu(event);
		});
		this.registerDomEvent(this.contentEl, 'keydown', (event) => {
			// Navigation can consume the key without moving focus (for example,
			// expanding a pointer-focused summary), so do this before propagation
			// is stopped rather than relying on the parent container listener.
			this.scheduleKeyboardFocusState();
			this.handleGalleryKeydown(event);
		});
		// Track this small subtree on focus/input changes instead of asking CSS
		// to invalidate a :has(:focus-visible) selector on every state change.
		this.registerDomEvent(this.containerEl, 'focusin', this.updateKeyboardFocusState);
		this.registerDomEvent(this.containerEl, 'focusout', this.updateKeyboardFocusState);
		this.registerDomEvent(this.containerEl, 'keydown', this.scheduleKeyboardFocusState);
		this.registerDomEvent(this.containerEl, 'pointerdown', this.scheduleKeyboardFocusState);
		this.updateKeyboardFocusState();
		this.setupResizeHandling();
		this.refresh();
		return Promise.resolve();
	}

	focusGallery(): void {
		const lastViewedTile = this.lastViewedTileEl;
		if (
			lastViewedTile?.isConnected &&
			lastViewedTile.getClientRects().length > 0
		) {
			this.focusGalleryControl(lastViewedTile);
			return;
		}
		const firstControl = this.getVisibleGalleryControls()[0];
		if (firstControl) {
			this.focusGalleryControl(firstControl);
			return;
		}
		this.contentEl.focus({ preventScroll: true });
	}

	onClose(): Promise<void> {
		if (this.focusStateFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.focusStateFrame);
			this.focusStateFrame = null;
		}
		this.cancelVisibleRefresh();
		this.cancelPendingRender();
		this.cancelSearchRender();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.contentEl.win.removeEventListener('resize', this.handleViewportChange);
		this.lazyLoader?.disconnect();
		this.lazyLoader = null;
		this.summaryEl?.remove();
		this.summaryEl = null;
		this.regionLabelEl?.remove();
		this.regionLabelEl = null;
		this.contentEl.removeAttribute('aria-labelledby');
		this.items = [];
		this.mediaTrackingKeys = [];
		this.currentTree = null;
		this.displayedTree = null;
		this.displayedCollapsed = null;
		this.filterButton = null;
		this.currentNotePath = null;
		this.renderSignature = null;
		this.searchOpen = false;
		this.searchQuery = '';
		this.searchCollapsed.clear();
		this.searchResult = null;
		this.searchButton = null;
		this.searchComponent = null;
		this.searchRowEl = null;
		this.searchStatusEl = null;
		this.countEl = null;
		this.mediaKindFilter = null;
		this.visibleMediaIndices = [];
		this.videoTileMetadata.clear();
		this.containerEl.removeClass('is-search-open', 'has-search-query');
		this.containerEl.removeClass('has-media-filter');
		this.containerEl.removeClass('has-keyboard-focus');
		this.clearRenderedTileTracking();
		this.lastViewedMediaByNote.clear();
		this.collapsedByNote.clear();
		return Promise.resolve();
	}

	refresh(force = false): void {
		const note = this.host.getActiveNote();
		if (!note) {
			this.renderEmptyModel(
				'no-active-note',
				'Open a Markdown note to see its media.',
				force,
			);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(note);
		if (!cache) {
			this.renderEmptyModel(
				`index-pending:${note.path}`,
				'Gallery is waiting for this note to finish loading.',
				force,
			);
			return;
		}

		const nextItems = this.createGalleryItems(note, cache);
		const nextTrackingKeys = buildLastViewedMediaKeys(nextItems);
		const nextTree = buildMediaSectionTree(nextItems, 'No heading');
		const noteChanged = clearGallerySearchCollapseForNoteChange(
			this.currentNotePath,
			note.path,
			this.searchCollapsed,
		);
		if (noteChanged) {
			this.videoTileMetadata.clear();
		}
		const signature = this.createVisualSignature(note, nextItems);
		if (!force && signature === this.renderSignature) {
			this.items = nextItems;
			this.mediaTrackingKeys = nextTrackingKeys;
			this.currentTree = nextTree;
			return;
		}

		const shouldRestoreSearchFocus =
			this.searchComponent?.inputEl ===
			this.contentEl.ownerDocument.activeElement;
		const revision = this.prepareRender(
			signature,
			nextItems,
			nextTrackingKeys,
			nextTree,
		);
		this.currentNotePath = note.path;
		if (nextItems.length === 0) {
			this.searchOpen = false;
			this.searchQuery = '';
			this.searchCollapsed.clear();
			this.containerEl.removeClass('is-search-open', 'has-search-query');
			this.renderEmptyState('No images or videos in this note.');
			return;
		}

		const collapsed = this.prepareCollapsedState(note.path, nextTree);
		this.renderSummary(nextItems.length, shouldRestoreSearchFocus);
		this.lazyLoader = new LazyMediaLoader(this.app, this.contentEl);
		this.renderCurrentProjection(revision, collapsed);
	}

	referencesFile(path: string): boolean {
		return this.items.some((item) => item.file.path === path);
	}

	setLayoutMode(mode: GalleryLayoutMode): void {
		if (this.layoutMode === mode) {
			return;
		}
		this.layoutMode = mode;
		this.updateLayoutButton();
		this.applyLayoutMode();
	}

	setTileScale(value: number): void {
		this.containerEl.setCssProps({
			'--section-gallery-tile-scale': String(normalizeTileScale(value) / 100),
		});
		this.lazyLoader?.refreshVisibility();
	}

	setShowSections(show: boolean): void {
		if (this.showSections === show) {
			return;
		}
		this.showSections = show;
		// The media index and loader remain unchanged. Move existing tiles into
		// the new presentation so changing headings does not reload previews.
		this.rerenderCurrentProjection(true);
	}

	refreshVisibleMedia(): void {
		this.cancelVisibleRefresh();
		const loader = this.lazyLoader;
		if (!loader) {
			return;
		}
		loader.refreshVisibility();
		this.visibleRefreshFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.visibleRefreshFrame = null;
			if (this.lazyLoader === loader) {
				loader.refreshVisibility();
			}
		});
		this.visibleRefreshTimer = this.contentEl.win.setTimeout(() => {
			this.visibleRefreshTimer = null;
			if (this.lazyLoader === loader) {
				loader.refreshVisibility();
			}
		}, 240);
	}

	private cancelVisibleRefresh(): void {
		if (this.visibleRefreshFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.visibleRefreshFrame);
			this.visibleRefreshFrame = null;
		}
		if (this.visibleRefreshTimer !== null) {
			this.contentEl.win.clearTimeout(this.visibleRefreshTimer);
			this.visibleRefreshTimer = null;
		}
	}

	private toggleLayoutMode(): void {
		const nextMode = this.layoutMode === 'square' ? 'aspect' : 'square';
		void this.host.setLayoutMode(nextMode).catch(() => {
			new Notice('Could not save the gallery layout. Please try again.');
		});
	}

	private createGalleryItems(
		note: TFile,
		cache: CachedMetadata,
	): GalleryMedia[] {
		const embeds: EmbedReference[] = (cache.embeds ?? []).map((embed) => ({
			link: embed.link,
			position: {
				offset: embed.position.start.offset,
				line: embed.position.start.line,
				column: embed.position.start.col,
			},
		}));
		const headings: HeadingReference[] = (cache.headings ?? []).map(
			(heading) => ({
				heading: heading.heading,
				level: heading.level,
				position: { offset: heading.position.start.offset },
			}),
		);
		const resolvedLinks = new Map<string, TFile | null>();
		const resourceUrls = new Map<string, string>();

		return buildMediaIndex(
			embeds,
			headings,
			(link) => {
				const cached = resolvedLinks.get(link);
				if (cached !== undefined || resolvedLinks.has(link)) {
					return cached ?? null;
				}
				const resolved =
					this.app.metadataCache.getFirstLinkpathDest(link, note.path) ??
					(link.startsWith('/')
						? this.app.metadataCache.getFirstLinkpathDest(
								link.slice(1),
								note.path,
							)
						: null);
				resolvedLinks.set(link, resolved);
				return resolved;
			},
			'No heading',
		).map((item) => {
			let resourceUrl = resourceUrls.get(item.file.path);
			if (!resourceUrl) {
				resourceUrl = this.app.vault.getResourcePath(item.file);
				resourceUrls.set(item.file.path, resourceUrl);
			}
			return { ...item, note, resourceUrl };
		});
	}

	private createVisualSignature(
		note: TFile,
		media: readonly GalleryMedia[],
	): string {
		const entries = media.map((item) => [
			item.sectionStructuralKey,
			item.kind,
			item.file.path,
		]);
		return JSON.stringify([note.path, note.basename, entries]);
	}

	private prepareRender(
		signature: string,
		media: GalleryMedia[],
		mediaTrackingKeys: string[],
		tree: MediaSectionTree,
	): number {
		this.cancelSearchRender();
		this.cancelPendingRender();
		this.lazyLoader?.disconnect();
		this.lazyLoader = null;
		this.items = media;
		this.mediaTrackingKeys = mediaTrackingKeys;
		this.currentTree = tree;
		this.displayedTree = null;
		this.displayedCollapsed = null;
		this.filterButton = null;
		this.renderSignature = signature;
		this.searchResult = null;
		this.searchButton = null;
		this.searchComponent = null;
		this.searchRowEl = null;
		this.searchStatusEl = null;
		this.countEl = null;
		this.visibleMediaIndices = [];
		this.sectionToggleButton = null;
		this.layoutButton = null;
		this.summaryEl?.remove();
		this.summaryEl = null;
		this.clearRenderedTileTracking();
		this.contentEl.empty();
		this.updateKeyboardFocusState();
		return this.renderRevision;
	}

	private renderEmptyModel(
		signature: string,
		message: string,
		force: boolean,
	): void {
		if (!force && signature === this.renderSignature) {
			return;
		}
		this.searchOpen = false;
		this.searchQuery = '';
		this.searchCollapsed.clear();
		this.containerEl.removeClass('is-search-open', 'has-search-query');
		this.containerEl.removeClass('has-media-filter');
		const emptyTree = buildMediaSectionTree([], 'No heading');
		this.prepareRender(signature, [], [], emptyTree);
		this.videoTileMetadata.clear();
		this.currentNotePath = null;
		this.renderEmptyState(message);
	}

	private prepareCollapsedState(
		notePath: string,
		tree: MediaSectionTree,
	): Set<string> {
		this.currentNotePath = notePath;
		let collapsed = this.collapsedByNote.get(notePath);
		if (!collapsed) {
			collapsed = new Set<string>();
			this.collapsedByNote.set(notePath, collapsed);
		}
		const validKeys = new Set(this.collectSectionKeys(tree));
		for (const key of collapsed) {
			if (!validKeys.has(key)) {
				collapsed.delete(key);
			}
		}
		return collapsed;
	}

	private collectSectionKeys(tree: MediaSectionTree): string[] {
		const keys: string[] = [];
		if (tree.itemIndices.length > 0) {
			keys.push(tree.structuralKey);
		}
		const visit = (node: MediaSectionNode): void => {
			keys.push(node.structuralKey);
			for (const child of node.children) {
				visit(child);
			}
		};
		for (const child of tree.children) {
			visit(child);
		}
		return keys;
	}

	private renderSummary(
		count: number,
		restoreSearchFocus: boolean,
	): void {
		const summary = this.containerEl.createDiv({
			cls: 'nav-header section-gallery-summary',
		});
		this.contentEl.before(summary);
		this.summaryEl = summary;
		const toolbar = summary.createDiv({
			cls: 'nav-buttons-container section-gallery-toolbar',
		});
		this.searchButton = this.createToolbarButton(
			toolbar,
			'search',
			'Search gallery',
			() => {
				this.setSearchOpen(!this.searchOpen, true);
			},
			'section-gallery-search-button',
		);
		this.sectionToggleButton = this.createToolbarButton(
			toolbar,
			'chevrons-down-up',
			'Collapse all sections',
			(event) => {
				this.toggleAllDisplayedSections();
				if (event.detail === 0) {
					this.contentEl.win.requestAnimationFrame(() => {
						this.sectionToggleButton?.focus({ preventScroll: true });
					});
				}
			},
			'section-gallery-section-toggle-button',
		);
		this.filterButton = this.createToolbarButton(
			toolbar,
			'list-filter',
			'Filter media type',
			(event) => {
				this.showMediaFilterMenu(event);
			},
			'section-gallery-filter-button',
		);
		this.layoutButton = this.createToolbarButton(
			toolbar,
			'maximize-2',
			'Fit media inside square tiles',
			() => {
				this.toggleLayoutMode();
			},
			'section-gallery-layout-button',
		);
		this.countEl = toolbar.createSpan({
			cls: 'section-gallery-count',
			text: String(count),
		});
		this.countEl.setAttr(
			'aria-label',
			`${count} media ${count === 1 ? 'item' : 'items'}`,
		);
		this.registerDomEvent(toolbar, 'keydown', (event) => {
			this.handleToolbarKeydown(event);
		});

		nextGallerySearchId += 1;
		const searchId = `section-gallery-search-${nextGallerySearchId}`;
		const searchRow = summary.createDiv({
			cls: 'section-gallery-search-row',
		});
		searchRow.id = searchId;
		this.searchRowEl = searchRow;
		const searchContainer = searchRow.createDiv({
			cls: 'section-gallery-search-input-container',
		});
		const search = new SearchComponent(searchContainer);
		this.searchComponent = search;
		search.inputEl.addClass('section-gallery-search-input');
		search.inputEl.setAttr('aria-label', 'Search media and sections');
		search.inputEl.setAttr('autocomplete', 'off');
		search.inputEl.setAttr('enterkeyhint', 'search');
		search.inputEl.spellcheck = false;
		search.setPlaceholder('Search media and sections');
		search.setValue(this.searchQuery);
		search.clearButtonEl.addClass('section-gallery-search-clear');
		search.clearButtonEl.setAttr('aria-label', 'Clear gallery search');
		search.onChange((value) => {
			this.handleSearchQueryChange(value);
		});
		search.inputEl.onkeydown = (event) => {
			this.handleSearchKeydown(event);
		};

		const status = summary.createDiv({
			cls: 'section-gallery-screen-reader-only section-gallery-search-status',
		});
		status.id = `${searchId}-status`;
		status.setAttr('role', 'status');
		status.setAttr('aria-live', 'polite');
		status.setAttr('aria-atomic', 'true');
		this.searchStatusEl = status;
		search.inputEl.setAttr('aria-describedby', status.id);
		this.searchButton.setAttr('aria-controls', searchId);
		this.updateSearchControls();

		this.updateSectionToggleButton();
		this.updateFilterButton();
		this.updateLayoutButton();
		if (restoreSearchFocus && this.searchOpen) {
			this.contentEl.win.requestAnimationFrame(() => {
				this.focusSearchInput(false);
			});
		}
	}

	private createToolbarButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onclick: (event: MouseEvent) => void,
		className?: string,
	): HTMLButtonElement {
		const button = parent.createEl('button', {
			cls: [
				'clickable-icon',
				'nav-action-button',
				'section-gallery-toolbar-button',
				...(className ? [className] : []),
			],
		});
		button.type = 'button';
		button.setAttr('aria-label', label);
		setIcon(button, icon);
		button.onclick = onclick;
		return button;
	}

	private toggleAllDisplayedSections(): void {
		const tree = this.displayedTree;
		const collapsed = this.displayedCollapsed;
		if (!this.showSections || !tree || !collapsed) {
			return;
		}
		const keys = this.collectSectionKeys(tree);
		const shouldExpand =
			keys.length > 0 && keys.every((key) => collapsed.has(key));
		if (shouldExpand) {
			collapsed.clear();
		} else {
			for (const key of keys) {
				collapsed.add(key);
			}
		}
		this.rerenderCurrentProjection();
	}

	private setSearchOpen(open: boolean, focusInput: boolean): void {
		if (this.searchOpen === open) {
			if (open && focusInput) {
				this.focusSearchInput(true);
			}
			return;
		}

		const hadActiveQuery = this.hasActiveSearchQuery();
		this.searchOpen = open;
		if (!open) {
			this.searchQuery = '';
			this.searchCollapsed.clear();
			this.searchComponent?.setValue('');
		}
		this.updateSearchControls();

		if (hadActiveQuery !== this.hasActiveSearchQuery()) {
			this.scheduleProjectionRender();
		}
		if (open && focusInput) {
			// This synchronous focus is intentionally kept in the trusted toolbar
			// click so iOS is allowed to open its software keyboard.
			this.focusSearchInput(true);
		} else if (!open && focusInput) {
			this.searchButton?.focus({ preventScroll: true });
		}
	}

	private focusSearchInput(selectAll: boolean): void {
		const input = this.searchComponent?.inputEl;
		if (!this.searchOpen || !input?.isConnected) {
			return;
		}
		input.focus({ preventScroll: true });
		if (selectAll) {
			input.select();
		}
	}

	private handleSearchQueryChange(value: string): void {
		const previousQuery = normalizeGallerySearchQuery(this.searchQuery);
		this.searchQuery = value;
		const nextQuery = normalizeGallerySearchQuery(value);
		this.updateSearchControls();
		if (previousQuery === nextQuery) {
			return;
		}
		this.searchCollapsed.clear();
		this.scheduleProjectionRender();
	}

	private handleSearchKeydown(event: KeyboardEvent): void {
		if (
			!Platform.isMobile &&
			this.isPlainGalleryArrowEvent(event) &&
			(event.key === 'ArrowUp' || event.key === 'ArrowDown')
		) {
			const target = event.key === 'ArrowUp'
				? this.searchButton
				: this.getVisibleGalleryControls()[0];
			if (target) {
				event.preventDefault();
				event.stopPropagation();
				this.focusGalleryControl(target);
			}
			return;
		}
		if (
			!event.defaultPrevented &&
			!event.isComposing &&
			event.key === 'Enter' &&
			Platform.isMobile
		) {
			event.preventDefault();
			event.stopPropagation();
			this.searchComponent?.inputEl.blur();
			return;
		}
		if (
			event.defaultPrevented ||
			event.isComposing ||
			event.key !== 'Escape'
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.clearOrCloseSearch();
	}

	private clearOrCloseSearch(): void {
		if (this.searchQuery.length > 0) {
			this.searchComponent?.setValue('');
			this.handleSearchQueryChange('');
			this.focusSearchInput(false);
			return;
		}
		this.setSearchOpen(false, true);
	}

	private updateSearchControls(): void {
		const hasQuery = this.hasActiveSearchQuery();
		this.containerEl.toggleClass('is-search-open', this.searchOpen);
		this.containerEl.toggleClass('has-search-query', hasQuery);
		if (this.searchButton) {
			this.searchButton.setAttr(
				'aria-label',
				this.searchOpen ? 'Close gallery search' : 'Search gallery',
			);
			this.searchButton.setAttr(
				'aria-expanded',
				String(this.searchOpen),
			);
		}
		if (this.searchRowEl) {
			this.searchRowEl.hidden = !this.searchOpen;
		}
	}

	private hasActiveSearchQuery(): boolean {
		return (
			this.searchOpen &&
			normalizeGallerySearchQuery(this.searchQuery).length > 0
		);
	}

	private scheduleProjectionRender(): void {
		this.cancelPendingRender();
		if (this.searchRenderFrame !== null) {
			return;
		}
		this.searchRenderFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.searchRenderFrame = null;
			this.rerenderCurrentProjection();
		});
	}

	private cancelSearchRender(): void {
		if (this.searchRenderFrame === null) {
			return;
		}
		this.contentEl.win.cancelAnimationFrame(this.searchRenderFrame);
		this.searchRenderFrame = null;
	}

	private rerenderCurrentProjection(reuseTiles = false): void {
		const collapsed = this.getCurrentCollapsedState();
		if (!this.currentTree || !collapsed) {
			return;
		}
		// A queued search/filter projection may have different labels and
		// highlights, so reuse only tiles from an already settled projection.
		const canReuseTiles = reuseTiles && this.searchRenderFrame === null;
		this.cancelSearchRender();
		const existingTiles = canReuseTiles
			? Array.from(this.contentEl.querySelectorAll<HTMLButtonElement>(
					'.section-gallery-tile',
				))
			: [];
		this.cancelPendingRender();
		for (const tile of existingTiles) {
			const index = Number(tile.dataset.mediaIndex);
			if (Number.isInteger(index)) {
				this.reusableTilesByIndex.set(index, tile);
			}
		}
		for (const media of canReuseTiles ? [] : this.contentEl.querySelectorAll('img, video')) {
			if (
				media.instanceOf(HTMLImageElement) ||
				media.instanceOf(HTMLVideoElement)
			) {
				this.lazyLoader?.unobserve(media);
			}
		}
		this.clearRenderedTileTracking();
		this.contentEl.empty();
		this.updateKeyboardFocusState();
		this.renderCurrentProjection(this.renderRevision, collapsed);
	}

	private renderCurrentProjection(
		revision: number,
		collapsed: Set<string>,
	): void {
		const sourceTree = this.currentTree;
		if (!sourceTree) {
			return;
		}

		const activeSearch = this.hasActiveSearchQuery();
		const activeFilter = this.mediaKindFilter !== null;
		const result = activeSearch || activeFilter
			? filterMediaSectionTree(
					sourceTree,
					this.items,
					activeSearch ? this.searchQuery : '',
					this.mediaKindFilter,
				)
			: null;
		const tree = result?.tree ?? sourceTree;
		const displayedCollapsed = activeSearch
			? this.prepareSearchCollapsedState(tree)
			: collapsed;
		this.searchResult = activeSearch ? result : null;
		this.visibleMediaIndices =
			result?.visibleItemIndices ?? this.items.map((_, index) => index);
		this.displayedTree = tree;
		this.displayedCollapsed = displayedCollapsed;
		this.updateProjectionSummary(
			result?.visibleItemCount ?? this.items.length,
		);
		this.updateSectionToggleButton(tree, displayedCollapsed);

		if (tree.totalItemCount === 0) {
			this.disposeReusableTiles();
			const query = this.searchQuery.trim();
			const kindLabel = this.mediaKindFilter === 'image' ? 'images' : 'videos';
			const message = activeSearch
				? this.mediaKindFilter
					? `No ${kindLabel} match “${query}”.`
					: `No media matches “${query}”.`
				: `No ${kindLabel} in this note.`;
			this.renderEmptyState(message, activeSearch || activeFilter);
			return;
		}
		this.lazyLoader ??= new LazyMediaLoader(this.app, this.contentEl);
		if (this.showSections) {
			this.renderHierarchy(tree, displayedCollapsed, revision);
		} else {
			const grid = this.contentEl.createDiv({ cls: 'section-gallery-grid' });
			grid.toggleClass('is-fit', this.layoutMode === 'aspect');
			this.enqueueTileTasks(
				this.visibleMediaIndices.flatMap((index) => {
					const item = this.items[index];
					return item ? [{ grid, index, item }] : [];
				}),
				revision,
			);
		}
		if (this.pendingTileTasks.length === 0) {
			this.disposeReusableTiles();
		}
		this.refreshVisibleMedia();
	}

	private prepareSearchCollapsedState(tree: MediaSectionTree): Set<string> {
		const validKeys = new Set(this.collectSectionKeys(tree));
		for (const key of this.searchCollapsed) {
			if (!validKeys.has(key)) {
				this.searchCollapsed.delete(key);
			}
		}
		return this.searchCollapsed;
	}

	private updateProjectionSummary(visibleCount: number): void {
		const totalCount = this.items.length;
		const activeSearch = this.hasActiveSearchQuery();
		const activeFilter = this.mediaKindFilter !== null;
		const hasProjection = activeSearch || activeFilter;
		if (this.countEl) {
			this.countEl.setText(
				hasProjection ? `${visibleCount} / ${totalCount}` : String(totalCount),
			);
			this.countEl.setAttr(
				'aria-label',
				hasProjection
					? `${visibleCount} of ${totalCount} media items shown`
					: `${totalCount} media ${totalCount === 1 ? 'item' : 'items'}`,
			);
		}
		if (this.searchStatusEl) {
			const filterLabel =
				this.mediaKindFilter === 'image' ? 'images' : 'videos';
			this.searchStatusEl.setText(
				activeSearch
					? `${visibleCount} of ${totalCount} ${
							activeFilter ? filterLabel : 'media items'
						} shown for ${this.searchQuery.trim()}.`
					: activeFilter
						? `${visibleCount} of ${totalCount} ${filterLabel} shown.`
					: `${totalCount} media ${totalCount === 1 ? 'item' : 'items'}.`,
			);
		}
		this.updateSearchControls();
		this.updateFilterButton();
	}

	private showMediaFilterMenu(event: MouseEvent): void {
		const menu = Menu.forEvent(event);
		const addFilterItem = (
			kind: MediaKind,
			title: string,
			icon: string,
		): void => {
			menu.addItem((item) => {
				item
					.setTitle(title)
					.setIcon(icon)
					.setChecked(this.mediaKindFilter === kind)
					.onClick(() => this.setMediaKindFilter(kind));
			});
		};
		addFilterItem('image', 'Images', 'image');
		addFilterItem('video', 'Videos', 'file-video');
		if (this.mediaKindFilter !== null) {
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle('Clear filter')
					.setIcon('x')
					.onClick(() => this.setMediaKindFilter(null));
			});
		}
		if (event.detail === 0 && this.filterButton) {
			const rect = this.filterButton.getBoundingClientRect();
			menu.showAtPosition({ x: rect.left, y: rect.bottom }, this.filterButton.ownerDocument);
		} else {
			menu.showAtMouseEvent(event);
		}
	}

	private setMediaKindFilter(kind: MediaKind | null): void {
		if (this.mediaKindFilter === kind) {
			return;
		}
		this.mediaKindFilter = kind;
		if (this.hasActiveSearchQuery()) {
			this.searchCollapsed.clear();
		}
		this.updateFilterButton();
		this.scheduleProjectionRender();
	}

	private updateFilterButton(): void {
		const filter = this.mediaKindFilter;
		this.containerEl.toggleClass('has-media-filter', filter !== null);
		if (!this.filterButton) {
			return;
		}
		const label =
			filter === 'image'
				? 'Filter media type: Images'
				: filter === 'video'
					? 'Filter media type: Videos'
					: 'Filter media type';
		this.filterButton.setAttr('aria-label', label);
		this.filterButton.setAttr('aria-pressed', String(filter !== null));
		this.filterButton.toggleClass('is-active', filter !== null);
	}

	private updateSectionToggleButton(
		tree = this.displayedTree,
		collapsed = this.displayedCollapsed,
	): void {
		if (!tree || !collapsed) {
			return;
		}
		const keys = this.collectSectionKeys(tree);
		const shouldExpand =
			keys.length > 0 && keys.every((key) => collapsed.has(key));
		const label = shouldExpand
			? 'Expand all sections'
			: 'Collapse all sections';
		this.sectionToggleButton?.toggleAttribute('disabled', !this.showSections || keys.length === 0);
		this.sectionToggleButton?.setAttr('aria-label', label);
		if (this.sectionToggleButton) {
			setIcon(
				this.sectionToggleButton,
				shouldExpand ? 'chevrons-up-down' : 'chevrons-down-up',
			);
		}
	}

	private updateLayoutButton(): void {
		if (!this.layoutButton) {
			return;
		}
		const fitMode = this.layoutMode === 'aspect';
		this.layoutButton.removeAttribute('aria-pressed');
		this.layoutButton.setAttr(
			'aria-label',
			fitMode ? 'Fill square tiles' : 'Fit media inside square tiles',
		);
		this.layoutButton.removeClass('is-fit-mode');
		this.renderFitModeIcon(this.layoutButton, fitMode);
	}

	private renderFitModeIcon(button: HTMLButtonElement, fitMode: boolean): void {
		button.empty();
		const document = button.ownerDocument;
		const namespace = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(namespace, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '24');
		svg.setAttribute('height', '24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute(
			'class',
			'svg-icon lucide section-gallery-ratio-icon',
		);
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');

		const frame = document.createElementNS(namespace, 'path');
		frame.setAttribute('d', RATIO_ICON_FRAME_PATH);
		svg.appendChild(frame);

		const [topArrowPath, bottomArrowPath] =
			getRatioIconArrowPaths(fitMode);
		const topArrow = document.createElementNS(namespace, 'path');
		const bottomArrow = document.createElementNS(namespace, 'path');
		topArrow.setAttribute('d', topArrowPath);
		bottomArrow.setAttribute('d', bottomArrowPath);
		svg.append(topArrow, bottomArrow);
		button.appendChild(svg);
	}

	private renderHighlightedSearchText(
		parent: HTMLElement,
		text: string,
	): void {
		this.renderSearchTextSegments(
			parent,
			segmentGallerySearchText(text, this.searchQuery),
		);
	}

	private renderSearchTextSegments(
		parent: HTMLElement,
		segments: readonly GallerySearchTextSegment[],
	): void {
		for (const segment of segments) {
			if (segment.isMatch) {
				parent.createEl('mark', {
					cls: 'section-gallery-search-mark',
					text: segment.text,
				});
			} else {
				parent.appendText(segment.text);
			}
		}
	}

	private getCurrentCollapsedState(): Set<string> | null {
		return this.currentNotePath
			? (this.collapsedByNote.get(this.currentNotePath) ?? null)
			: null;
	}

	private renderHierarchy(
		tree: MediaSectionTree,
		collapsed: Set<string>,
		revision: number,
	): void {
		if (tree.itemIndices.length > 0) {
			const preamble: MediaSectionNode = {
				...tree,
				children: [],
				descendantItemCount: 0,
				totalItemCount: tree.itemIndices.length,
			};
			this.renderSectionShell(
				this.contentEl,
				preamble,
				0,
				collapsed,
				revision,
			);
		}
		for (const child of tree.children) {
			this.renderSectionShell(
				this.contentEl,
				child,
				0,
				collapsed,
				revision,
			);
		}
	}

	private renderSectionShell(
		parent: HTMLElement,
		node: MediaSectionNode,
		depth: number,
		collapsed: Set<string>,
		revision: number,
	): void {
		const details = parent.createEl('details', {
			cls: 'section-gallery-section',
		});
		const isSearchResult = this.searchResult !== null;
		const isSectionMatch =
			this.searchResult?.matchedSectionKeys.has(node.structuralKey) ?? false;
		details.toggleClass('has-search-results', isSearchResult);
		details.toggleClass('is-search-match', isSectionMatch);
		details.dataset.sectionKey = node.structuralKey;
		details.style.setProperty(
			'--section-gallery-depth',
			String(Math.min(depth, 5)),
		);
		details.open = !collapsed.has(node.structuralKey);

		const summary = details.createEl('summary', {
			cls: 'section-gallery-section-header',
		});
		summary.toggleClass('is-search-match', isSectionMatch);
		summary.tabIndex = -1;
		const chevron = summary.createSpan({
			cls: 'section-gallery-section-chevron',
		});
		setIcon(chevron, 'chevron-right');
		const title = summary.createSpan({
			cls: 'section-gallery-section-title',
		});
		if (isSectionMatch) {
			this.renderHighlightedSearchText(title, node.title);
			summary.createSpan({
				cls: 'section-gallery-screen-reader-only',
				text: 'Section title match',
			});
		} else {
			title.setText(node.title);
		}
		title.setAttr('title', node.title);
		summary.createSpan({
			cls: 'section-gallery-section-count',
			text: String(node.totalItemCount),
		});

		let body: HTMLElement | null = details.open
			? this.renderSectionBody(details, node, depth, collapsed, revision)
			: null;
		details.ontoggle = () => {
			// Toggle events are queued by the browser. An old section can deliver
			// one after a search/note render has already replaced the entire tree.
			if (revision !== this.renderRevision || !details.isConnected) {
				return;
			}
			if (details.open) {
				collapsed.delete(node.structuralKey);
				body ??= this.renderSectionBody(
					details,
					node,
					depth,
					collapsed,
					revision,
				);
			} else {
				collapsed.add(node.structuralKey);
				if (body) {
					this.disposeSectionBody(body);
					body = null;
				}
			}
			this.updateSectionToggleButton();
		};
	}

	private renderSectionBody(
		parent: HTMLDetailsElement,
		node: MediaSectionNode,
		depth: number,
		collapsed: Set<string>,
		revision: number,
	): HTMLElement {
		const body = parent.createDiv({ cls: 'section-gallery-section-body' });
		if (node.itemIndices.length > 0) {
			const grid = body.createDiv({ cls: 'section-gallery-grid' });
			grid.toggleClass('is-fit', this.layoutMode === 'aspect');
			this.enqueueTileTasks(
				node.itemIndices.flatMap((index) => {
					const item = this.items[index];
					return item ? [{ grid, index, item }] : [];
				}),
				revision,
			);
		}
		for (const child of node.children) {
			this.renderSectionShell(
				body,
				child,
				depth + 1,
				collapsed,
				revision,
			);
		}
		return body;
	}

	private disposeSectionBody(body: HTMLElement): void {
		// Remove queued work as well as rendered nodes so reopening a section
		// does not wait behind batches belonging to its detached previous body.
		this.pendingTileTasks = this.pendingTileTasks
			.slice(this.pendingTileCursor)
			.filter((task) => !body.contains(task.grid));
		this.pendingTileCursor = 0;
		for (const tile of body.querySelectorAll<HTMLButtonElement>(
			'.section-gallery-tile',
		)) {
			this.unregisterRenderedTile(tile);
		}
		for (const media of body.querySelectorAll('img, video')) {
			if (
				media.instanceOf(HTMLImageElement) ||
				media.instanceOf(HTMLVideoElement)
			) {
				this.lazyLoader?.unobserve(media);
			}
		}
		body.remove();
		// Removing a focused descendant does not consistently emit focusout
		// across WebViews. Re-read the remaining subtree immediately.
		this.updateKeyboardFocusState();
	}

	private enqueueTileTasks(
		tasks: readonly TileRenderTask[],
		revision: number,
	): void {
		if (revision !== this.renderRevision || tasks.length === 0) {
			return;
		}
		this.pendingTileTasks.push(...tasks);
		if (this.renderFrame !== null) {
			return;
		}
		// Schedule one shared batch after every section shell has been created.
		// Rendering here gave each small section its own synchronous batch and
		// could build thousands of tiles without yielding on mobile.
		this.renderFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.renderFrame = null;
			this.renderTileBatch(revision);
		});
	}

	private renderTileBatch(revision: number): void {
		if (revision !== this.renderRevision) {
			return;
		}
		let processed = 0;
		let rendered = 0;
		while (
			this.pendingTileCursor < this.pendingTileTasks.length &&
			processed < TILE_RENDER_BATCH_SIZE
		) {
			const task = this.pendingTileTasks[this.pendingTileCursor++];
			processed += 1;
			if (!task || !task.grid.isConnected) {
				continue;
			}
			this.renderTile(task.grid, task.item, task.index);
			rendered += 1;
		}
		if (rendered > 0) {
			this.lazyLoader?.refreshVisibility();
		}
		if (this.pendingTileCursor < this.pendingTileTasks.length) {
			this.renderFrame = this.contentEl.win.requestAnimationFrame(() => {
				this.renderFrame = null;
				this.renderTileBatch(revision);
			});
		} else {
			this.pendingTileTasks.length = 0;
			this.pendingTileCursor = 0;
			this.renderFrame = null;
			this.disposeReusableTiles();
		}
	}

	private disposeReusableTiles(): void {
		for (const tile of this.reusableTilesByIndex.values()) {
			for (const media of tile.querySelectorAll('img, video')) {
				if (media.instanceOf(HTMLImageElement) || media.instanceOf(HTMLVideoElement)) {
					this.lazyLoader?.unobserve(media);
				}
			}
		}
		this.reusableTilesByIndex.clear();
	}

	private cancelPendingRender(): void {
		this.disposeReusableTiles();
		this.renderRevision += 1;
		this.pendingTileTasks.length = 0;
		this.pendingTileCursor = 0;
		if (this.renderFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}
	}

	private renderTile(
		grid: HTMLElement,
		item: GalleryMedia,
		index: number,
	): void {
		const reusedTile = this.reusableTilesByIndex.get(index);
		const tile = reusedTile ?? grid.createEl('button', { cls: 'section-gallery-tile' });
		if (reusedTile) {
			this.reusableTilesByIndex.delete(index);
			grid.appendChild(tile);
		}
		tile.type = 'button';
		tile.tabIndex = -1;
		tile.dataset.mediaIndex = String(index);
		const trackingKey = this.mediaTrackingKeys[index];
		if (trackingKey) {
			tile.dataset.mediaTrackingKey = trackingKey;
			this.tilesByTrackingKey.set(trackingKey, tile);
			if (
				this.currentNotePath !== null &&
				this.lastViewedMediaByNote.get(this.currentNotePath) === trackingKey
			) {
				this.setLastViewedTile(tile);
			}
		}
		if (reusedTile) {
			return;
		}
		const isFilenameMatch =
			this.searchResult?.matchedItemIndices.has(index) ?? false;
		tile.toggleClass('is-search-match', isFilenameMatch);
		const accessibleLabel = tile.createSpan({
			cls: 'section-gallery-screen-reader-only',
			text: isFilenameMatch
				? `Open ${item.file.name}, filename match`
				: `Open ${item.file.name}`,
		});
		if (isFilenameMatch) {
			const filename = tile.createSpan({
				cls: 'section-gallery-search-filename',
			});
			filename.setAttr('aria-hidden', 'true');
			const excerpt = createGallerySearchExcerpt(
				item.file.name,
				this.searchQuery,
			);
			if (excerpt.leadingEllipsis) {
				filename.appendText('…');
			}
			this.renderSearchTextSegments(filename, excerpt.segments);
			if (excerpt.trailingEllipsis) {
				filename.appendText('…');
			}
		}

		if (item.kind === 'image') {
			const image = tile.createEl('img', {
				cls: 'section-gallery-thumbnail',
				attr: {
					alt: '',
					decoding: 'async',
				},
			});
			image.onload = () => {
				tile.removeClass('has-error');
				tile.addClass('is-loaded');
			};
			image.onerror = () => tile.addClass('has-error');
			this.lazyLoader?.observe(image, item);
			return;
		}

		tile.addClass('is-video');
		const videoFrame = tile.createDiv({
			cls: 'section-gallery-video-frame',
		});
		const preview = videoFrame.createEl('img', {
			cls: 'section-gallery-thumbnail',
			attr: { alt: '', decoding: 'async', 'aria-hidden': 'true' },
		});
		videoFrame.createSpan({
			cls: 'section-gallery-video-preview-unavailable',
			text: 'Preview unavailable',
			attr: { 'aria-hidden': 'true' },
		});
		const durationBadge = videoFrame.createSpan({
			cls: 'section-gallery-video-duration',
		});
		// The duration badge exists before metadata is loaded. Retain its search
		// label placement even when the badge is temporarily hidden.
		tile.addClass('has-video-duration');
		durationBadge.setAttr('aria-hidden', 'true');
		durationBadge.hidden = true;
		const cacheKey = this.getVideoTileMetadataKey(item);
		const cachedMetadata = this.videoTileMetadata.get(cacheKey);
		if (cachedMetadata) {
			this.applyVideoTileMetadata(
				videoFrame,
				durationBadge,
				cachedMetadata,
			);
			this.updateVideoTileAccessibleLabel(
				accessibleLabel,
				item,
				isFilenameMatch,
				cachedMetadata,
			);
		}
		const updateMetadata = (metadata: VideoTileMetadata): void => {
			if (!this.contentEl.contains(preview)) {
				return;
			}
			this.videoTileMetadata.set(cacheKey, metadata);
			this.applyVideoTileMetadata(videoFrame, durationBadge, metadata);
			this.updateVideoTileAccessibleLabel(
				accessibleLabel,
				item,
				isFilenameMatch,
				metadata,
			);
		};
		preview.onload = () => {
			tile.removeClass('has-error');
			tile.addClass('is-loaded');
		};
		preview.onerror = () => tile.addClass('has-error');
		this.lazyLoader?.observe(preview, item, undefined, updateMetadata);
	}

	private getVideoTileMetadataKey(item: GalleryMedia): string {
		return [item.file.path, item.file.stat.mtime, item.file.stat.size].join(':');
	}

	private applyVideoTileMetadata(
		frame: HTMLElement,
		badge: HTMLElement,
		metadata: VideoTileMetadata,
	): void {
		const duration = formatMediaDuration(metadata.durationSeconds);
		badge.setText(duration ?? '');
		badge.hidden = duration === null;
		const offsets = getContainedVideoOffsets(
			metadata.width,
			metadata.height,
		);
		if (!offsets) {
			return;
		}
		frame.setCssProps({
			'--section-gallery-video-block-offset': `${offsets.blockPercent}%`,
			'--section-gallery-video-inline-offset': `${offsets.inlinePercent}%`,
		});
	}

	private updateVideoTileAccessibleLabel(
		label: HTMLElement,
		item: GalleryMedia,
		isFilenameMatch: boolean,
		metadata: VideoTileMetadata,
	): void {
		const duration = formatMediaDuration(metadata.durationSeconds);
		const qualifiers = [
			isFilenameMatch ? 'filename match' : null,
			duration ? `duration ${duration}` : null,
		].filter((value): value is string => value !== null);
		label.setText(
			`Open ${item.file.name}${
				qualifiers.length > 0 ? `, ${qualifiers.join(', ')}` : ''
			}`,
		);
	}

	private setupResizeHandling(): void {
		const rootWindow = this.contentEl.win as Window & {
			ResizeObserver?: typeof ResizeObserver;
		};
		if (rootWindow.ResizeObserver) {
			this.resizeObserver = new rootWindow.ResizeObserver(
				this.handleViewportChange,
			);
			this.resizeObserver.observe(this.contentEl);
			return;
		}
		this.contentEl.win.addEventListener('resize', this.handleViewportChange, {
			passive: true,
		});
	}

	private readonly handleViewportChange = (): void => {
		this.lazyLoader?.refreshVisibility();
	};

	private applyLayoutMode(): void {
		for (const grid of this.contentEl.querySelectorAll<HTMLElement>(
			'.section-gallery-grid',
		)) {
			grid.toggleClass('is-fit', this.layoutMode === 'aspect');
		}
		this.lazyLoader?.refreshVisibility();
	}

	private renderEmptyState(message: string, isSearchEmpty = false): void {
		const emptyState = this.contentEl.createDiv({
			cls: 'section-gallery-empty',
		});
		emptyState.toggleClass('is-search-empty', isSearchEmpty);
		const icon = emptyState.createDiv({ cls: 'section-gallery-empty-icon' });
		setIcon(icon, 'images');
		emptyState.createDiv({
			cls: 'section-gallery-empty-message',
			text: message,
		});
	}

	private handleGalleryClick(event: MouseEvent): void {
		const index = this.getMediaIndexFromEvent(event);
		if (index === null) {
			return;
		}

		if (event.detail > 0) {
			this.clearGalleryInteractionFocus();
		}
		const projection = buildVisibleMediaProjection(
			this.items,
			this.visibleMediaIndices,
			index,
		);
		if (!projection) {
			return;
		}
		// Dismiss the mobile software keyboard before the fullscreen viewer takes
		// focus; relying on the modal focus transition leaves it visible on iOS.
		this.searchComponent?.inputEl.blur();
		const trackingKeys = this.mediaTrackingKeys;
		let viewedNotePath: string | null = null;
		let viewedTrackingKey: string | null = null;
		this.host.openLightbox(
			projection.items,
			projection.initialIndex,
			(item, viewedIndex) => {
				const originalIndex = projection.originalIndices[viewedIndex];
				const trackingKey =
					originalIndex === undefined
						? undefined
						: trackingKeys[originalIndex];
				if (trackingKey) {
					viewedNotePath = item.note.path;
					viewedTrackingKey = trackingKey;
					this.recordLastViewedMedia(item.note.path, trackingKey);
				}
			},
			Platform.isMobile
				? undefined
				: () => {
					this.restoreLastViewedMediaFocus(
						viewedNotePath,
						viewedTrackingKey,
					);
				},
		);
	}

	private restoreLastViewedMediaFocus(
		viewedNotePath: string | null,
		trackingKey: string | null,
	): void {
		if (
			!shouldRestoreLastViewedMediaFocus(
				Platform.isMobile,
				this.currentNotePath,
				viewedNotePath,
				trackingKey,
			) ||
			!this.contentEl.isConnected
		) {
			return;
		}
		this.contentEl.win.requestAnimationFrame(() => {
			if (
				!this.contentEl.isConnected ||
				this.currentNotePath !== viewedNotePath
			) {
				return;
			}
			const tile = trackingKey
				? (this.tilesByTrackingKey.get(trackingKey) ?? null)
				: null;
			if (tile?.isConnected && tile.getClientRects().length > 0) {
				this.focusGalleryControl(tile);
				return;
			}
			this.focusGallery();
		});
	}

	private recordLastViewedMedia(notePath: string, trackingKey: string): void {
		this.lastViewedMediaByNote.set(notePath, trackingKey);
		if (this.currentNotePath !== notePath) {
			return;
		}
		this.setLastViewedTile(this.tilesByTrackingKey.get(trackingKey) ?? null);
	}

	private setLastViewedTile(tile: HTMLButtonElement | null): void {
		if (this.lastViewedTileEl === tile) {
			return;
		}
		this.lastViewedTileEl?.removeClass('is-last-viewed');
		this.lastViewedTileEl?.removeAttribute('aria-current');
		this.lastViewedTileEl = tile;
		this.lastViewedTileEl?.addClass('is-last-viewed');
		this.lastViewedTileEl?.setAttr('aria-current', 'true');
	}

	private unregisterRenderedTile(tile: HTMLButtonElement): void {
		const trackingKey = tile.dataset.mediaTrackingKey;
		if (trackingKey && this.tilesByTrackingKey.get(trackingKey) === tile) {
			this.tilesByTrackingKey.delete(trackingKey);
		}
		if (this.lastViewedTileEl === tile) {
			this.setLastViewedTile(null);
		}
	}

	private clearRenderedTileTracking(): void {
		this.setLastViewedTile(null);
		this.tilesByTrackingKey.clear();
	}

	private isPlainGalleryArrowEvent(
		event: KeyboardEvent,
	): event is KeyboardEvent & { key: GalleryArrowKey } {
		return !(
			event.defaultPrevented ||
			event.isComposing ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		) && isGalleryArrowKey(event.key);
	}

	private getEnabledToolbarControls(): HTMLButtonElement[] {
		return [
			this.searchButton,
			this.sectionToggleButton,
			this.filterButton,
			this.layoutButton,
		].filter((button): button is HTMLButtonElement =>
			button !== null && !button.disabled && button.getClientRects().length > 0,
		);
	}

	private focusToolbarFromGallery(event: KeyboardEvent): boolean {
		if (Platform.isMobile || event.key !== 'ArrowUp') {
			return false;
		}
		const target = this.getEnabledToolbarControls()[0];
		if (!target) {
			return false;
		}
		event.preventDefault();
		event.stopPropagation();
		this.focusGalleryControl(target);
		return true;
	}

	private handleToolbarKeydown(event: KeyboardEvent): void {
		if (Platform.isMobile || !this.isPlainGalleryArrowEvent(event)) {
			return;
		}
		const controls = this.getEnabledToolbarControls();
		const currentIndex = controls.findIndex((button) => button === event.target);
		if (currentIndex === -1) {
			return;
		}
		if (event.key === 'ArrowDown' && this.searchOpen) {
			event.preventDefault();
			event.stopPropagation();
			this.focusSearchInput(false);
			return;
		}
		const index = findGalleryToolbarControlIndex(controls.length, currentIndex, event.key);
		const target = event.key === 'ArrowDown'
			? this.getVisibleGalleryControls()[0]
			: index === null ? null : controls[index];
		if (target) {
			event.preventDefault();
			event.stopPropagation();
			this.focusGalleryControl(target);
		}
	}

	private handleGalleryKeydown(event: KeyboardEvent): void {
		if (
			!event.defaultPrevented &&
			!event.isComposing &&
			event.key === 'Escape' &&
			this.searchOpen
		) {
			event.preventDefault();
			event.stopPropagation();
			this.clearOrCloseSearch();
			return;
		}
		if (!this.isPlainGalleryArrowEvent(event)) {
			return;
		}
		const direction = event.key;

		if (event.target === this.contentEl) {
			if (this.focusToolbarFromGallery(event)) {
				return;
			}
			const controls = this.getVisibleGalleryControls();
			const target =
				direction === 'ArrowUp' || direction === 'ArrowLeft'
					? controls[controls.length - 1]
					: controls[0];
			if (target) {
				event.preventDefault();
				event.stopPropagation();
				this.focusGalleryControl(target);
			}
			return;
		}

		const sectionHeader = this.getSectionHeaderFromEvent(event);
		if (sectionHeader) {
			this.handleSectionHeaderKeydown(event, sectionHeader);
			return;
		}

		const tile = this.getTileFromEvent(event);
		if (!tile) {
			return;
		}
		const nextControl =
			this.findAdjacentTile(tile, direction) ??
			this.findAdjacentGalleryControl(tile, direction);
		if (!nextControl) {
			this.focusToolbarFromGallery(event);
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.focusGalleryControl(nextControl);
	}

	private getSectionHeaderFromEvent(
		event: KeyboardEvent,
	): HTMLElement | null {
		const target = event.targetNode;
		const header = target?.instanceOf(Element)
			? target.closest<HTMLElement>('.section-gallery-section-header')
			: null;
		return header && this.contentEl.contains(header) ? header : null;
	}

	private handleSectionHeaderKeydown(
		event: KeyboardEvent,
		header: HTMLElement,
	): void {
		const details = header.parentElement;
		if (!details?.instanceOf(HTMLDetailsElement)) {
			return;
		}

		if (!isGalleryArrowKey(event.key)) {
			return;
		}
		const intent = getSectionNavigationIntent(event.key, details.open);

		if (intent === 'expand') {
			event.preventDefault();
			event.stopPropagation();
			details.open = true;
			return;
		}

		if (intent === 'focus-child') {
			event.preventDefault();
			event.stopPropagation();
			const child = this.getVisibleGalleryControls().find(
				(control) => control !== header && details.contains(control),
			);
			if (child) {
				this.focusGalleryControl(child);
			}
			return;
		}

		if (intent === 'collapse') {
			event.preventDefault();
			event.stopPropagation();
			details.open = false;
			return;
		}

		if (intent === 'focus-parent') {
			event.preventDefault();
			event.stopPropagation();
			const parentDetails = details.parentElement?.closest('details');
			const parentHeader = parentDetails?.querySelector<HTMLElement>(
				':scope > .section-gallery-section-header',
			);
			if (parentHeader) {
				this.focusGalleryControl(parentHeader);
			}
			return;
		}

		const next = this.findAdjacentGalleryControl(header, event.key);
		if (!next) {
			this.focusToolbarFromGallery(event);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.focusGalleryControl(next);
	}

	private getVisibleGalleryControls(): HTMLElement[] {
		return Array.from(
			this.contentEl.querySelectorAll<HTMLElement>(
				'.section-gallery-section-header, .section-gallery-tile',
			),
		).filter(
			(control) =>
				!control.hasAttribute('disabled') &&
				control.getClientRects().length > 0,
		);
	}

	private findAdjacentGalleryControl(
		current: HTMLElement,
		direction: GalleryArrowKey,
	): HTMLElement | null {
		const controls = this.getVisibleGalleryControls();
		const index = controls.indexOf(current);
		const groups = controls.map((control) =>
			control.matches('.section-gallery-tile')
				? control.closest<HTMLElement>('.section-gallery-grid')
				: null,
		);
		const nextIndex = findGalleryControlFallbackIndex(
			groups,
			index,
			direction,
		);
		return nextIndex === null ? null : (controls[nextIndex] ?? null);
	}

	private findAdjacentTile(
		current: HTMLButtonElement,
		direction: GalleryArrowKey,
	): HTMLButtonElement | null {
		const grid = current.closest<HTMLElement>('.section-gallery-grid');
		if (!grid) {
			return null;
		}
		const tiles = Array.from(
			grid.querySelectorAll<HTMLButtonElement>('.section-gallery-tile'),
		).filter((tile) => !tile.disabled && tile.getClientRects().length > 0);
		const currentIndex = tiles.indexOf(current);
		if (currentIndex === -1) {
			return null;
		}

		const currentRect = current.getBoundingClientRect();
		const currentX = currentRect.left + currentRect.width / 2;
		const currentY = currentRect.top + currentRect.height / 2;
		const candidates = tiles.flatMap((tile, index) => {
			if (tile === current) {
				return [];
			}
			const rect = tile.getBoundingClientRect();
			const deltaX = rect.left + rect.width / 2 - currentX;
			const deltaY = rect.top + rect.height / 2 - currentY;
			return [{ tile, index, rect, deltaX, deltaY }];
		});

		if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
			const sign = direction === 'ArrowRight' ? 1 : -1;
			const sameRow = candidates
				.filter(({ rect, deltaX, deltaY }) => {
					const rowTolerance =
						Math.max(currentRect.height, rect.height) * 0.55;
					return deltaX * sign > 1 && Math.abs(deltaY) <= rowTolerance;
				})
				.sort((left, right) => {
					const primary =
						Math.abs(left.deltaX) - Math.abs(right.deltaX);
					return primary || Math.abs(left.deltaY) - Math.abs(right.deltaY);
				});
			if (sameRow[0]) {
				return sameRow[0].tile;
			}

			return (
				tiles[currentIndex + (direction === 'ArrowRight' ? 1 : -1)] ??
				null
			);
		}

		const sign = direction === 'ArrowDown' ? 1 : -1;
		const vertical = candidates
			.filter(({ deltaY }) => deltaY * sign > 1)
			.sort((left, right) => {
				const leftScore =
					Math.abs(left.deltaY) + Math.abs(left.deltaX) * 2;
				const rightScore =
					Math.abs(right.deltaY) + Math.abs(right.deltaX) * 2;
				return leftScore - rightScore || left.index - right.index;
			});
		return vertical[0]?.tile ?? null;
	}

	private focusGalleryControl(control: HTMLElement): void {
		const trackingKey = control.dataset.mediaTrackingKey;
		if (trackingKey && this.currentNotePath) {
			// Keyboard navigation moves the same selection restored by the viewer;
			// do not leave a second persistent marker on the previously viewed tile.
			this.recordLastViewedMedia(this.currentNotePath, trackingKey);
		}
		control.focus({ preventScroll: true });
		control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	private readonly updateKeyboardFocusState = (): void => {
		this.containerEl.toggleClass(
			'has-keyboard-focus',
			this.containerEl.querySelector(':focus-visible') !== null,
		);
	};

	private readonly scheduleKeyboardFocusState = (): void => {
		if (this.focusStateFrame !== null) {
			return;
		}
		// A pointer/key event can change :focus-visible on an already focused
		// element without firing focusin. Read after that event's default action,
		// before the next paint, and cancel pending work when the view closes.
		this.focusStateFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.focusStateFrame = null;
			this.updateKeyboardFocusState();
		});
	};

	private clearGalleryInteractionFocus(): void {
		const activeElement = this.contentEl.ownerDocument.activeElement;
		if (
			activeElement?.instanceOf(HTMLElement) &&
			this.contentEl.contains(activeElement)
		) {
			activeElement.blur();
		}

		const selection = this.contentEl.win.getSelection();
		if (
			selection?.anchorNode &&
			this.contentEl.contains(selection.anchorNode)
		) {
			selection.removeAllRanges();
		}
	}

	private handleGalleryContextMenu(event: MouseEvent): void {
		const index = this.getMediaIndexFromEvent(event);
		if (index === null) {
			return;
		}
		const media = this.items[index];
		if (!media) {
			return;
		}
		showMediaContextMenu({
			app: this.app,
			event,
			media,
			revealSource: (item) => this.host.revealSource(item),
		});
	}

	private getTileFromEvent(event: MouseEvent | KeyboardEvent): HTMLButtonElement | null {
		const target = event.targetNode;
		if (!target?.instanceOf(Element)) {
			return null;
		}
		const tile = target.closest<HTMLButtonElement>('.section-gallery-tile');
		if (!tile || !this.contentEl.contains(tile)) {
			return null;
		}
		return tile;
	}

	private getMediaIndexFromEvent(event: MouseEvent): number | null {
		const tile = this.getTileFromEvent(event);
		if (!tile) {
			return null;
		}

		const index = Number(tile.dataset.mediaIndex);
		if (!Number.isInteger(index) || !this.items[index]) {
			return null;
		}
		return index;
	}
}
