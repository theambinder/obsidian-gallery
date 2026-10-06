import { App, Modal, Notice, Platform, setIcon } from 'obsidian';
import { LazyMediaLoader } from './lazy-media-loader';
import { captureGalleryViewerDiagnostics } from './mobile-diagnostics';
import { getAndroidFileOpener } from './mobile-sharing';
import { showMediaContextMenu } from './media-context-menu';
import {
	capWheelDelta,
	claimWheelBurstForCommittedPage,
	confirmsWheelRestartCandidate,
	getCappedPreviewDimensions,
	getCyclicNeighborIndices,
	getNativeScrollSettleDelay,
	getStagePageFilmstripMorph,
	getStagePageFilmstripScrollLeft,
	getStagePageNeighborIndex,
	getStageWheelPageOffset,
	getWheelVisualRestartSeed,
	isCyclicStagePageWrap,
	resolveFilmstripWheelRoute,
	resolveStagePageFilmstripCloneMedia,
	resolveStagePageReleaseIndex,
	resolveStageWheelIntent,
	resolveViewportLandscape,
	shouldCommitStagePageSwipe,
	shouldAbsorbConsumedWheelBurst,
	updateWheelBurst,
	type WheelBurstState,
	type RawWheelRestartCandidate,
} from './media-modal-gestures';
import { getMediaMimeType } from './media-utils';
import type { GalleryMedia } from './types';
import {
	createVideoFrameRateEstimatorState,
	formatApproximateFrameRate,
	formatMediaDuration,
	updateVideoFrameRateEstimator,
	type VideoFrameRateEstimatorState,
} from './video-metadata';

const SWIPE_THRESHOLD_PX = 56;
const VERTICAL_SWIPE_THRESHOLD_PX = 64;
const TAP_TOLERANCE_PX = 12;
const FILMSTRIP_INERTIA_MIN_VELOCITY = 0.015;
const FILMSTRIP_INERTIA_START_VELOCITY = 0.24;
const FILMSTRIP_INERTIA_MAX_VELOCITY = 3;
const FILMSTRIP_INERTIA_FRICTION = 0.0018;
const FILMSTRIP_NATIVE_SETTLE_MS = 120;
const FILMSTRIP_NATIVE_RELEASE_GRACE_MS = 220;
const FILMSTRIP_SNAP_DURATION_MS = 156;
const FILMSTRIP_SELECTION_SETTLE_MS = 220;
const INFO_LAYOUT_TRANSITION_MS = 180;
const INFO_LAYOUT_REFRESH_FALLBACK_MS = INFO_LAYOUT_TRANSITION_MS + 80;
const FILMSTRIP_WHEEL_AXIS_DOMINANCE = 1.15;
const FILMSTRIP_WHEEL_X_DEADZONE_PX = 2;
const SECTION_CHANGE_TOAST_MS = 1000;
const STAGE_WHEEL_SWIPE_THRESHOLD_PX = 72;
const STAGE_WHEEL_GESTURE_IDLE_MS = 180;
const STAGE_WHEEL_PAGE_RELEASE_IDLE_MS = 72;
const STAGE_WHEEL_AXIS_DOMINANCE = 1.15;
const STAGE_WHEEL_RESTART_AXIS_DOMINANCE = 1.35;
const STAGE_WHEEL_RESTART_CANDIDATE_MAX_GAP_MS = 48;
const STAGE_WHEEL_RESTART_CONFIRM_DELTA_PX = 4;
const STAGE_WHEEL_RESTART_CONFIRM_RATIO = 1.1;
const STAGE_WHEEL_RESTART_GAP_MS = 80;
const STAGE_WHEEL_RESTART_GROWTH_DELTA_PX = 10;
const STAGE_WHEEL_RESTART_GROWTH_RATIO = 1.8;
const STAGE_WHEEL_RESTART_MIN_MAGNITUDE = 18;
const STAGE_WHEEL_RESTART_QUIET_CANDIDATE_GAP_MS =
	STAGE_WHEEL_PAGE_RELEASE_IDLE_MS;
const STAGE_WHEEL_RESTART_TAIL_MAGNITUDE = 12;
const STAGE_WHEEL_RESTART_TAIL_SAMPLES = 2;
const VIEWPORT_RESIZE_SETTLE_MS = 120;
const ROTATION_FREEZE_MAX_EDGE_PX = 320;
const ROTATION_FREEZE_REMOVE_FALLBACK_MS = 220;
const STAGE_PAGE_SWIPE_AXIS_DOMINANCE = 1.1;
const STAGE_PAGE_SWIPE_LOCK_PX = 10;
const STAGE_PAGE_SWIPE_DISTANCE_RATIO = 0.24;
const STAGE_PAGE_SWIPE_MAX_DISTANCE_PX = 120;
const STAGE_PAGE_SWIPE_MIN_DISTANCE_PX = 56;
const STAGE_PAGE_SWIPE_VELOCITY_MIN_DISTANCE_PX = 18;
const STAGE_PAGE_SWIPE_VELOCITY_THRESHOLD_PX_PER_MS = 0.45;
const STAGE_PAGE_RELEASE_VELOCITY_DECAY_MS = 80;
const STAGE_PAGE_SWIPE_SETTLE_MS = 180;
const DESKTOP_DOUBLE_CLICK_MS = 240;
const DESKTOP_DOUBLE_CLICK_DISTANCE_PX = 18;
const LIGHTBOX_TITLE_ID = 'section-gallery-lightbox-title';
const LIGHTBOX_INFO_ID = 'section-gallery-lightbox-info';
const LIGHTBOX_INFO_TITLE_ID = 'section-gallery-lightbox-info-title';
const MAX_IMAGE_ZOOM = 5;

const STAGE_WHEEL_OPTIONS = {
	axisDominance: STAGE_WHEEL_AXIS_DOMINANCE,
	idleMs: STAGE_WHEEL_GESTURE_IDLE_MS,
	restartAxisDominance: STAGE_WHEEL_RESTART_AXIS_DOMINANCE,
	restartCandidateMaxGapMs: STAGE_WHEEL_RESTART_CANDIDATE_MAX_GAP_MS,
	restartConfirmDeltaPx: STAGE_WHEEL_RESTART_CONFIRM_DELTA_PX,
	restartConfirmRatio: STAGE_WHEEL_RESTART_CONFIRM_RATIO,
	restartGapMs: STAGE_WHEEL_RESTART_GAP_MS,
	restartGrowthDeltaPx: STAGE_WHEEL_RESTART_GROWTH_DELTA_PX,
	restartGrowthRatio: STAGE_WHEEL_RESTART_GROWTH_RATIO,
	restartMinMagnitude: STAGE_WHEEL_RESTART_MIN_MAGNITUDE,
	restartQuietCandidateGapMs: STAGE_WHEEL_RESTART_QUIET_CANDIDATE_GAP_MS,
	restartTailMagnitude: STAGE_WHEEL_RESTART_TAIL_MAGNITUDE,
	restartTailSamples: STAGE_WHEEL_RESTART_TAIL_SAMPLES,
	thresholdPx: STAGE_WHEEL_SWIPE_THRESHOLD_PX,
};

const FILMSTRIP_WHEEL_ROUTE_OPTIONS = {
	axisDominance: FILMSTRIP_WHEEL_AXIS_DOMINANCE,
	deadzonePx: FILMSTRIP_WHEEL_X_DEADZONE_PX,
};

const FILMSTRIP_NATIVE_SETTLE_OPTIONS = {
	quietMs: FILMSTRIP_NATIVE_SETTLE_MS,
	releaseGraceMs: FILMSTRIP_NATIVE_RELEASE_GRACE_MS,
};

const STAGE_PAGE_SWIPE_OPTIONS = {
	distanceRatio: STAGE_PAGE_SWIPE_DISTANCE_RATIO,
	maxDistancePx: STAGE_PAGE_SWIPE_MAX_DISTANCE_PX,
	minDistancePx: STAGE_PAGE_SWIPE_MIN_DISTANCE_PX,
	velocityMinDistancePx: STAGE_PAGE_SWIPE_VELOCITY_MIN_DISTANCE_PX,
	velocityThresholdPxPerMs: STAGE_PAGE_SWIPE_VELOCITY_THRESHOLD_PX_PER_MS,
};

interface MediaDimensions {
	height: number;
	width: number;
}

interface ObsidianDomWindow extends Window {
	createDiv(): HTMLDivElement;
	createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
	): HTMLElementTagNameMap[K];
}

interface PointerPosition {
	x: number;
	y: number;
}

interface StagePointerStart extends PointerPosition {
	at: number;
	id: number;
	mode: 'navigate' | 'pan';
	originIndex: number;
	panX: number;
	panY: number;
	pointerType: string;
	startedOnImage: boolean;
}

interface StagePageSwipe {
	deltaX: number;
	filmstripSync: StagePageFilmstripSync | null;
	lastAt: number;
	lastX: number;
	neighborIndex: number;
	originIndex: number;
	pointerId: number;
	velocityX: number;
	viewportWidth: number;
}

interface StageWheelPageSwipe {
	deltaX: number;
	filmstripSync: StagePageFilmstripSync | null;
	neighborIndex: number;
	originIndex: number;
	viewportWidth: number;
}

interface StagePageFilmstripSync {
	cloneEl: HTMLButtonElement | null;
	collapsedItemWidth: number;
	collapsedMediaWidth: number;
	currentPageOffset: number;
	direction: -1 | 1;
	expandedItemWidth: number;
	expandedMediaWidth: number;
	filmstripMaxScrollLeft: number;
	filmstripViewportWidth: number;
	originCenter: number;
	originButton: HTMLButtonElement;
	originIndex: number;
	originThumbnail: HTMLElement | null;
	targetButton: HTMLButtonElement;
	targetCenter: number;
	targetIndex: number;
	targetThumbnail: HTMLElement | null;
	viewportWidth: number;
	visualTarget: HTMLButtonElement;
	visualTargetThumbnail: HTMLElement | null;
}

interface StagePageFilmstripMorphPending {
	pageOffset: number;
	sync: StagePageFilmstripSync;
	viewportWidth: number;
}

interface StagePageSettle {
	commit: boolean;
	filmstripSync: StagePageFilmstripSync | null;
	generation: number;
	originIndex: number;
	source: 'pointer' | 'wheel';
	targetIndex: number;
}

interface PinchGesture {
	anchorX: number;
	anchorY: number;
	baseCenterX: number;
	baseCenterY: number;
	startDistance: number;
	startScale: number;
}

interface FilmstripScrub {
	active: boolean;
	interruptedInertia: boolean;
	lastTime: number;
	originalIndex: number;
	pointerId: number;
	pointerType: string;
	startScrollLeft: number;
	startX: number;
	velocity: number;
}

interface FilmstripMouseMove {
	clientX: number;
	pointerId: number;
	timeStamp: number;
}

interface MouseTap extends PointerPosition {
	at: number;
}

interface InfoSwipeStart extends PointerPosition {
	id: number;
	startedAtTop: boolean;
}

interface InfoElements {
	dimensions: HTMLElement;
	duration: HTMLElement;
	durationLabel: HTMLElement;
	extension: HTMLElement;
	frameRate: HTMLElement;
	frameRateLabel: HTMLElement;
	modified: HTMLElement;
	path: HTMLElement;
	size: HTMLElement;
}

interface VideoDetails {
	approximateFps: number | null;
	durationSeconds: number | null;
	frameRateUnavailable?: boolean;
}

interface FilmstripCenter {
	center: number;
	index: number;
}

interface NeighborImagePreload {
	generation: number;
	image: HTMLImageElement;
	index: number;
	ready: boolean;
	resourceUrl: string;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = units[0];
	for (let index = 1; index < units.length && value >= 1024; index += 1) {
		value /= 1024;
		unit = units[index];
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export class MediaLightbox extends Modal {
	private readonly activePointers = new Map<number, PointerPosition>();
	private closeRequested = false;
	private controlsVisible = true;
	private counterEl: HTMLElement | null = null;
	private currentIndex: number;
	private readonly dimensionsByMediaId = new Map<string, MediaDimensions>();
	private filmstripMouseFrame: number | null = null;
	private filmstripMousePending: FilmstripMouseMove | null = null;
	private filmstripScrub: FilmstripScrub | null = null;
	private filmstripScrubFrame: number | null = null;
	private filmstripScrubPendingIndex: number | null = null;
	private filmstripSelectionAnchorCenter: number | null = null;
	private filmstripSelectionAnchorIndex: number | null = null;
	private filmstripSelectionFrame: number | null = null;
	private filmstripSnapAfterSelection = false;
	private filmstripSelectionSettleTimer: number | null = null;
	private filmstripSnapFrame: number | null = null;
	private filmstripInertiaFrame: number | null = null;
	private filmstripInertiaOriginalIndex: number | null = null;
	private filmstripNativeOriginalIndex: number | null = null;
	private filmstripNativeScrolling = false;
	private filmstripNativeLastActivityAt: number | null = null;
	private filmstripNativePointerReleasedAt: number | null = null;
	private filmstripNativeSettleTimer: number | null = null;
	private readonly filmstripTouchIds = new Set<number>();
	private filmstripCenters: FilmstripCenter[] = [];
	private filmstripButtons: HTMLButtonElement[] = [];
	private filmstripBottomEl: HTMLElement | null = null;
	private currentFilmstripButtonEl: HTMLButtonElement | null = null;
	private filmstripEl: HTMLElement | null = null;
	private filmstripEndSpacerEl: HTMLElement | null = null;
	private filmstripLoader: LazyMediaLoader | null = null;
	private filmstripLayoutRefreshFrame: number | null = null;
	private filmstripLayoutRefreshTimer: number | null = null;
	private filmstripScrollerEl: HTMLElement | null = null;
	private filmstripStartSpacerEl: HTMLElement | null = null;
	private filmstripViewportEl: HTMLElement | null = null;
	private readonly filmstripMedia = new Set<
		HTMLImageElement | HTMLVideoElement
	>();
	private scrubPlaceholderEl: HTMLElement | null = null;
	private scrubPreviewEl: HTMLImageElement | null = null;
	private infoButtonEl: HTMLButtonElement | null = null;
	private infoEl: HTMLElement | null = null;
	private infoElements: InfoElements | null = null;
	private infoOpen = false;
	private infoPointerStart: InfoSwipeStart | null = null;
	private infoScrollEl: HTMLElement | null = null;
	private infoSwipeStart: InfoSwipeStart | null = null;
	private mediaEl: HTMLImageElement | HTMLVideoElement | null = null;
	private mediaStageEl: HTMLElement | null = null;
	private mediaFitObserver: ResizeObserver | null = null;
	private desktopChromeObserver: ResizeObserver | null = null;
	private mediaTitleEl: HTMLElement | null = null;
	private readonly neighborImagePreloads = new Map<
		number,
		NeighborImagePreload
	>();
	private neighborImagePreloadGeneration = 0;
	private lastMouseTap: MouseTap | null = null;
	private panX = 0;
	private panY = 0;
	private pinchGesture: PinchGesture | null = null;
	private pointerStart: StagePointerStart | null = null;
	private sectionStructuralKey: string | null = null;
	private sectionToastEl: HTMLElement | null = null;
	private sectionToastTimer: number | null = null;
	private sectionTitleEl: HTMLElement | null = null;
	private shareButtonEl: HTMLButtonElement | null = null;
	private shareGeneration = 0;
	private lastSettledLandscape = false;
	private rotationFreezeCleanupTimer: number | null = null;
	private rotationFreezeEl: HTMLElement | null = null;
	private rotationFreezeLandscape: boolean | null = null;
	private restoreFocusOnClose = true;
	private statusEl: HTMLElement | null = null;
	private stageMediaGeneration = 0;
	private stageMediaInvalidatedForScrub = false;
	private stagePagePreviewEl: HTMLElement | null = null;
	private stagePageFilmstripFrame: number | null = null;
	private stagePageFilmstripMorphFrame: number | null = null;
	private stagePageFilmstripMorphPending: StagePageFilmstripMorphPending | null =
		null;
	private stagePageSettle: StagePageSettle | null = null;
	private stagePageSettleFrame: number | null = null;
	private stagePageSettleTimer: number | null = null;
	private stagePageSwipe: StagePageSwipe | null = null;
	private stagePageSwipeGeneration = 0;
	private stageWheelGesture: WheelBurstState | null = null;
	private stageWheelPageSwipe: StageWheelPageSwipe | null = null;
	private stageWheelPageReleased = false;
	private stageWheelPageReleaseTimer: number | null = null;
	private stageWheelRawRestartCandidate: RawWheelRestartCandidate | null = null;
	private stageWheelResetTimer: number | null = null;
	private stageWheelVisualDeltaX = 0;
	private stageWheelVisualDeltaY = 0;
	private suppressFilmstripClick = false;
	private viewportResizeFrame: number | null = null;
	private viewportResizeRevealFrame: number | null = null;
	private viewportResizeSettleTimer: number | null = null;
	private readonly videoDetailsByMediaId = new Map<string, VideoDetails>();
	private videoFrameCallbackId: number | null = null;
	private videoFrameCallbackMedia: HTMLVideoElement | null = null;
	private videoFrameRateEstimatorState: VideoFrameRateEstimatorState | null =
		null;
	private zoomScale = 1;

	constructor(
		app: App,
		private readonly media: readonly GalleryMedia[],
		initialIndex: number,
		private readonly onRevealSource: (item: GalleryMedia) => Promise<void>,
		private readonly onViewed: (item: GalleryMedia, index: number) => void,
		private readonly onClosed: (restoreFocus: boolean) => void,
	) {
		super(app);
		this.currentIndex = initialIndex;
	}

	onOpen(): void {
		this.closeRequested = false;
		this.restoreFocusOnClose = true;
		this.containerEl.removeClass('is-closing-immediately');
		this.containerEl.removeAttribute('aria-hidden');
		this.lastSettledLandscape = this.getViewportLandscape(false);
		this.contentEl.doc.body.addClass('section-gallery-lightbox-open');
		this.containerEl.addClass('section-gallery-lightbox-container');
		this.modalEl.addClass('section-gallery-lightbox');
		this.modalEl.tabIndex = -1;
		this.modalEl.setAttr('role', 'dialog');
		this.modalEl.setAttr('aria-labelledby', LIGHTBOX_TITLE_ID);
		this.modalEl.setAttr('aria-modal', 'true');
		this.contentEl.addClass('section-gallery-lightbox-content');
		this.contentEl.empty();
		this.removeNativeCloseButtons();
		this.contentEl.win.requestAnimationFrame(() => {
			if (!this.closeRequested) this.removeNativeCloseButtons();
		});

		const header = this.contentEl.createDiv({
			cls: 'section-gallery-lightbox-header section-gallery-lightbox-ui',
		});
		const revealButton = this.createIconButton(
			header,
			'locate-fixed',
			'Go to source in note',
			'section-gallery-lightbox-reveal',
		);
		const titleBlock = header.createDiv({
			cls: 'section-gallery-lightbox-title-block',
		});
		this.sectionTitleEl = titleBlock.createDiv({
			cls: 'section-gallery-lightbox-section-title',
		});
		this.mediaTitleEl = titleBlock.createDiv({
			cls: 'section-gallery-lightbox-title',
		});
		this.mediaTitleEl.id = LIGHTBOX_TITLE_ID;
		const closeButton = this.createIconButton(
			header,
			'x',
			'Close viewer',
			'section-gallery-lightbox-close',
		);

		this.mediaStageEl = this.contentEl.createDiv({
			cls: 'section-gallery-lightbox-stage',
		});
		this.startMediaFitObserver();
		this.sectionToastEl = this.contentEl.createDiv({
			cls: 'section-gallery-lightbox-section-toast',
		});
		this.sectionToastEl.setAttr('aria-hidden', 'true');
		const bottom = this.contentEl.createDiv({
			cls: 'section-gallery-lightbox-bottom section-gallery-lightbox-ui',
		});
		this.filmstripBottomEl = bottom;
		bottom.ontransitionend = this.handleFilmstripLayoutTransitionEnd;
		this.filmstripViewportEl = bottom.createDiv({
			cls: 'section-gallery-lightbox-filmstrip-viewport',
		});
		this.filmstripScrollerEl = this.filmstripViewportEl.createDiv({
			cls: 'section-gallery-lightbox-filmstrip-scroller',
		});
		this.startDesktopChromeObserver(header, this.filmstripViewportEl);
		this.filmstripEl = this.filmstripScrollerEl.createDiv({
			cls: 'section-gallery-lightbox-filmstrip',
		});
		this.createInfoPanel(this.contentEl);
		const footer = this.contentEl.createDiv({
			cls: 'section-gallery-lightbox-footer section-gallery-lightbox-ui',
		});
		this.infoButtonEl = this.createIconButton(
			footer,
			'info',
			'Show media information',
			'section-gallery-lightbox-info-button',
		);
		this.infoButtonEl.setAttr('aria-controls', LIGHTBOX_INFO_ID);
		this.infoButtonEl.setAttr('aria-expanded', 'false');
		this.infoButtonEl.setAttr('aria-pressed', 'false');
		this.counterEl = footer.createDiv({
			cls: 'section-gallery-lightbox-counter',
		});
		this.shareButtonEl = this.createIconButton(
			footer,
			'share-2',
			'Share media',
			'section-gallery-lightbox-share',
		);
		this.statusEl = this.contentEl.createDiv({
			cls: 'section-gallery-lightbox-status',
		});
		this.statusEl.setAttr('aria-live', 'polite');
		this.statusEl.setAttr('role', 'status');

		this.filmstripLoader = new LazyMediaLoader(
			this.app,
			this.filmstripScrollerEl,
			{
			cacheEntries: 40,
			concurrency: 1,
			imageRootMargin: '0px 160px',
			manualMarginPx: 160,
			thumbnailWidth: 160,
			videoRootMargin: '0px 48px',
			},
		);

		if (this.media.length < 2) {
			this.filmstripViewportEl.addClass('is-hidden');
		}

		closeButton.onclick = () => this.close();
		revealButton.onclick = () => {
			const current = this.media[this.currentIndex];
			if (!current) {
				return;
			}
			this.close();
			void this.onRevealSource(current).catch(() => {
				new Notice('Could not open the media location.');
			});
		};
		this.infoButtonEl.onclick = () => this.setInfoOpen(!this.infoOpen);
		this.shareButtonEl.onclick = () => this.handleShare();

		this.mediaStageEl.onpointerdown = this.handleStagePointerDown;
		this.mediaStageEl.onpointermove = this.handleStagePointerMove;
		this.mediaStageEl.onpointerup = this.handleStagePointerEnd;
		this.mediaStageEl.onpointercancel = this.handleStagePointerCancel;
		this.mediaStageEl.onlostpointercapture = this.handleStagePointerCancel;
		this.mediaStageEl.ontransitionend = this.handleStageTransitionEnd;
		this.filmstripViewportEl.onpointerdown = this.handleFilmstripPointerDown;
		this.filmstripViewportEl.onpointermove = this.handleFilmstripPointerMove;
		this.filmstripViewportEl.onpointerup = this.handleFilmstripPointerEnd;
		this.filmstripViewportEl.onpointercancel =
			this.handleFilmstripPointerCancel;
		this.filmstripViewportEl.onclick = this.handleFilmstripClick;
		this.filmstripViewportEl.addEventListener('touchstart', this.handleFilmstripTouchStart, {
			passive: true,
		});
		this.filmstripViewportEl.addEventListener('touchend', this.handleFilmstripTouchEnd, {
			passive: true,
		});
		this.filmstripViewportEl.addEventListener('touchcancel', this.handleFilmstripTouchEnd, {
			passive: true,
		});
		this.filmstripScrollerEl.onscroll = this.handleFilmstripScroll;
		this.filmstripScrollerEl.addEventListener(
			'scrollend',
			this.handleFilmstripScrollEnd,
		);
		this.filmstripEl.addEventListener(
			'transitionend',
			this.handleFilmstripItemTransitionEnd,
		);

		this.scope.register([], 'ArrowLeft', (event) => {
			if (event.targetNode?.instanceOf(HTMLVideoElement)) {
				return;
			}
			this.move(-1);
			return false;
		});
		this.scope.register([], 'ArrowRight', (event) => {
			if (event.targetNode?.instanceOf(HTMLVideoElement)) {
				return;
			}
			this.move(1);
			return false;
		});
		this.scope.register([], 'ArrowUp', (event) => {
			if (event.targetNode?.instanceOf(HTMLVideoElement)) {
				return;
			}
			this.setInfoOpen(true);
			return false;
		});
		this.scope.register([], 'ArrowDown', (event) => {
			if (event.targetNode?.instanceOf(HTMLVideoElement)) {
				return;
			}
			if (this.infoOpen) {
				this.setInfoOpen(false);
			} else {
				this.close();
			}
			return false;
		});
		this.contentEl.addEventListener('pointerup', this.handlePointerButtonBlur);
		this.contentEl.win.addEventListener('wheel', this.handleViewerWheel, {
			capture: true,
			passive: false,
		});
		this.contentEl.win.addEventListener('resize', this.handleViewportResize);
		this.contentEl.win.addEventListener(
			'orientationchange',
			this.handleViewportOrientationChange,
		);
		this.renderCurrent();
		this.contentEl.win.requestAnimationFrame(() => {
			if (!this.closeRequested && this.modalEl.isConnected) {
				this.modalEl.focus({ preventScroll: true });
				captureGalleryViewerDiagnostics(this.contentEl.doc);
			}
		});
	}

	override close(): void {
		if (this.closeRequested) {
			return;
		}
		captureGalleryViewerDiagnostics(this.contentEl.doc);
		this.closeRequested = true;
		// Phone modal teardown can be deferred. Invalidate asynchronous sharing
		// and stop audio as soon as closing begins, not after the animation.
		this.shareGeneration += 1;
		if (this.mediaEl?.instanceOf(HTMLVideoElement)) {
			this.mediaEl.pause();
		}
		if (Platform.isPhone) {
			// Obsidian defers detach/onClose until its phone close animation ends.
			// Hide this opaque fullscreen surface immediately so that interval cannot
			// expose a stale gallery frame over the workspace.
			this.containerEl.addClass('is-closing-immediately');
			this.containerEl.setAttr('aria-hidden', 'true');
		}
		this.cancelPendingViewerWork();
		super.close();
	}

	private cancelPendingViewerWork(): void {
		this.stopMediaFitObserver();
		this.stopDesktopChromeObserver();
		this.resetStageWheelGesture();
		this.cancelFilmstripInertia();
		this.cancelFilmstripMouseFrame();
		this.cancelFilmstripScrubFrame();
		this.cancelFilmstripSelectionCompensation();
		this.cancelFilmstripSnap();
		this.cancelNativeFilmstripSettle();
		this.cancelFilmstripLayoutRefresh();
		this.cancelViewportResizeSettle(true);
		this.removeRotationFreeze();
		this.cancelStagePageSwipe();
		this.clearNeighborImagePreloads();
		this.clearSectionToast();
		this.cancelVideoFrameRateMeasurement();
		this.stageMediaGeneration += 1;
		this.detachStageMediaLoadHandlers(this.mediaEl);
		this.filmstripLoader?.disconnect();
		this.filmstripLoader = null;
		this.activePointers.clear();
		this.pointerStart = null;
		this.pinchGesture = null;
		this.filmstripScrub = null;
		this.filmstripNativeOriginalIndex = null;
		this.filmstripTouchIds.clear();
	}

	onClose(): void {
		this.closeRequested = true;
		this.contentEl.doc.body.removeClass('section-gallery-lightbox-open');
		this.shareGeneration += 1;
		this.cancelPendingViewerWork();
		this.contentEl.win.removeEventListener('resize', this.handleViewportResize);
		this.contentEl.win.removeEventListener(
			'orientationchange',
			this.handleViewportOrientationChange,
		);
		this.contentEl.win.removeEventListener('wheel', this.handleViewerWheel, true);
		this.contentEl.removeEventListener('pointerup', this.handlePointerButtonBlur);
		this.filmstripViewportEl?.removeEventListener('touchstart', this.handleFilmstripTouchStart);
		this.filmstripViewportEl?.removeEventListener('touchend', this.handleFilmstripTouchEnd);
		this.filmstripViewportEl?.removeEventListener('touchcancel', this.handleFilmstripTouchEnd);
		this.filmstripTouchIds.clear();
		if (this.filmstripScrollerEl) {
			this.filmstripScrollerEl.onscroll = null;
			this.filmstripScrollerEl.removeEventListener(
				'scrollend',
				this.handleFilmstripScrollEnd,
			);
		}
		if (this.filmstripEl) {
			this.filmstripEl.removeEventListener(
				'transitionend',
				this.handleFilmstripItemTransitionEnd,
			);
		}
		if (this.filmstripBottomEl) {
			this.filmstripBottomEl.ontransitionend = null;
		}
		this.disposeStageMedia();
		this.filmstripLoader?.disconnect();
		this.filmstripLoader = null;
		this.filmstripMedia.clear();
		this.activePointers.clear();
		this.filmstripScrub = null;
		this.filmstripScrubPendingIndex = null;
		this.filmstripSelectionAnchorCenter = null;
		this.filmstripSelectionAnchorIndex = null;
		this.filmstripNativeOriginalIndex = null;
		this.filmstripNativeScrolling = false;
		this.filmstripNativeLastActivityAt = null;
		this.filmstripNativePointerReleasedAt = null;
		this.filmstripCenters = [];
		this.filmstripButtons = [];
		this.filmstripBottomEl = null;
		this.currentFilmstripButtonEl = null;
		this.filmstripScrollerEl = null;
		this.filmstripStartSpacerEl = null;
		this.filmstripEndSpacerEl = null;
		this.filmstripViewportEl = null;
		this.scrubPlaceholderEl = null;
		this.scrubPreviewEl = null;
		this.infoButtonEl = null;
		this.infoEl = null;
		this.infoElements = null;
		this.infoScrollEl = null;
		this.infoSwipeStart = null;
		this.infoPointerStart = null;
		this.pointerStart = null;
		this.pinchGesture = null;
		this.sectionStructuralKey = null;
		this.sectionToastEl = null;
		this.counterEl = null;
		this.filmstripEl = null;
		this.mediaStageEl = null;
		this.mediaTitleEl = null;
		this.lastMouseTap = null;
		this.sectionTitleEl = null;
		this.shareButtonEl = null;
		this.statusEl = null;
		this.contentEl.empty();
		this.onClosed(this.restoreFocusOnClose);
	}

	private createIconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		className: string,
	): HTMLButtonElement {
		const button = parent.createEl('button', { cls: className });
		button.type = 'button';
		button.setAttr('aria-label', label);
		setIcon(button, icon);
		return button;
	}

	private removeNativeCloseButtons(): void {
		this.containerEl
			.querySelectorAll('.modal-close-button')
			.forEach((button) => button.remove());
	}

	private createInfoPanel(parent: HTMLElement): void {
		this.infoEl = parent.createDiv({
			cls: 'section-gallery-lightbox-info-panel section-gallery-lightbox-ui',
		});
		this.infoEl.id = LIGHTBOX_INFO_ID;
		this.infoEl.setAttr('aria-hidden', 'true');
		this.infoEl.setAttr('aria-labelledby', LIGHTBOX_INFO_TITLE_ID);
		this.infoEl.setAttr('role', 'region');
		const accessibleTitle = this.infoEl.createDiv({
			cls: 'section-gallery-screen-reader-only',
			text: 'Media information',
		});
		accessibleTitle.id = LIGHTBOX_INFO_TITLE_ID;
		this.infoEl.ontouchstart = this.handleInfoTouchStart;
		this.infoEl.ontouchmove = this.handleInfoTouchMove;
		this.infoEl.ontouchend = this.handleInfoTouchEnd;
		this.infoEl.ontouchcancel = () => {
			this.infoSwipeStart = null;
		};
		this.infoEl.onpointerdown = this.handleInfoPointerDown;
		this.infoEl.onpointermove = this.handleInfoPointerMove;
		this.infoEl.onpointerup = this.handleInfoPointerEnd;
		this.infoEl.onpointercancel = this.handleInfoPointerCancel;
		this.infoScrollEl = this.infoEl.createDiv({
			cls: 'section-gallery-lightbox-info-scroll',
		});
		const content = this.infoScrollEl.createDiv({
			cls: 'section-gallery-lightbox-info-content',
		});
		const list = content.createEl('dl', {
			cls: 'section-gallery-lightbox-info-list',
		});
		const path = this.createInfoRow(list, 'Vault path');
		const size = this.createInfoRow(list, 'File size');
		const dimensions = this.createInfoRow(list, 'Dimensions');
		const durationLabel = list.createEl('dt', { text: 'Duration' });
		const duration = list.createEl('dd');
		const frameRateLabel = list.createEl('dt', { text: 'Frame rate' });
		const frameRate = list.createEl('dd');
		const extension = this.createInfoRow(list, 'Type');
		const modified = this.createInfoRow(list, 'Modified');
		this.infoElements = {
			dimensions,
			duration,
			durationLabel,
			extension,
			frameRate,
			frameRateLabel,
			modified,
			path,
			size,
		};
	}

	private createInfoRow(
		list: HTMLElement,
		label: string,
	): HTMLElement {
		list.createEl('dt', { text: label });
		return list.createEl('dd');
	}

	private readonly handleInfoTouchStart = (event: TouchEvent): void => {
		if (event.touches.length !== 1 || !this.infoScrollEl) {
			this.infoSwipeStart = null;
			return;
		}
		const touch = event.touches.item(0);
		if (!touch) {
			return;
		}
		this.infoSwipeStart = {
			id: touch.identifier,
			startedAtTop: this.infoScrollEl.scrollTop <= 1,
			x: touch.clientX,
			y: touch.clientY,
		};
	};

	private readonly handleInfoTouchMove = (event: TouchEvent): void => {
		const start = this.infoSwipeStart;
		if (!start?.startedAtTop) {
			return;
		}
		for (let index = 0; index < event.touches.length; index += 1) {
			const touch = event.touches.item(index);
			if (touch?.identifier === start.id && this.isInfoDismissSwipe(start, touch)) {
				this.infoSwipeStart = null;
				this.setInfoOpen(false);
				return;
			}
		}
	};

	private readonly handleInfoTouchEnd = (event: TouchEvent): void => {
		const start = this.infoSwipeStart;
		this.infoSwipeStart = null;
		if (!start?.startedAtTop) {
			return;
		}
		let touch: Touch | null = null;
		for (let index = 0; index < event.changedTouches.length; index += 1) {
			const candidate = event.changedTouches.item(index);
			if (candidate?.identifier === start.id) {
				touch = candidate;
				break;
			}
		}
		if (!touch) {
			return;
		}
		if (this.isInfoDismissSwipe(start, touch)) {
			this.setInfoOpen(false);
		}
	};

	private isInfoDismissSwipe(start: InfoSwipeStart, touch: Touch): boolean {
		const deltaX = touch.clientX - start.x;
		const deltaY = touch.clientY - start.y;
		return (
			deltaY >= VERTICAL_SWIPE_THRESHOLD_PX &&
			Math.abs(deltaY) > Math.abs(deltaX)
		);
	}

	private readonly handleInfoPointerDown = (event: PointerEvent): void => {
		if (
			event.pointerType !== 'mouse' ||
			event.button !== 0 ||
			!this.infoEl ||
			!this.infoScrollEl
		) {
			return;
		}
		this.infoPointerStart = {
			id: event.pointerId,
			startedAtTop: this.infoScrollEl.scrollTop <= 1,
			x: event.clientX,
				y: event.clientY,
		};
		this.infoEl.setPointerCapture(event.pointerId);
	};

	private readonly handleInfoPointerMove = (event: PointerEvent): void => {
		const start = this.infoPointerStart;
		if (!start?.startedAtTop || start.id !== event.pointerId) {
			return;
		}
		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		if (
			deltaY < VERTICAL_SWIPE_THRESHOLD_PX ||
			deltaY <= Math.abs(deltaX)
		) {
			return;
		}
		this.infoPointerStart = null;
		this.releasePointerCapture(this.infoEl, event.pointerId);
		this.setInfoOpen(false);
		event.preventDefault();
	};

	private readonly handleInfoPointerEnd = (event: PointerEvent): void => {
		if (this.infoPointerStart?.id === event.pointerId) {
			this.infoPointerStart = null;
		}
		this.releasePointerCapture(this.infoEl, event.pointerId);
	};

	private readonly handleInfoPointerCancel = (event: PointerEvent): void => {
		if (this.infoPointerStart?.id === event.pointerId) {
			this.infoPointerStart = null;
		}
		this.releasePointerCapture(this.infoEl, event.pointerId);
	};

	private readonly handlePointerButtonBlur = (event: PointerEvent): void => {
		const target = event.targetNode;
		const button = target?.instanceOf(Element)
			? target.closest<HTMLButtonElement>('button')
			: null;
		button?.blur();
	};

	private readonly handleStagePointerDown = (event: PointerEvent): void => {
		if (this.closeRequested || (event.pointerType === 'mouse' && event.button !== 0)) {
			return;
		}
		const target = event.targetNode;
		if (
			target?.instanceOf(HTMLVideoElement) ||
			(target?.instanceOf(Element) && target.closest('button'))
		) {
			return;
		}
		if (this.stagePageSettle !== null) {
			if (event.pointerType === 'touch') this.resumeSettlingStagePage(event);
			return;
		}
		this.resetStageWheelGesture();
		this.finalizeFilmstripForStageGesture();
		const startedOnImage = target?.instanceOf(HTMLImageElement) ?? false;
		this.activePointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
		});
		this.mediaStageEl?.setPointerCapture(event.pointerId);

		if (this.activePointers.size >= 2 && this.isCurrentMediaImage()) {
			this.cancelStagePageSwipe();
			this.pointerStart = null;
			this.startPinchGesture();
			event.preventDefault();
			return;
		}

		this.pointerStart = {
			at: event.timeStamp,
			id: event.pointerId,
			mode: this.zoomScale > 1 && startedOnImage ? 'pan' : 'navigate',
			originIndex: this.currentIndex,
			panX: this.panX,
			panY: this.panY,
			pointerType: event.pointerType,
			startedOnImage,
			x: event.clientX,
			y: event.clientY,
		};
	};

	private resumeSettlingStagePage(event: PointerEvent): void {
		const settle = this.stagePageSettle;
		const stage = this.mediaStageEl;
		if (!settle || !stage) return;
		const offset = Number.parseFloat(
			stage.style.getPropertyValue('--section-gallery-page-offset-x'),
		) || 0;
		const neighborIndex = getStagePageNeighborIndex(
			settle.originIndex, this.media.length, offset,
		);
		if (neighborIndex === null) return;
		this.resetStageWheelGesture();
		this.flushStagePageFilmstripMorph();
		this.cancelStagePageFilmstripFrame();
		if (this.stagePageSettleFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.stagePageSettleFrame);
			this.stagePageSettleFrame = null;
		}
		if (this.stagePageSettleTimer !== null) {
			this.contentEl.win.clearTimeout(this.stagePageSettleTimer);
			this.stagePageSettleTimer = null;
		}
		this.stagePageSwipeGeneration += 1;
		this.stagePageSettle = null;
		stage.removeClass('is-page-settling');
		stage.removeClass('is-page-committing');
		stage.removeClass('is-page-returning');
		stage.addClass('is-page-swiping');
		stage.setPointerCapture(event.pointerId);
		this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		// Grab the still-moving page exactly where it is. Rebase the pointer
		// origin rather than snapping to the destination or swallowing the next
		// swipe until a fixed timeout has elapsed.
		this.pointerStart = {
			at: event.timeStamp, id: event.pointerId, mode: 'navigate',
			originIndex: settle.originIndex, panX: this.panX, panY: this.panY,
			pointerType: event.pointerType, startedOnImage: false,
			x: event.clientX - offset, y: event.clientY,
		};
		this.stagePageSwipe = {
			deltaX: offset, filmstripSync: settle.filmstripSync,
			lastAt: event.timeStamp, lastX: event.clientX,
			neighborIndex, originIndex: settle.originIndex,
			pointerId: event.pointerId, velocityX: 0,
			viewportWidth: Math.max(1, stage.getBoundingClientRect().width),
		};
		event.preventDefault();
	}

	private finalizeFilmstripForStageGesture(): void {
		const scrub = this.filmstripScrub;
		if (scrub?.pointerType === 'mouse') {
			this.flushFilmstripMouseMove();
		}
		const originalIndex =
			scrub?.originalIndex ??
			this.filmstripInertiaOriginalIndex ??
			this.filmstripNativeOriginalIndex;
		const hadMotion =
			originalIndex !== null ||
			this.filmstripScrubPendingIndex !== null ||
			this.filmstripInertiaFrame !== null ||
			this.filmstripNativeScrolling ||
			scrub?.active === true;
		const scroller = this.filmstripScrollerEl;
		const frozenScrollLeft = scroller?.scrollLeft ?? 0;
		const centeredIndex = hadMotion
			? this.getCenteredFilmstripIndex()
			: null;

		this.cancelFilmstripMouseFrame();
		this.cancelFilmstripScrubFrame();
		this.cancelFilmstripInertia();
		this.cancelNativeFilmstripSettle();
		this.cancelFilmstripSnap();
		this.cancelFilmstripSelectionCompensation();
		if (scrub) {
			this.releasePointerCapture(this.filmstripViewportEl, scrub.pointerId);
		}
		this.filmstripScrub = null;
		this.filmstripNativeOriginalIndex = null;
		this.filmstripNativeScrolling = false;
		this.filmstripNativeLastActivityAt = null;
		this.filmstripNativePointerReleasedAt = null;
		this.suppressFilmstripClick = false;
		if (scroller && hadMotion) {
			// Recreating the horizontal scrolling box synchronously stops WebKit's
			// native momentum without changing or reloading any thumbnail.
			scroller.addClass('is-stage-gesture-frozen');
			scroller.scrollLeft = frozenScrollLeft;
			void scroller.offsetWidth;
			scroller.removeClass('is-stage-gesture-frozen');
		}

		if (centeredIndex !== null) {
			this.previewScrubIndex(centeredIndex);
		}
		if (hadMotion) {
			this.finishFilmstripScrub(originalIndex ?? this.currentIndex);
		}
		this.cancelFilmstripSnap();
		this.filmstripSnapAfterSelection = false;
		this.centerCurrentFilmstripItem('auto');
	}

	private readonly handleStagePointerMove = (event: PointerEvent): void => {
		if (!this.activePointers.has(event.pointerId)) {
			return;
		}
		this.activePointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
		});

		if (this.pinchGesture && this.activePointers.size >= 2) {
			this.updatePinchGesture();
			event.preventDefault();
			return;
		}

		const start = this.pointerStart;
		if (start?.id === event.pointerId && start.mode === 'pan') {
			this.panX = start.panX + event.clientX - start.x;
			this.panY = start.panY + event.clientY - start.y;
			this.clampPan();
			this.applyMediaTransform();
			event.preventDefault();
			return;
		}

		if (
			start?.id === event.pointerId &&
			start.mode === 'navigate' &&
			start.pointerType === 'touch' &&
			this.media.length > 1
		) {
			const deltaX = event.clientX - start.x;
			const deltaY = event.clientY - start.y;
			if (
				this.stagePageSwipe !== null ||
				(Math.abs(deltaX) >= STAGE_PAGE_SWIPE_LOCK_PX &&
					Math.abs(deltaX) >
						Math.abs(deltaY) * STAGE_PAGE_SWIPE_AXIS_DOMINANCE)
			) {
				this.updateStagePageSwipe(event, deltaX);
				event.preventDefault();
			}
		}
	};

	private readonly handleStagePointerEnd = (event: PointerEvent): void => {
		const wasPinching = this.pinchGesture !== null;
		this.activePointers.delete(event.pointerId);
		this.releasePointerCapture(this.mediaStageEl, event.pointerId);

		if (wasPinching) {
			this.continueStageGestureAfterPinch(event.timeStamp);
			return;
		}

		const start = this.pointerStart;
		if (!start || start.id !== event.pointerId) {
			return;
		}
		this.pointerStart = null;
		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		if (this.stagePageSwipe?.pointerId === event.pointerId) {
			const swipe = this.stagePageSwipe;
			if (event.clientX !== swipe.lastX) {
				this.updateStagePageSwipe(event, deltaX);
			} else {
				// Pointerup commonly repeats the final move position. Treating that
				// as a new zero-speed movement erased quick flicks, while keeping
				// velocity forever committed a held/stationary page unexpectedly.
				swipe.velocityX *= Math.exp(
					-Math.max(0, event.timeStamp - swipe.lastAt) /
						STAGE_PAGE_RELEASE_VELOCITY_DECAY_MS,
				);
			}
			this.finishStagePageSwipe(deltaX);
			event.preventDefault();
			return;
		}
		const isTap =
			Math.abs(deltaX) <= TAP_TOLERANCE_PX &&
			Math.abs(deltaY) <= TAP_TOLERANCE_PX;
		if (!isTap) {
			this.lastMouseTap = null;
		}

		if (start.mode === 'pan') {
			if (isTap && start.startedOnImage) {
				this.handleMediaTap(
					start.pointerType,
					true,
					event.clientX,
					event.clientY,
					event.timeStamp,
				);
			}
			return;
		}

		if (
			Math.abs(deltaY) >= VERTICAL_SWIPE_THRESHOLD_PX &&
			Math.abs(deltaY) > Math.abs(deltaX)
		) {
			if (deltaY < 0) {
				this.setInfoOpen(true);
			} else if (this.infoOpen) {
				this.setInfoOpen(false);
			} else {
				this.close();
			}
			return;
		}

		if (
			this.media.length > 1 &&
			Math.abs(deltaX) >= SWIPE_THRESHOLD_PX &&
			Math.abs(deltaX) > Math.abs(deltaY)
		) {
			this.move(deltaX > 0 ? -1 : 1);
			return;
		}

		if (isTap) {
			this.handleMediaTap(
				start.pointerType,
				start.startedOnImage,
				event.clientX,
				event.clientY,
				event.timeStamp,
			);
		}
	};

	private readonly handleStagePointerCancel = (event: PointerEvent): void => {
		if (!this.activePointers.has(event.pointerId)) {
			return;
		}
		const wasPinching = this.pinchGesture !== null;
		this.activePointers.delete(event.pointerId);
		this.releasePointerCapture(this.mediaStageEl, event.pointerId);
		if (wasPinching) {
			this.continueStageGestureAfterPinch(event.timeStamp);
		}
		if (this.pointerStart?.id === event.pointerId) {
			this.pointerStart = null;
		}
		if (this.stagePageSwipe?.pointerId === event.pointerId) {
			this.finishStagePageSwipe(0, false);
		}
	};

	private continueStageGestureAfterPinch(timeStamp: number): void {
		this.pinchGesture = null;
		this.pointerStart = null;
		if (this.activePointers.size >= 2) {
			// A third finger can lift (or be cancelled) without ending the pinch.
			// Rebase to the two remaining contacts to avoid a scale/position jump.
			this.startPinchGesture();
			return;
		}
		const remaining = this.activePointers.entries().next().value;
		if (remaining) {
			this.pointerStart = {
				at: timeStamp,
				id: remaining[0],
				mode: 'pan',
				originIndex: this.currentIndex,
				panX: this.panX,
				panY: this.panY,
				pointerType: 'touch',
				startedOnImage: false,
				x: remaining[1].x,
				y: remaining[1].y,
			};
		}
	}

	private updateStagePageSwipe(event: PointerEvent, rawDeltaX: number): void {
		const stage = this.mediaStageEl;
		if (!stage || this.stagePageSettle !== null) {
			return;
		}
		let swipe = this.stagePageSwipe;
		if (!swipe) {
			const originIndex = this.pointerStart?.originIndex ?? this.currentIndex;
			const neighborIndex = getStagePageNeighborIndex(
				originIndex,
				this.media.length,
				rawDeltaX,
			);
			if (neighborIndex === null) {
				return;
			}
			const viewportWidth = Math.max(
				1,
				stage.getBoundingClientRect().width,
			);
			const elapsedFromStart = Math.max(
				1,
				event.timeStamp - (this.pointerStart?.at ?? event.timeStamp),
			);
			swipe = {
				deltaX: rawDeltaX,
				filmstripSync: null,
				lastAt: event.timeStamp,
				lastX: event.clientX,
				neighborIndex,
				originIndex,
				pointerId: event.pointerId,
				velocityX: rawDeltaX / elapsedFromStart,
				viewportWidth,
			};
			this.stagePageSwipe = swipe;
			stage.addClass('is-page-swiping');
			this.renderStagePagePreview(neighborIndex, rawDeltaX);
		} else if (swipe.pointerId !== event.pointerId) {
			return;
		}

		const elapsed = event.timeStamp - swipe.lastAt;
		if (elapsed > 0) {
			const instantaneousVelocity = (event.clientX - swipe.lastX) / elapsed;
			swipe.velocityX =
				swipe.velocityX * 0.3 + instantaneousVelocity * 0.7;
		}
		swipe.lastAt = event.timeStamp;
		swipe.lastX = event.clientX;
		const clampedDeltaX = Math.max(
			-swipe.viewportWidth,
			Math.min(swipe.viewportWidth, rawDeltaX),
		);
		swipe.deltaX = clampedDeltaX;
		const neighborIndex = getStagePageNeighborIndex(
			swipe.originIndex,
			this.media.length,
			clampedDeltaX,
		);
		if (neighborIndex !== null && neighborIndex !== swipe.neighborIndex) {
			swipe.neighborIndex = neighborIndex;
			this.renderStagePagePreview(neighborIndex, clampedDeltaX);
		}
		this.setStagePageOffset(clampedDeltaX);
		this.updateStagePageFilmstripSync(swipe, clampedDeltaX);
	}

	private renderStagePagePreview(index: number, deltaX: number): void {
		const stage = this.mediaStageEl;
		const item = this.media[index];
		if (!stage || !item) {
			return;
		}
		this.stagePagePreviewEl?.remove();
		const preview = stage.createDiv({
			cls: 'section-gallery-lightbox-page-preview',
		});
		preview.setAttr('aria-hidden', 'true');
		preview.dataset.mediaIndex = String(index);
		preview.toggleClass('is-previous', deltaX > 0);
		preview.toggleClass('is-next', deltaX < 0);
		const fullResolution = this.neighborImagePreloads.get(index);
		if (fullResolution?.ready) {
			preview.appendChild(fullResolution.image);
			this.stagePagePreviewEl = preview;
			return;
		}
		const button = this.filmstripButtons[index];
		const thumbnail = button?.querySelector<HTMLImageElement>(
			'img.section-gallery-filmstrip-thumbnail',
		);
		const source = thumbnail?.currentSrc || thumbnail?.src || '';
		if (source.startsWith('blob:') || source.startsWith('data:')) {
			const image = preview.createEl('img', {
				cls: 'section-gallery-lightbox-page-preview-media',
				attr: {
					alt: '',
					decoding: 'async',
					draggable: 'false',
					src: source,
				},
			});
			this.sizeThumbnailPreview(image, item, thumbnail);
		} else {
			const placeholder = preview.createDiv({
				cls: 'section-gallery-lightbox-page-preview-placeholder',
			});
			const icon = placeholder.createDiv({
				cls: 'section-gallery-lightbox-page-preview-icon',
			});
			setIcon(icon, item.kind === 'video' ? 'play' : 'image');
			placeholder.createDiv({
				cls: 'section-gallery-lightbox-page-preview-name',
				text: item.file.name,
			});
		}
		this.stagePagePreviewEl = preview;
	}

	private sizeThumbnailPreview(
		image: HTMLImageElement,
		item: GalleryMedia,
		thumbnail?: HTMLImageElement | null,
	): void {
		// Cached thumbnails are intentionally small. Fit their painted content
		// into the original's bounds instead of exposing a tiny low-res tile
		// while the full decoded neighbor is still arriving.
		const dimensions = this.dimensionsByMediaId.get(item.id);
		const host = this.contentEl.win as Window & { ResizeObserver?: typeof ResizeObserver };
		if (Platform.isMobileApp && typeof host.ResizeObserver === 'function') {
			// Use the same contain geometry as the decoded original. An inline
			// 100% x 100% box would letterbox the preview and jump on promotion.
			image.style.removeProperty('width');
			image.style.removeProperty('height');
			image.removeClass('has-fit-ratio');
			image.style.removeProperty('--section-gallery-media-ratio');
			const width = dimensions?.width ?? thumbnail?.naturalWidth ?? 0;
			const height = dimensions?.height ?? thumbnail?.naturalHeight ?? 0;
			this.setMediaFitRatio(image, width, height);
			image.onload = width > 0 && height > 0 ? null : () => {
				this.setMediaFitRatio(image, image.naturalWidth, image.naturalHeight);
				image.onload = null;
			};
			return;
		}
		image.style.width = dimensions ? `${dimensions.width}px` : '100%';
		image.style.height = dimensions ? `${dimensions.height}px` : '100%';
	}

	private setMediaFitRatio(element: HTMLElement, width: number, height: number): void {
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
			return;
		}
		element.style.setProperty('--section-gallery-media-ratio', String(width / height));
		element.addClass('has-fit-ratio');
	}

	private startMediaFitObserver(): void {
		this.stopMediaFitObserver();
		const stage = this.mediaStageEl;
		const host = this.contentEl.win as Window & { ResizeObserver?: typeof ResizeObserver };
		if (!Platform.isMobileApp || !stage || typeof host.ResizeObserver !== 'function') {
			return;
		}
		this.contentEl.removeClass('has-mobile-fit-bounds');
		const observer = new host.ResizeObserver((entries) => {
			if (this.closeRequested || this.mediaFitObserver !== observer) return;
			for (const entry of entries) {
				if (entry.target !== stage) continue;
				const { width, height } = entry.contentRect;
				if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
				// WebKit can keep cqh cached while stage padding animates. Observing
				// its content box publishes the actual safe fit bounds each frame,
				// without synchronous layout reads or changing the observed stage.
				this.contentEl.style.setProperty('--section-gallery-media-fit-width', `${width}px`);
				this.contentEl.style.setProperty('--section-gallery-media-fit-height', `${height}px`);
				this.contentEl.addClass('has-mobile-fit-bounds');
			}
		});
		this.mediaFitObserver = observer;
		observer.observe(stage);
	}

	private stopMediaFitObserver(): void {
		this.mediaFitObserver?.disconnect();
		this.mediaFitObserver = null;
	}

	private startDesktopChromeObserver(header: HTMLElement, filmstrip: HTMLElement): void {
		this.stopDesktopChromeObserver();
		const host = this.contentEl.win as Window & { ResizeObserver?: typeof ResizeObserver };
		if (!Platform.isDesktopApp || typeof host.ResizeObserver !== 'function') return;
		const observer = new host.ResizeObserver((entries) => {
			if (this.closeRequested || this.desktopChromeObserver !== observer) return;
			for (const entry of entries) {
				const property = entry.target === header
					? '--section-gallery-desktop-header-height'
					: entry.target === filmstrip ? '--section-gallery-desktop-filmstrip-height' : null;
				if (!property) continue;
				const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
				if (!Number.isFinite(height) || height < 0 || (entry.target === header && height === 0)) continue;
				// Header text can grow with theme/font settings. Publishing only its
				// size avoids synchronous position reads on every gesture, and these
				// properties affect the stage, never the observed chrome's own size.
				this.contentEl.style.setProperty(property, `${height}px`);
			}
		});
		this.desktopChromeObserver = observer;
		observer.observe(header, { box: 'border-box' });
		observer.observe(filmstrip, { box: 'border-box' });
	}

	private stopDesktopChromeObserver(): void {
		this.desktopChromeObserver?.disconnect();
		this.desktopChromeObserver = null;
	}

	private refreshNeighborImagePreloads(): void {
		if (this.media.length < 2) {
			this.clearNeighborImagePreloads();
			return;
		}
		const targetIndices = new Set(
			getCyclicNeighborIndices(this.currentIndex, this.media.length).filter(
				(index) => this.media[index]?.kind === 'image',
			),
		);
		for (const [index, preload] of this.neighborImagePreloads) {
			const item = this.media[index];
			if (
				targetIndices.has(index) &&
				item?.resourceUrl === preload.resourceUrl
			) {
				continue;
			}
			this.disposeNeighborImagePreload(preload);
			this.neighborImagePreloads.delete(index);
		}
		for (const index of targetIndices) {
			if (this.neighborImagePreloads.has(index)) {
				continue;
			}
			const item = this.media[index];
			if (!item || item.kind !== 'image') {
				continue;
			}
			const image = this.getDomWindow().createEl('img');
			image.addClass('section-gallery-lightbox-page-preview-media');
			image.alt = '';
			image.decoding = 'async';
			image.draggable = false;
			const preload: NeighborImagePreload = {
				generation: ++this.neighborImagePreloadGeneration,
				image,
				index,
				ready: false,
				resourceUrl: item.resourceUrl,
			};
			this.neighborImagePreloads.set(index, preload);
			image.onload = () => {
				void this.completeNeighborImagePreload(preload);
			};
			image.onerror = () => {
				if (this.isCurrentNeighborImagePreload(preload)) {
					this.neighborImagePreloads.delete(index);
					this.disposeNeighborImagePreload(preload);
				}
			};
			// `resourceUrl` is already Obsidian's full-original URL. Using it avoids
			// duplicating the file into a Blob/ArrayBuffer in the JavaScript heap.
			image.src = item.resourceUrl;
		}
	}

	private async completeNeighborImagePreload(
		preload: NeighborImagePreload,
	): Promise<void> {
		const { image } = preload;
		image.onload = null;
		image.onerror = null;
		try {
			await image.decode();
		} catch {
			// A loaded image can still reject decode() in older WebKit builds. Its
			// intrinsic dimensions below are the authoritative renderability check.
		}
		if (
			!this.isCurrentNeighborImagePreload(preload) ||
			image.naturalWidth <= 0 ||
			image.naturalHeight <= 0
		) {
			return;
		}
		preload.ready = true;
		this.setMediaFitRatio(image, image.naturalWidth, image.naturalHeight);
		const item = this.media[preload.index];
		if (item) {
			this.rememberMediaDimensions(
				item,
				image.naturalWidth,
				image.naturalHeight,
			);
		}
		const preview = this.stagePagePreviewEl;
		if (
			preview?.isConnected &&
			Number(preview.dataset.mediaIndex) === preload.index
		) {
			// The decoded node replaces the thumbnail/placeholder atomically, so a
			// late preload never creates an empty frame during the drag.
			preview.replaceChildren(image);
		}
	}

	private isCurrentNeighborImagePreload(
		preload: NeighborImagePreload,
	): boolean {
		const current = this.neighborImagePreloads.get(preload.index);
		return (
			current === preload &&
			current.generation === preload.generation &&
			this.media[preload.index]?.resourceUrl === preload.resourceUrl
		);
	}

	private clearNeighborImagePreloads(): void {
		this.neighborImagePreloadGeneration += 1;
		for (const preload of this.neighborImagePreloads.values()) {
			this.disposeNeighborImagePreload(preload);
		}
		this.neighborImagePreloads.clear();
	}

	private disposeNeighborImagePreload(preload: NeighborImagePreload): void {
		preload.image.onload = null;
		preload.image.onerror = null;
		preload.image.remove();
		preload.image.removeAttribute('src');
	}

	private takeReadyNeighborImage(index: number): HTMLImageElement | null {
		const preload = this.neighborImagePreloads.get(index);
		const item = this.media[index];
		if (!preload?.ready || !item || item.kind !== 'image') {
			return null;
		}
		this.neighborImagePreloads.delete(index);
		const image = preload.image;
		image.remove();
		image.removeClass('section-gallery-lightbox-page-preview-media');
		return image;
	}

	private setStagePageOffset(deltaX: number): void {
		this.mediaStageEl?.style.setProperty(
			'--section-gallery-page-offset-x',
			`${deltaX}px`,
		);
	}

	private updateStagePageFilmstripSync(
		motion: StagePageSwipe | StageWheelPageSwipe,
		pageOffset: number,
	): void {
		if (!this.filmstripScrollerEl || this.media.length < 2) {
			return;
		}
		if (motion.filmstripSync?.targetIndex !== motion.neighborIndex) {
			if (motion.filmstripSync) {
				this.flushStagePageFilmstripMorph();
				this.finishStagePageFilmstripSettle(
					motion.filmstripSync,
					motion.originIndex,
				);
			}
			motion.filmstripSync = this.createStagePageFilmstripSync(
				motion.originIndex,
				motion.neighborIndex,
				pageOffset,
				motion.viewportWidth,
			);
		}
		const sync = motion.filmstripSync;
		if (!sync) {
			return;
		}
		this.queueStagePageFilmstripMorph(sync, pageOffset, motion.viewportWidth);
	}

	private queueStagePageFilmstripMorph(
		sync: StagePageFilmstripSync,
		pageOffset: number,
		viewportWidth: number,
	): void {
		this.stagePageFilmstripMorphPending = {
			pageOffset,
			sync,
			viewportWidth,
		};
		if (this.stagePageFilmstripMorphFrame !== null) {
			return;
		}
		this.stagePageFilmstripMorphFrame =
			this.contentEl.win.requestAnimationFrame(() => {
				this.stagePageFilmstripMorphFrame = null;
				this.flushStagePageFilmstripMorph();
			});
	}

	private flushStagePageFilmstripMorph(): void {
		if (this.stagePageFilmstripMorphFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(
				this.stagePageFilmstripMorphFrame,
			);
			this.stagePageFilmstripMorphFrame = null;
		}
		const pending = this.stagePageFilmstripMorphPending;
		this.stagePageFilmstripMorphPending = null;
		if (pending) {
			this.applyStagePageFilmstripMorph(
				pending.sync,
				pending.pageOffset,
				pending.viewportWidth,
			);
		}
	}

	private cancelStagePageFilmstripMorphFrame(): void {
		if (this.stagePageFilmstripMorphFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(
				this.stagePageFilmstripMorphFrame,
			);
			this.stagePageFilmstripMorphFrame = null;
		}
		this.stagePageFilmstripMorphPending = null;
	}

	private createStagePageFilmstripSync(
		originIndex: number,
		targetIndex: number,
		pageOffset: number,
		viewportWidth: number,
	): StagePageFilmstripSync | null {
		const scroller = this.filmstripScrollerEl;
		const filmstrip = this.filmstripEl;
		const originButton = this.filmstripButtons[originIndex];
		const targetButton = this.filmstripButtons[targetIndex];
		if (!scroller || !filmstrip || !originButton || !targetButton) {
			return null;
		}
		this.cancelFilmstripSnap();
		this.cancelFilmstripSelectionCompensation();
		let cloneEl: HTMLButtonElement | null = null;
		let visualTarget = targetButton;
		if (
			isCyclicStagePageWrap(originIndex, targetIndex, this.media.length) &&
			this.filmstripStartSpacerEl &&
			this.filmstripEndSpacerEl
		) {
			cloneEl = targetButton.cloneNode(true) as HTMLButtonElement;
			// A cyclic edge clone is decorative and has no lazy-loader owner. Do
			// not let an iOS native fallback create an unbounded extra decoder.
			for (const video of cloneEl.querySelectorAll<HTMLVideoElement>('video.section-gallery-native-video-preview')) {
				video.pause();
				video.removeAttribute('src');
				video.load();
				video.remove();
			}
			cloneEl.removeAttribute('data-media-index');
			cloneEl.removeAttribute('aria-current');
			cloneEl.removeClass('is-current');
			cloneEl.addClass('section-gallery-filmstrip-page-clone');
			cloneEl.tabIndex = -1;
			cloneEl.inert = true;
			cloneEl.setAttr('aria-hidden', 'true');
			const cloneImage = cloneEl.querySelector<HTMLImageElement>(
				'img.section-gallery-filmstrip-thumbnail',
			);
			cloneImage?.removeClass('section-gallery-native-preview-anchor');
			const preload = this.neighborImagePreloads.get(targetIndex);
			const preloadSource =
				preload?.image.currentSrc || preload?.image.src || '';
			const cloneSource = cloneImage?.currentSrc || cloneImage?.src || '';
			const cloneMedia = resolveStagePageFilmstripCloneMedia(
				cloneSource,
				cloneEl.hasClass('is-loaded'),
				preloadSource,
				preload?.ready === true,
			);
			if (cloneImage && cloneMedia.source) {
				cloneImage.src = cloneMedia.source;
			}
			cloneEl.toggleClass('is-loaded', cloneMedia.isLoaded);
			if (originIndex === 0) {
				filmstrip.insertBefore(cloneEl, originButton);
			} else {
				filmstrip.insertBefore(cloneEl, this.filmstripEndSpacerEl);
			}
			visualTarget = cloneEl;
		}
		const originThumbnail = originButton.querySelector<HTMLElement>(
			'.section-gallery-filmstrip-thumbnail',
		);
		const targetThumbnail = targetButton.querySelector<HTMLElement>(
			'.section-gallery-filmstrip-thumbnail',
		);
		const visualTargetThumbnail = visualTarget.querySelector<HTMLElement>(
			'.section-gallery-filmstrip-thumbnail',
		);
		const expandedItemWidth = Math.max(1, originButton.offsetWidth);
		const collapsedItemWidth = Math.max(1, targetButton.offsetWidth);
		const expandedMediaWidth = Math.max(
			1,
			originThumbnail?.offsetWidth ?? expandedItemWidth,
		);
		const collapsedMediaWidth = Math.max(
			1,
			targetThumbnail?.offsetWidth ?? collapsedItemWidth,
		);
		originButton.addClass('is-page-origin');
		visualTarget.addClass('is-page-target');
		// Only the two active slots are needed for page tracking. Recomputing all
		// thumbnail centers here synchronously blocks the first wheel paint in large
		// galleries; invalidate that cache and rebuild it once the gesture settles.
		this.updateFilmstripEdgeSpacers(originButton);
		this.filmstripCenters = [];
		const originCenter = originButton.offsetLeft + originButton.offsetWidth / 2;
		const targetCenter =
			visualTarget.offsetLeft + visualTarget.offsetWidth / 2;
		const filmstripViewportWidth = Math.max(
			1,
			this.filmstripViewportEl?.clientWidth ?? scroller.clientWidth,
		);
		const filmstripMaxScrollLeft = Math.max(
			0,
			scroller.scrollWidth - scroller.clientWidth,
		);
		scroller.scrollLeft = getStagePageFilmstripScrollLeft({
			itemWidthDelta: expandedItemWidth - collapsedItemWidth,
			maxScrollLeft: filmstripMaxScrollLeft,
			originCenter,
			progress: 0,
			targetCenter,
			viewportWidth: filmstripViewportWidth,
		});
		const sync: StagePageFilmstripSync = {
			cloneEl,
			collapsedItemWidth,
			collapsedMediaWidth,
			currentPageOffset: 0,
			direction: pageOffset < 0 ? -1 : 1,
			expandedItemWidth,
			expandedMediaWidth,
			filmstripMaxScrollLeft,
			filmstripViewportWidth,
			originCenter,
			originButton,
			originIndex,
			originThumbnail,
			targetButton,
			targetCenter,
			targetIndex,
			targetThumbnail,
			viewportWidth: Math.max(1, viewportWidth),
			visualTarget,
			visualTargetThumbnail,
		};
		return sync;
	}

	private applyStagePageFilmstripMorph(
		sync: StagePageFilmstripSync,
		pageOffset: number,
		viewportWidth: number,
	): void {
		const scroller = this.filmstripScrollerEl;
		if (
			!scroller?.isConnected ||
			!sync.originButton.isConnected ||
			!sync.visualTarget.isConnected
		) {
			return;
		}
		sync.viewportWidth = Math.max(1, viewportWidth);
		sync.currentPageOffset = Math.max(
			-sync.viewportWidth,
			Math.min(sync.viewportWidth, pageOffset),
		);
		if (sync.currentPageOffset !== 0) {
			sync.direction = sync.currentPageOffset < 0 ? -1 : 1;
		}
		const morph = getStagePageFilmstripMorph(
			sync.currentPageOffset,
			sync.viewportWidth,
			sync.expandedItemWidth,
			sync.collapsedItemWidth,
			sync.expandedMediaWidth,
			sync.collapsedMediaWidth,
		);
		this.filmstripEl?.style.setProperty(
			'--section-gallery-page-selection-progress',
			String(morph.progress),
		);
		this.applyStagePageFilmstripItemMorph(
			sync.originButton,
			sync.originThumbnail,
			morph.originItemWidth,
			morph.originMediaWidth,
			morph.originMediaInset,
		);
		this.applyStagePageFilmstripItemMorph(
			sync.visualTarget,
			sync.visualTargetThumbnail,
			morph.targetItemWidth,
			morph.targetMediaWidth,
			morph.targetMediaInset,
		);
		this.filmstripCenters = [];
		scroller.scrollLeft = getStagePageFilmstripScrollLeft({
			itemWidthDelta: sync.expandedItemWidth - sync.collapsedItemWidth,
			maxScrollLeft: sync.filmstripMaxScrollLeft,
			originCenter: sync.originCenter,
			progress: morph.progress,
			targetCenter: sync.targetCenter,
			viewportWidth: sync.filmstripViewportWidth,
		});
	}

	private applyStagePageFilmstripItemMorph(
		button: HTMLButtonElement,
		thumbnail: HTMLElement | null,
		itemWidth: number,
		mediaWidth: number,
		mediaInset: number,
	): void {
		button.style.setProperty('width', `${itemWidth}px`);
		if (!thumbnail) {
			return;
		}
		thumbnail.style.setProperty('left', `${mediaInset}px`);
		thumbnail.style.setProperty('right', `${mediaInset}px`);
		thumbnail.style.setProperty('width', `${mediaWidth}px`);
	}

	private getCenteredFilmstripScrollLeft(button: HTMLElement): number {
		const scroller = this.filmstripScrollerEl;
		const viewport = this.filmstripViewportEl;
		if (!scroller || !viewport) {
			return 0;
		}
		return Math.max(
			0,
			Math.min(
				scroller.scrollWidth - scroller.clientWidth,
				button.offsetLeft + button.offsetWidth / 2 - viewport.clientWidth / 2,
			),
		);
	}

	private startStagePageSettleAnimation(
		settle: StagePageSettle | null,
		reducedMotion: boolean,
		startOffset: number,
		targetOffset: number,
	): void {
		const sync = settle?.filmstripSync;
		if (!settle || !this.mediaStageEl) {
			return;
		}
		this.cancelStagePageFilmstripFrame();
		// The page and carousel must share one clock and easing curve. A CSS
		// transition for the page plus a separate carousel tween drifts visibly
		// after release, particularly on mobile frames slower than 60 Hz.
		const applyOffset = (offset: number): void => {
			this.setStagePageOffset(offset);
			if (sync) {
				this.applyStagePageFilmstripMorph(sync, offset, sync.viewportWidth);
			}
		};
		if (reducedMotion || Math.abs(targetOffset - startOffset) < 0.5) {
			applyOffset(targetOffset);
			this.completeStagePageSettle(settle.generation);
			return;
		}
		const startedAt = this.contentEl.win.performance.now();
		const step = (now: number): void => {
			if (
				this.stagePageSettle?.generation !== settle.generation ||
				!this.mediaStageEl?.isConnected ||
				this.closeRequested
			) {
				this.stagePageFilmstripFrame = null;
				return;
			}
			const progress = Math.min(
				1,
				Math.max(0, (now - startedAt) / STAGE_PAGE_SWIPE_SETTLE_MS),
			);
			const eased = 1 - Math.pow(1 - progress, 3);
			applyOffset(startOffset + (targetOffset - startOffset) * eased);
			if (progress < 1) {
				this.stagePageFilmstripFrame =
					this.contentEl.win.requestAnimationFrame(step);
				return;
			}
			this.stagePageFilmstripFrame = null;
			this.completeStagePageSettle(settle.generation);
		};
		this.stagePageFilmstripFrame =
			this.contentEl.win.requestAnimationFrame(step);
	}

	private finishStagePageFilmstripSettle(
		sync: StagePageFilmstripSync | null,
		destinationIndex: number,
	): void {
		this.flushStagePageFilmstripMorph();
		this.cancelStagePageFilmstripFrame();
		const committed = sync?.targetIndex === destinationIndex;
		if (sync) {
			this.applyStagePageFilmstripMorph(
				sync,
				committed ? sync.direction * sync.viewportWidth : 0,
				sync.viewportWidth,
			);
			if (committed && sync.cloneEl) {
				const finalMorph = getStagePageFilmstripMorph(
					sync.viewportWidth,
					sync.viewportWidth,
					sync.expandedItemWidth,
					sync.collapsedItemWidth,
					sync.expandedMediaWidth,
					sync.collapsedMediaWidth,
				);
				sync.targetButton.addClass('is-page-target');
				this.applyStagePageFilmstripItemMorph(
					sync.targetButton,
					sync.targetThumbnail,
					finalMorph.targetItemWidth,
					finalMorph.targetMediaWidth,
					finalMorph.targetMediaInset,
				);
			}
			if (sync.cloneEl) {
				this.clearStagePageFilmstripItemMorph(
					sync.cloneEl,
					sync.visualTargetThumbnail,
				);
				sync.cloneEl.remove();
				sync.cloneEl = null;
			}
			if (!committed) {
				this.clearStagePageFilmstripMorph(sync);
			}
		}
		if (!committed) {
			this.updateFilmstripGeometry();
		}
		const destination = this.filmstripButtons[destinationIndex];
		if (destination && this.filmstripScrollerEl) {
			this.filmstripScrollerEl.scrollLeft =
				this.getCenteredFilmstripScrollLeft(destination);
		}
	}

	private clearStagePageFilmstripMorph(
		sync: StagePageFilmstripSync | null,
	): void {
		if (!sync) {
			return;
		}
		const items = new Map<HTMLButtonElement, HTMLElement | null>([
			[sync.originButton, sync.originThumbnail],
			[sync.targetButton, sync.targetThumbnail],
			[sync.visualTarget, sync.visualTargetThumbnail],
		]);
		for (const [button, thumbnail] of items) {
			this.clearStagePageFilmstripItemMorph(button, thumbnail);
			button.removeClass('is-page-origin');
			button.removeClass('is-page-target');
		}
		this.filmstripEl?.style.removeProperty(
			'--section-gallery-page-selection-progress',
		);
		this.filmstripCenters = [];
	}

	private clearStagePageFilmstripItemMorph(
		button: HTMLButtonElement,
		thumbnail: HTMLElement | null,
	): void {
		button.style.removeProperty('width');
		thumbnail?.style.removeProperty('left');
		thumbnail?.style.removeProperty('right');
		thumbnail?.style.removeProperty('width');
	}

	private cancelStagePageFilmstripFrame(): void {
		if (this.stagePageFilmstripFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.stagePageFilmstripFrame);
			this.stagePageFilmstripFrame = null;
		}
	}

	private finishStagePageSwipe(
		deltaX: number,
		allowCommit = true,
	): void {
		const swipe = this.stagePageSwipe;
		const stage = this.mediaStageEl;
		if (!swipe || !stage) {
			return;
		}
		this.flushStagePageFilmstripMorph();
		this.stagePageSwipe = null;
		const commit =
			allowCommit &&
			shouldCommitStagePageSwipe(
				deltaX,
				swipe.velocityX,
				swipe.viewportWidth,
				STAGE_PAGE_SWIPE_OPTIONS,
			);
		const targetIndex = resolveStagePageReleaseIndex(
			swipe.originIndex,
			this.media.length,
			deltaX,
			commit,
		);
		const generation = this.stagePageSwipeGeneration + 1;
		this.stagePageSwipeGeneration = generation;
		this.stagePageSettle = {
			commit,
			filmstripSync: swipe.filmstripSync,
			generation,
			originIndex: swipe.originIndex,
			source: 'pointer',
			targetIndex,
		};
		stage.removeClass('is-page-swiping');
		stage.addClass('is-page-settling');
		stage.toggleClass('is-page-committing', commit);
		stage.toggleClass('is-page-returning', !commit);
		const reducedMotion = this.contentEl.win.matchMedia(
			'(prefers-reduced-motion: reduce)',
		).matches;
		const finalOffset = commit
			? Math.sign(deltaX || swipe.deltaX) * swipe.viewportWidth
			: 0;
		this.stagePageSettleFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.stagePageSettleFrame = null;
			if (this.stagePageSettle?.generation !== generation) {
				return;
			}
			this.startStagePageSettleAnimation(
				this.stagePageSettle,
				reducedMotion,
				swipe.deltaX,
				finalOffset,
			);
			if (this.stagePageSettle?.generation !== generation) {
				return;
			}
			this.stagePageSettleTimer = this.contentEl.win.setTimeout(() => {
				this.stagePageSettleTimer = null;
				this.completeStagePageSettle(generation);
			}, STAGE_PAGE_SWIPE_SETTLE_MS + 80);
		});
	}

	private completeStagePageSettle(generation: number): void {
		const settle = this.stagePageSettle;
		if (this.closeRequested || !settle || settle.generation !== generation) {
			return;
		}
		this.stagePageSettle = null;
		if (this.stagePageSettleFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.stagePageSettleFrame);
			this.stagePageSettleFrame = null;
		}
		if (this.stagePageSettleTimer !== null) {
			this.contentEl.win.clearTimeout(this.stagePageSettleTimer);
			this.stagePageSettleTimer = null;
		}
		this.finishStagePageFilmstripSettle(
			settle.filmstripSync,
			settle.commit ? settle.targetIndex : settle.originIndex,
		);
		if (settle.commit && this.media[settle.targetIndex]) {
			this.currentIndex = settle.targetIndex;
			const promotedImage = this.takeReadyNeighborImage(settle.targetIndex);
			if (!promotedImage) {
				this.showScrubPreview(settle.targetIndex);
			}
			this.clearStagePageSwipeVisuals();
			this.renderCurrent(true, promotedImage === null, promotedImage);
			this.clearStagePageFilmstripMorph(settle.filmstripSync);
			this.updateFilmstripGeometry();
			this.snapFilmstripToCurrent();
			return;
		}
		const restoreOrigin =
			this.currentIndex !== settle.originIndex ||
			this.stageMediaInvalidatedForScrub ||
			(this.mediaStageEl?.hasClass('is-scrubbing') ?? false);
		if (restoreOrigin && this.media[settle.originIndex]) {
			this.currentIndex = settle.originIndex;
			this.showScrubPreview(settle.originIndex);
			this.clearStagePageSwipeVisuals();
			this.renderCurrent(true, true);
			this.snapFilmstripToCurrent();
			return;
		}
		this.clearStagePageSwipeVisuals();
		this.renderFilmstrip(true);
		this.snapFilmstripToCurrent();
	}

	private cancelStagePageSwipe(): void {
		this.stagePageSwipeGeneration += 1;
		this.cancelStageWheelPageRelease();
		this.cancelStagePageFilmstripMorphFrame();
		this.cancelStagePageFilmstripFrame();
		if (this.stagePageSettleFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.stagePageSettleFrame);
			this.stagePageSettleFrame = null;
		}
		if (this.stagePageSettleTimer !== null) {
			this.contentEl.win.clearTimeout(this.stagePageSettleTimer);
			this.stagePageSettleTimer = null;
		}
		const syncs = new Set<StagePageFilmstripSync>();
		for (const sync of [
			this.stagePageSwipe?.filmstripSync,
			this.stageWheelPageSwipe?.filmstripSync,
			this.stagePageSettle?.filmstripSync,
		]) {
			if (sync) {
				syncs.add(sync);
			}
		}
		for (const sync of syncs) {
			this.finishStagePageFilmstripSettle(sync, this.currentIndex);
		}
		this.stagePageSwipe = null;
		this.stageWheelPageSwipe = null;
		this.stagePageSettle = null;
		this.clearStagePageSwipeVisuals();
	}

	private clearStagePageSwipeVisuals(): void {
		const stage = this.mediaStageEl;
		stage?.removeClass('is-page-swiping');
		stage?.removeClass('is-page-settling');
		stage?.removeClass('is-page-committing');
		stage?.removeClass('is-page-returning');
		stage?.style.removeProperty('--section-gallery-page-offset-x');
		this.stagePagePreviewEl?.remove();
		this.stagePagePreviewEl = null;
	}

	private updateStageWheelPageSwipe(pageOffset: number): void {
		const stage = this.mediaStageEl;
		if (!stage || this.stagePageSettle !== null || this.stageWheelPageReleased || this.media.length < 2) {
			return;
		}
		let swipe = this.stageWheelPageSwipe;
		if (!swipe) {
			this.finalizeFilmstripForStageGesture();
			const originIndex = this.currentIndex;
			const neighborIndex = getStagePageNeighborIndex(
				originIndex,
				this.media.length,
				pageOffset,
			);
			if (neighborIndex === null) {
				return;
			}
			swipe = {
				deltaX: pageOffset,
				filmstripSync: null,
				neighborIndex,
				originIndex,
				viewportWidth: Math.max(
					1,
					stage.getBoundingClientRect().width,
				),
			};
			this.stageWheelPageSwipe = swipe;
			stage.addClass('is-page-swiping');
			this.renderStagePagePreview(neighborIndex, pageOffset);
		}
		const clampedOffset = Math.max(
			-swipe.viewportWidth,
			Math.min(swipe.viewportWidth, pageOffset),
		);
		const neighborIndex = getStagePageNeighborIndex(
			swipe.originIndex,
			this.media.length,
			clampedOffset,
		);
		if (neighborIndex !== null && neighborIndex !== swipe.neighborIndex) {
			swipe.neighborIndex = neighborIndex;
			this.renderStagePagePreview(neighborIndex, clampedOffset);
		}
		swipe.deltaX = clampedOffset;
		this.setStagePageOffset(clampedOffset);
		this.updateStagePageFilmstripSync(swipe, clampedOffset);
		this.scheduleStageWheelPageRelease();
	}

	private shouldCommitStageWheelPageSwipe(
		swipe: StageWheelPageSwipe,
	): boolean {
		// Wheel delta velocity is OS-scaled and not comparable to pointer velocity.
		// Reuse the mobile distance rule, but require real page travel so a short
		// high-resolution trackpad nudge always springs back.
		return shouldCommitStagePageSwipe(
			swipe.deltaX,
			0,
			swipe.viewportWidth,
			STAGE_PAGE_SWIPE_OPTIONS,
		);
	}

	private finishPendingStageWheelPageSwipe(): void {
		const swipe = this.stageWheelPageSwipe;
		if (!swipe) {
			return;
		}
		const commit = this.shouldCommitStageWheelPageSwipe(swipe);
		if (commit) {
			// Raw wheel pixels can cross the page distance in one coalesced event
			// while the capped classifier is still below its intent threshold. Once
			// the page commits, that reducer session must own the delayed momentum
			// tail or the tail can be mistaken for a second page gesture.
			this.stageWheelGesture = claimWheelBurstForCommittedPage(
				this.stageWheelGesture,
				swipe.deltaX,
			);
			if (
				this.stageWheelRawRestartCandidate?.at !==
				this.stageWheelGesture?.restartCandidateAt
			) {
				this.stageWheelRawRestartCandidate = null;
			}
		}
		this.finishStageWheelPageSwipe(commit);
	}

	private finishStageWheelPageSwipe(commit: boolean): void {
		const swipe = this.stageWheelPageSwipe;
		const stage = this.mediaStageEl;
		if (!swipe || !stage || this.stagePageSettle !== null) {
			return;
		}
		this.flushStagePageFilmstripMorph();
		this.cancelStageWheelPageRelease();
		this.stageWheelPageSwipe = null;
		// A release owns this burst even after its visual animation completes.
		// Otherwise sparse momentum can reuse the old accumulated offset to
		// instantiate and commit another page behind a stationary pointer.
		this.stageWheelPageReleased = true;
		const generation = ++this.stagePageSwipeGeneration;
		const targetIndex = commit ? swipe.neighborIndex : swipe.originIndex;
		this.stagePageSettle = {
			commit,
			filmstripSync: swipe.filmstripSync,
			generation,
			originIndex: swipe.originIndex,
			source: 'wheel',
			targetIndex,
		};
		stage.removeClass('is-page-swiping');
		stage.addClass('is-page-settling');
		stage.toggleClass('is-page-committing', commit);
		stage.toggleClass('is-page-returning', !commit);
		const reducedMotion = this.contentEl.win.matchMedia(
			'(prefers-reduced-motion: reduce)',
		).matches;
		const finalOffset = commit
			? Math.sign(swipe.deltaX) * swipe.viewportWidth
			: 0;
		this.stagePageSettleFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.stagePageSettleFrame = null;
			const settle = this.stagePageSettle;
			if (settle?.generation !== generation) {
				return;
			}
			this.startStagePageSettleAnimation(
				settle, reducedMotion, swipe.deltaX, finalOffset,
			);
			if (this.stagePageSettle?.generation !== generation) {
				return;
			}
			this.stagePageSettleTimer = this.contentEl.win.setTimeout(() => {
				this.stagePageSettleTimer = null;
				this.completeStagePageSettle(generation);
			}, STAGE_PAGE_SWIPE_SETTLE_MS + 80);
		});
	}

	private cancelStageWheelPageSwipeImmediately(): void {
		this.cancelStageWheelPageRelease();
		const swipe = this.stageWheelPageSwipe;
		if (!swipe) {
			return;
		}
		this.stageWheelPageSwipe = null;
		this.finishStagePageFilmstripSettle(
			swipe.filmstripSync,
			swipe.originIndex,
		);
		this.clearStagePageSwipeVisuals();
	}

	private isStageMediaGestureActive(): boolean {
		return (
			this.closeRequested ||
			this.modalEl.hasClass('is-viewport-resizing') ||
			this.pinchGesture !== null ||
			this.pointerStart !== null ||
			this.stagePageSwipe !== null ||
			this.stageWheelPageSwipe !== null ||
			this.stagePageSettle !== null
		);
	}

	private readonly handleViewerWheel = (event: WheelEvent): void => {
		const hit = this.contentEl.doc.elementFromPoint(
			event.clientX,
			event.clientY,
		);
		if (!hit || !this.containerEl.contains(hit)) {
			return;
		}
		if (this.modalEl.hasClass('is-viewport-resizing')) {
			event.preventDefault();
			return;
		}
		const overStage = this.mediaStageEl?.contains(hit) ?? false;
		if (event.ctrlKey) {
			if (!overStage) {
				return;
			}
			this.resetStageWheelGesture();
			event.preventDefault();
			if (!this.mediaEl?.instanceOf(HTMLImageElement) || this.infoOpen) {
				return;
			}
			const { y: deltaY } = this.getNormalizedWheelDelta(event);
			const delta = Math.max(-120, Math.min(120, deltaY));
			const nextScale = Math.max(
				1,
				Math.min(
					MAX_IMAGE_ZOOM,
					this.zoomScale * Math.exp(-delta * 0.0025),
				),
			);
			if (Math.abs(nextScale - this.zoomScale) >= 0.001) {
				this.zoomAt(event.clientX, event.clientY, nextScale);
			}
			return;
		}

		const { x: deltaX, y: deltaY } = this.getNormalizedWheelDelta(event);
		const now = event.timeStamp;
		const cappedDelta = capWheelDelta(deltaX, deltaY, 60);
		const stageSample = {
			at: now,
			deltaX: cappedDelta.deltaX,
			deltaY: cappedDelta.deltaY,
			rawMagnitude: Math.max(Math.abs(deltaX), Math.abs(deltaY)),
		};
		let confirmedVisualSeed: { deltaX: number; deltaY: number } | null = null;
		if (this.stageWheelGesture?.consumed) {
			const candidateAt = this.stageWheelGesture.restartCandidateAt;
			const confirmsRestart = confirmsWheelRestartCandidate(
				this.stageWheelGesture,
				stageSample,
				STAGE_WHEEL_OPTIONS,
			);
			if (
				shouldAbsorbConsumedWheelBurst(
					this.stageWheelGesture,
						stageSample,
					STAGE_WHEEL_OPTIONS,
				)
			) {
				// Layout can move underneath a trackpad gesture (notably when the info
				// sheet closes). Keep its decaying momentum tail owned by that gesture.
				const update = updateWheelBurst(
					this.stageWheelGesture,
					stageSample,
					STAGE_WHEEL_OPTIONS,
				);
				this.stageWheelGesture = update.state;
				const createdRestartCandidate =
					update.state.restartCandidateAt === now &&
					update.state.restartCandidateIntent !== null;
				if (createdRestartCandidate) {
					// A quiet same-direction rise may be a new physical gesture. Hold
					// its first raw sample out of the old page until the next sample
					// confirms it; a failed rebound is cleared below without carrying.
					this.stageWheelRawRestartCandidate = {
						at: now,
						deltaX,
						deltaY,
					};
				} else {
					this.stageWheelRawRestartCandidate = null;
					this.stageWheelVisualDeltaX += deltaX;
					this.stageWheelVisualDeltaY += deltaY;
				}
				if (
					!createdRestartCandidate &&
					(update.state.consumedIntent === 'horizontal-negative' ||
						update.state.consumedIntent === 'horizontal-positive') &&
					this.stagePageSettle === null &&
					this.media.length > 1
				) {
					const continuedOffset = getStageWheelPageOffset(
						this.stageWheelVisualDeltaX,
						this.stageWheelVisualDeltaY,
						Math.max(1, this.mediaStageEl?.clientWidth ?? 0),
						STAGE_PAGE_SWIPE_LOCK_PX,
						STAGE_WHEEL_AXIS_DOMINANCE,
					);
					if (continuedOffset !== null) {
						this.updateStageWheelPageSwipe(continuedOffset);
					}
				}
				this.scheduleStageWheelReset();
				event.preventDefault();
				return;
			}
			if (confirmsRestart) {
				confirmedVisualSeed = getWheelVisualRestartSeed(
					{ deltaX, deltaY },
					this.stageWheelRawRestartCandidate,
					candidateAt,
				);
			}
			// A pause or a strong new impulse after decay belongs to a new physical
			// gesture. Route it using the element currently under the pointer.
			this.finishPendingStageWheelPageSwipe();
			if (this.stagePageSettle?.source === 'wheel') {
				this.completeStagePageSettle(this.stagePageSettle.generation);
			}
			this.resetStageWheelGesture();
		}
		const canYieldWheelSettle =
			this.stagePageSettle?.source === 'wheel' &&
			(this.stageWheelGesture === null ||
				(this.stageWheelGesture.consumed === false &&
					now - this.stageWheelGesture.lastAt >=
						STAGE_WHEEL_PAGE_RELEASE_IDLE_MS));
		if (canYieldWheelSettle && this.stagePageSettle) {
			this.completeStagePageSettle(this.stagePageSettle.generation);
			this.resetStageWheelGesture();
		}
		if (this.stagePageSettle !== null) {
			event.preventDefault();
			return;
		}
		const overFilmstrip = Boolean(
			hit.closest('.section-gallery-lightbox-filmstrip-viewport'),
		);
		if (overFilmstrip && this.isStageMediaGestureActive()) {
			event.preventDefault();
			return;
		}
		const nativeFilmstripSessionActive =
			this.filmstripNativeOriginalIndex !== null;
		if (nativeFilmstripSessionActive) {
			// Native horizontal scrolling owns its curved momentum tail even when
			// layout changes what is currently underneath the stationary pointer.
			this.resetStageWheelGesture();
			this.noteNativeFilmstripActivity();
			this.scheduleNativeFilmstripSettle();
			return;
		}
		if (
			overFilmstrip &&
			resolveFilmstripWheelRoute(
				deltaX,
				deltaY,
				event.shiftKey,
				false,
				FILMSTRIP_WHEEL_ROUTE_OPTIONS,
			) === 'filmstrip'
		) {
			this.resetStageWheelGesture();
			this.beginNativeFilmstripScroll();
			// Keep Chromium's native horizontal scrolling and trackpad momentum.
			return;
		}
		if (!overFilmstrip && (hit.closest('button') || hit.closest('video'))) {
			this.resetStageWheelGesture();
			return;
		}

		if (deltaX === 0 && deltaY === 0) {
			return;
		}

		const overInfo = this.infoEl?.contains(hit) ?? false;
		if (overInfo && this.infoOpen && this.infoScrollEl) {
			const maxScrollTop = Math.max(
				0,
				this.infoScrollEl.scrollHeight - this.infoScrollEl.clientHeight,
			);
			const verticalDominant = Math.abs(deltaY) > Math.abs(deltaX);
			const canScrollUp = deltaY < 0 && this.infoScrollEl.scrollTop > 1;
			const canScrollDown =
				deltaY > 0 && this.infoScrollEl.scrollTop < maxScrollTop - 1;
			if (verticalDominant && (canScrollUp || canScrollDown)) {
				this.resetStageWheelGesture();
				return;
			}
			// At the lower edge, keep the native metadata scroll from turning into
			// an unrelated viewer action. A downward finger swipe at the top still
			// reaches the gesture router and closes the sheet.
			if (verticalDominant && deltaY > 0) {
				this.resetStageWheelGesture();
				return;
			}
		}

		event.preventDefault();
		if (this.zoomScale > 1 && this.mediaEl?.instanceOf(HTMLImageElement)) {
			this.resetStageWheelGesture();
			this.panX -= deltaX;
			this.panY -= deltaY;
			this.clampPan();
			this.applyMediaTransform();
			return;
		}

		const previousGesture = this.stageWheelGesture;
		const update = updateWheelBurst(
			this.stageWheelGesture,
			stageSample,
			STAGE_WHEEL_OPTIONS,
		);
		this.stageWheelGesture = update.state;
		if (update.startedNewBurst || previousGesture === null) {
			this.stageWheelPageReleased = false;
			this.stageWheelVisualDeltaX = confirmedVisualSeed?.deltaX ?? deltaX;
			this.stageWheelVisualDeltaY = confirmedVisualSeed?.deltaY ?? deltaY;
		} else {
			this.stageWheelVisualDeltaX += deltaX;
			this.stageWheelVisualDeltaY += deltaY;
		}
		this.scheduleStageWheelReset();
		const pageOffset = getStageWheelPageOffset(
			this.stageWheelVisualDeltaX,
			this.stageWheelVisualDeltaY,
			Math.max(1, this.mediaStageEl?.clientWidth ?? 0),
			STAGE_PAGE_SWIPE_LOCK_PX,
			STAGE_WHEEL_AXIS_DOMINANCE,
		);
		if (pageOffset !== null && this.media.length > 1) {
			this.updateStageWheelPageSwipe(pageOffset);
		} else if (
			this.stageWheelPageSwipe &&
			Math.abs(this.stageWheelVisualDeltaY) >
				Math.abs(this.stageWheelVisualDeltaX) * STAGE_WHEEL_AXIS_DOMINANCE
		) {
			this.cancelStageWheelPageSwipeImmediately();
		}
		if (!update.intent) {
			return;
		}
		const action = resolveStageWheelIntent(
			update.intent,
			this.infoOpen,
			this.media.length > 1,
		);
		switch (action) {
			case 'move-next':
				if (!this.stageWheelPageSwipe) {
					this.updateStageWheelPageSwipe(
						-STAGE_WHEEL_SWIPE_THRESHOLD_PX,
					);
				}
				break;
			case 'move-previous':
				if (!this.stageWheelPageSwipe) {
					this.updateStageWheelPageSwipe(
						STAGE_WHEEL_SWIPE_THRESHOLD_PX,
					);
				}
				break;
			case 'show-info':
				this.cancelStageWheelPageSwipeImmediately();
				this.setInfoOpen(true);
				break;
			case 'hide-info':
				this.cancelStageWheelPageSwipeImmediately();
				this.setInfoOpen(false);
				break;
			case 'close-viewer':
				this.cancelStageWheelPageSwipeImmediately();
				this.close();
				break;
		}
	};

	private getNormalizedWheelDelta(event: WheelEvent): PointerPosition {
		const modeMultiplier =
			event.deltaMode === WheelEvent.DOM_DELTA_LINE
				? 16
				: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? this.contentEl.win.innerHeight
					: 1;
		return {
			x: event.deltaX * modeMultiplier,
			y: event.deltaY * modeMultiplier,
		};
	}

	private scheduleStageWheelReset(): void {
		if (this.stageWheelResetTimer !== null) {
			this.contentEl.win.clearTimeout(this.stageWheelResetTimer);
		}
		this.stageWheelResetTimer = this.contentEl.win.setTimeout(() => {
			this.stageWheelResetTimer = null;
			this.stageWheelGesture = null;
			this.stageWheelRawRestartCandidate = null;
			this.stageWheelPageReleased = false;
			this.stageWheelVisualDeltaX = 0;
			this.stageWheelVisualDeltaY = 0;
		}, STAGE_WHEEL_GESTURE_IDLE_MS);
	}

	private scheduleStageWheelPageRelease(): void {
		this.cancelStageWheelPageRelease();
		this.stageWheelPageReleaseTimer = this.contentEl.win.setTimeout(() => {
			this.stageWheelPageReleaseTimer = null;
			this.finishPendingStageWheelPageSwipe();
		}, STAGE_WHEEL_PAGE_RELEASE_IDLE_MS);
	}

	private cancelStageWheelPageRelease(): void {
		if (this.stageWheelPageReleaseTimer !== null) {
			this.contentEl.win.clearTimeout(this.stageWheelPageReleaseTimer);
			this.stageWheelPageReleaseTimer = null;
		}
	}

	private resetStageWheelGesture(): void {
		if (this.stageWheelResetTimer !== null) {
			this.contentEl.win.clearTimeout(this.stageWheelResetTimer);
			this.stageWheelResetTimer = null;
		}
		this.cancelStageWheelPageRelease();
		this.stageWheelGesture = null;
		this.stageWheelRawRestartCandidate = null;
		this.stageWheelPageReleased = false;
		this.stageWheelVisualDeltaX = 0;
		this.stageWheelVisualDeltaY = 0;
		this.cancelStageWheelPageSwipeImmediately();
	}

	private zoomAt(clientX: number, clientY: number, nextScale: number): void {
		if (!this.mediaEl?.instanceOf(HTMLImageElement)) {
			return;
		}
		const mediaRect = this.mediaEl.getBoundingClientRect();
		const transformedCenterX = mediaRect.left + mediaRect.width / 2;
		const transformedCenterY = mediaRect.top + mediaRect.height / 2;
		const baseCenterX = transformedCenterX - this.panX;
		const baseCenterY = transformedCenterY - this.panY;
		const anchorX = (clientX - transformedCenterX) / this.zoomScale;
		const anchorY = (clientY - transformedCenterY) / this.zoomScale;
		this.zoomScale = nextScale;
		this.panX = clientX - baseCenterX - this.zoomScale * anchorX;
		this.panY = clientY - baseCenterY - this.zoomScale * anchorY;
		this.clampPan();
		this.applyMediaTransform();
	}

	private handleMediaTap(
		pointerType: string,
		startedOnImage: boolean,
		clientX: number,
		clientY: number,
		timeStamp: number,
	): void {
		if (this.infoOpen) {
			this.lastMouseTap = null;
			this.setInfoOpen(false);
			return;
		}
		this.setControlsVisible(!this.controlsVisible);
		if (
			pointerType !== 'mouse' ||
			!startedOnImage ||
			!this.mediaEl?.instanceOf(HTMLImageElement)
		) {
			this.lastMouseTap = null;
			return;
		}

		const previous = this.lastMouseTap;
		const elapsed = previous ? timeStamp - previous.at : Number.POSITIVE_INFINITY;
		const distance = previous
			? Math.hypot(clientX - previous.x, clientY - previous.y)
			: Number.POSITIVE_INFINITY;
		if (
			previous &&
			elapsed >= 0 &&
			elapsed <= DESKTOP_DOUBLE_CLICK_MS &&
			distance <= DESKTOP_DOUBLE_CLICK_DISTANCE_PX
		) {
			this.lastMouseTap = null;
			if (this.zoomScale > 1) {
				this.resetMediaTransform();
			} else {
				this.zoomAt(clientX, clientY, 2.5);
			}
			return;
		}
		this.lastMouseTap = { at: timeStamp, x: clientX, y: clientY };
	}

	private isCurrentMediaImage(): boolean {
		return this.mediaEl?.instanceOf(HTMLImageElement) ?? false;
	}

	private startPinchGesture(): void {
		if (!this.mediaEl?.instanceOf(HTMLImageElement)) {
			return;
		}
		const points = [...this.activePointers.values()].slice(0, 2);
		const first = points[0];
		const second = points[1];
		if (!first || !second) {
			return;
		}
		const startDistance = Math.hypot(second.x - first.x, second.y - first.y);
		if (startDistance < 1) {
			return;
		}
		const midpointX = (first.x + second.x) / 2;
		const midpointY = (first.y + second.y) / 2;
		const mediaRect = this.mediaEl.getBoundingClientRect();
		const transformedCenterX = mediaRect.left + mediaRect.width / 2;
		const transformedCenterY = mediaRect.top + mediaRect.height / 2;
		const baseCenterX = transformedCenterX - this.panX;
		const baseCenterY = transformedCenterY - this.panY;
		this.pinchGesture = {
			anchorX: (midpointX - transformedCenterX) / this.zoomScale,
			anchorY: (midpointY - transformedCenterY) / this.zoomScale,
			baseCenterX,
			baseCenterY,
			startDistance,
			startScale: this.zoomScale,
		};
	}

	private updatePinchGesture(): void {
		const gesture = this.pinchGesture;
		if (!gesture) {
			return;
		}
		const points = [...this.activePointers.values()].slice(0, 2);
		const first = points[0];
		const second = points[1];
		if (!first || !second) {
			return;
		}
		const distance = Math.hypot(second.x - first.x, second.y - first.y);
		const midpointX = (first.x + second.x) / 2;
		const midpointY = (first.y + second.y) / 2;
		this.zoomScale = Math.min(
			MAX_IMAGE_ZOOM,
			Math.max(1, gesture.startScale * (distance / gesture.startDistance)),
		);
		this.panX =
			midpointX - gesture.baseCenterX - this.zoomScale * gesture.anchorX;
		this.panY =
			midpointY - gesture.baseCenterY - this.zoomScale * gesture.anchorY;
		this.clampPan();
		this.applyMediaTransform();
	}

	private clampPan(): void {
		if (!this.mediaEl?.instanceOf(HTMLImageElement) || !this.mediaStageEl) {
			this.panX = 0;
			this.panY = 0;
			return;
		}
		if (this.zoomScale <= 1) {
			this.zoomScale = 1;
			this.panX = 0;
			this.panY = 0;
			return;
		}
		const maxX = Math.max(
			0,
			(this.mediaEl.offsetWidth * this.zoomScale - this.mediaStageEl.clientWidth) /
				2,
		);
		const maxY = Math.max(
			0,
			(this.mediaEl.offsetHeight * this.zoomScale -
				this.mediaStageEl.clientHeight) /
				2,
		);
		this.panX = Math.max(-maxX, Math.min(maxX, this.panX));
		this.panY = Math.max(-maxY, Math.min(maxY, this.panY));
	}

	private applyMediaTransform(): void {
		if (!this.mediaEl?.instanceOf(HTMLImageElement)) {
			return;
		}
		this.mediaEl.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoomScale})`;
		this.modalEl.toggleClass('is-media-zoomed', this.zoomScale > 1);
	}

	private resetMediaTransform(): void {
		this.cancelStagePageSwipe();
		this.zoomScale = 1;
		this.panX = 0;
		this.panY = 0;
		this.activePointers.clear();
		this.pointerStart = null;
		this.pinchGesture = null;
		if (this.mediaEl?.instanceOf(HTMLImageElement)) {
			this.mediaEl.style.removeProperty('transform');
		}
		this.modalEl.removeClass('is-media-zoomed');
	}

	private releasePointerCapture(
		element: HTMLElement | null,
		pointerId: number,
	): void {
		if (element?.hasPointerCapture(pointerId)) {
			element.releasePointerCapture(pointerId);
		}
	}

	private readonly handleFilmstripPointerDown = (
		event: PointerEvent,
	): void => {
		if (this.isStageMediaGestureActive()) {
			event.preventDefault();
			return;
		}
		if (
			this.media.length < 2 ||
			!this.filmstripViewportEl ||
			!this.filmstripScrollerEl ||
			(event.pointerType === 'mouse' && event.button !== 0)
		) {
			return;
		}
		this.cancelFilmstripMouseFrame();
		this.cancelFilmstripSnap();
		this.cancelFilmstripSelectionCompensation();
		this.updateFilmstripGeometry();
		let originalIndex = this.currentIndex;
		let interruptedInertia = false;
		const nativeScroll = event.pointerType !== 'mouse';
		if (this.filmstripInertiaFrame !== null) {
			originalIndex =
				this.filmstripInertiaOriginalIndex ?? this.currentIndex;
			interruptedInertia = true;
			this.cancelFilmstripInertia();
			this.flushPendingScrub();
			this.suppressFilmstripClick = false;
		}
		if (!nativeScroll && this.filmstripNativeOriginalIndex !== null) {
			originalIndex = this.filmstripNativeOriginalIndex;
			interruptedInertia = true;
			this.cancelNativeFilmstripSettle();
			this.filmstripNativeOriginalIndex = null;
			this.filmstripNativeScrolling = false;
			this.filmstripNativeLastActivityAt = null;
			this.filmstripNativePointerReleasedAt = null;
			this.flushPendingScrub();
		} else if (nativeScroll) {
			if (this.filmstripNativeOriginalIndex !== null) {
				originalIndex = this.filmstripNativeOriginalIndex;
				interruptedInertia = true;
			} else {
				this.filmstripNativeOriginalIndex = originalIndex;
				this.filmstripNativeScrolling = false;
			}
			this.cancelNativeFilmstripSettle();
			this.filmstripNativeLastActivityAt =
				this.contentEl.win.performance.now();
			this.filmstripNativePointerReleasedAt = null;
		}
		this.filmstripScrub = {
			active: false,
			interruptedInertia,
			lastTime: event.timeStamp,
			originalIndex,
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			startScrollLeft: this.filmstripScrollerEl.scrollLeft,
			startX: event.clientX,
			velocity: 0,
		};
	};

	private readonly handleFilmstripPointerMove = (
		event: PointerEvent,
	): void => {
		if (this.modalEl.hasClass('is-viewport-resizing')) {
			event.preventDefault();
			return;
		}
		const scrub = this.filmstripScrub;
		const viewport = this.filmstripViewportEl;
		const scroller = this.filmstripScrollerEl;
		if (
			!scrub ||
			scrub.pointerId !== event.pointerId ||
			!viewport ||
			!scroller
		) {
			return;
		}
		const deltaX = event.clientX - scrub.startX;
		const nativeScroll = scrub.pointerType !== 'mouse';
		if (!scrub.active) {
			if (Math.abs(deltaX) < TAP_TOLERANCE_PX) {
				return;
			}
			scrub.active = true;
			this.resetShareState();
			this.suppressFilmstripClick = true;
			if (!nativeScroll) {
				viewport.setPointerCapture(event.pointerId);
			}
		}
		if (nativeScroll) {
			this.noteNativeFilmstripActivity();
			this.scheduleNativeFilmstripSettle();
			return;
		}
		this.queueFilmstripMouseMove(event);
		event.preventDefault();
	};

	private queueFilmstripMouseMove(event: PointerEvent): void {
		this.filmstripMousePending = {
			clientX: event.clientX,
			pointerId: event.pointerId,
			timeStamp: event.timeStamp,
		};
		if (this.filmstripMouseFrame !== null) {
			return;
		}
		this.filmstripMouseFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.filmstripMouseFrame = null;
			this.flushFilmstripMouseMove();
		});
	}

	private flushFilmstripMouseMove(): void {
		if (this.filmstripMouseFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripMouseFrame);
			this.filmstripMouseFrame = null;
		}
		const pending = this.filmstripMousePending;
		this.filmstripMousePending = null;
		const scrub = this.filmstripScrub;
		const scroller = this.filmstripScrollerEl;
		if (
			!pending ||
			!scrub?.active ||
			scrub.pointerType !== 'mouse' ||
			scrub.pointerId !== pending.pointerId ||
			!scroller
		) {
			return;
		}
		const previousScrollLeft = scroller.scrollLeft;
		scroller.scrollLeft =
			scrub.startScrollLeft - (pending.clientX - scrub.startX);
		const elapsed = pending.timeStamp - scrub.lastTime;
		if (elapsed > 0) {
			const instantaneousVelocity =
				(scroller.scrollLeft - previousScrollLeft) / elapsed;
			scrub.velocity =
				scrub.velocity * 0.25 + instantaneousVelocity * 0.75;
		}
		scrub.lastTime = pending.timeStamp;
		const index = this.getCenteredFilmstripIndex();
		if (index !== null) {
			this.previewScrubIndex(index);
		}
	}

	private cancelFilmstripMouseFrame(): void {
		if (this.filmstripMouseFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripMouseFrame);
			this.filmstripMouseFrame = null;
		}
		this.filmstripMousePending = null;
	}

	private flushFilmstripMouseEvent(event: PointerEvent): void {
		const scrub = this.filmstripScrub;
		const scroller = this.filmstripScrollerEl;
		if (
			!scrub?.active ||
			scrub.pointerType !== 'mouse' ||
			scrub.pointerId !== event.pointerId ||
			!scroller
		) {
			this.cancelFilmstripMouseFrame();
			return;
		}
		const finalScrollLeft =
			scrub.startScrollLeft - (event.clientX - scrub.startX);
		if (
			this.filmstripMousePending !== null ||
			Math.abs(finalScrollLeft - scroller.scrollLeft) > 0.01
		) {
			this.filmstripMousePending = {
				clientX: event.clientX,
				pointerId: event.pointerId,
				timeStamp: event.timeStamp,
			};
			this.flushFilmstripMouseMove();
		}
	}

	private readonly handleFilmstripPointerEnd = (
		event: PointerEvent,
	): void => {
		const scrub = this.filmstripScrub;
		if (!scrub || scrub.pointerId !== event.pointerId) {
			return;
		}
		if (this.modalEl.hasClass('is-viewport-resizing')) {
			this.cancelFilmstripMouseFrame();
			this.releasePointerCapture(this.filmstripViewportEl, event.pointerId);
			this.filmstripScrub = null;
			this.suppressFilmstripClick = false;
			return;
		}
		this.flushFilmstripMouseEvent(event);
		this.releasePointerCapture(this.filmstripViewportEl, event.pointerId);
		this.filmstripScrub = null;
		if (scrub.pointerType !== 'mouse') {
			if (!scrub.active && !this.filmstripNativeScrolling) {
				this.cancelNativeFilmstripSettle();
				this.filmstripNativeOriginalIndex = null;
				this.filmstripNativeLastActivityAt = null;
				this.filmstripNativePointerReleasedAt = null;
				this.snapFilmstripToCurrent();
				return;
			}
			this.suppressFilmstripClick = true;
			this.filmstripNativePointerReleasedAt =
				this.contentEl.win.performance.now();
			this.scheduleNativeFilmstripSettle();
			return;
		}
		if (!scrub.active) {
			if (scrub.interruptedInertia) {
				const indexAtPointerEnd = this.currentIndex;
				this.contentEl.win.requestAnimationFrame(() => {
					if (
						this.filmstripScrub === null &&
						this.filmstripInertiaFrame === null &&
						this.currentIndex === indexAtPointerEnd &&
						this.mediaStageEl?.hasClass('is-scrubbing')
					) {
						this.flushPendingScrub();
						this.finishFilmstripScrub(scrub.originalIndex);
					}
				});
			} else {
				this.snapFilmstripToCurrent();
			}
			return;
		}
		event.preventDefault();
		this.suppressFilmstripClick = true;
		const idleTime = Math.max(0, event.timeStamp - scrub.lastTime);
		const decayedVelocity =
			scrub.velocity *
			Math.exp(-FILMSTRIP_INERTIA_FRICTION * idleTime * 2);
		const releaseVelocity = Math.max(
			-FILMSTRIP_INERTIA_MAX_VELOCITY,
			Math.min(FILMSTRIP_INERTIA_MAX_VELOCITY, decayedVelocity),
		);
		if (
			!this.contentEl.win.matchMedia('(prefers-reduced-motion: reduce)').matches &&
			Math.abs(releaseVelocity) >= FILMSTRIP_INERTIA_START_VELOCITY
		) {
			this.startFilmstripInertia(scrub.originalIndex, releaseVelocity);
			return;
		}
		this.flushPendingScrub();
		this.finishFilmstripScrub(scrub.originalIndex);
		this.releaseFilmstripClickSuppression();
	};

	private readonly handleFilmstripPointerCancel = (
		event: PointerEvent,
	): void => {
		if (this.filmstripScrub?.pointerId !== event.pointerId) {
			return;
		}
		if (this.modalEl.hasClass('is-viewport-resizing')) {
			this.cancelFilmstripMouseFrame();
			this.releasePointerCapture(this.filmstripViewportEl, event.pointerId);
			this.filmstripScrub = null;
			this.suppressFilmstripClick = false;
			return;
		}
		this.flushFilmstripMouseEvent(event);
		this.releasePointerCapture(this.filmstripViewportEl, event.pointerId);
		const scrub = this.filmstripScrub;
		this.filmstripScrub = null;
		if (scrub.pointerType !== 'mouse') {
			this.suppressFilmstripClick =
				scrub.active || this.filmstripNativeScrolling;
			// Chromium cancels the pointer when native pan-x takes over, while
			// the finger may still be held on screen. Touch events own release.
			if (this.filmstripTouchIds.size === 0) {
				this.filmstripNativePointerReleasedAt =
					this.contentEl.win.performance.now();
			}
			this.scheduleNativeFilmstripSettle();
			return;
		}
		this.flushPendingScrub();
		this.finishFilmstripScrub(scrub.originalIndex);
	};

	private readonly handleFilmstripTouchStart = (event: TouchEvent): void => {
		if (this.closeRequested || this.isStageMediaGestureActive()) {
			return;
		}
		for (let index = 0; index < event.changedTouches.length; index += 1) {
			const touch = event.changedTouches.item(index);
			if (touch) this.filmstripTouchIds.add(touch.identifier);
		}
		this.filmstripNativePointerReleasedAt = null;
		this.cancelNativeFilmstripSettle();
	};

	private readonly handleFilmstripTouchEnd = (event: TouchEvent): void => {
		for (let index = 0; index < event.changedTouches.length; index += 1) {
			const touch = event.changedTouches.item(index);
			if (touch) this.filmstripTouchIds.delete(touch.identifier);
		}
		if (this.filmstripTouchIds.size === 0 && this.filmstripNativeOriginalIndex !== null) {
			this.filmstripNativePointerReleasedAt = this.contentEl.win.performance.now();
			this.scheduleNativeFilmstripSettle();
		}
	};

	private readonly handleFilmstripScroll = (): void => {
		if (this.isStageMediaGestureActive()) {
			return;
		}
		if (this.filmstripNativeOriginalIndex === null) {
			return;
		}
		if (!this.filmstripNativeScrolling) {
			this.filmstripNativeScrolling = true;
			this.resetShareState();
		}
		this.noteNativeFilmstripActivity();
		this.suppressFilmstripClick = true;
		const index = this.getCenteredFilmstripIndex();
		if (index !== null) {
			this.queueScrubIndex(index);
		}
		this.scheduleNativeFilmstripSettle();
	};

	private beginNativeFilmstripScroll(): void {
		if (
			this.isStageMediaGestureActive() ||
			this.media.length < 2 ||
			!this.filmstripScrollerEl ||
			this.filmstripScrub?.pointerType === 'mouse'
		) {
			return;
		}
		this.cancelFilmstripSnap();
		if (this.filmstripNativeOriginalIndex === null) {
			let originalIndex = this.currentIndex;
			let interruptedInertia = false;
			if (this.filmstripInertiaFrame !== null) {
				originalIndex =
					this.filmstripInertiaOriginalIndex ?? this.currentIndex;
				interruptedInertia = true;
				this.cancelFilmstripInertia();
				this.flushPendingScrub();
			}
			this.filmstripNativeOriginalIndex = originalIndex;
			this.filmstripNativeScrolling = interruptedInertia;
		}
		this.noteNativeFilmstripActivity();
		// A wheel burst at an edge may not emit scroll, so it also needs a
		// fallback that clears the native-session marker.
		this.scheduleNativeFilmstripSettle();
	}

	private readonly handleFilmstripScrollEnd = (): void => {
		if (this.filmstripNativeOriginalIndex === null) {
			return;
		}
		// WebKit can dispatch scrollend at pointer release before it starts the
		// momentum phase. Keep the session alive until both release grace and a
		// genuine scroll quiet period have elapsed.
		this.scheduleNativeFilmstripSettle();
	};

	private scheduleNativeFilmstripSettle(): void {
		this.cancelNativeFilmstripSettle();
		if (this.hasActiveFilmstripContact()) {
			// End/cancel will schedule settling; do not poll while a finger rests.
			return;
		}
		const now = this.contentEl.win.performance.now();
		if (this.filmstripNativeLastActivityAt === null) {
			this.filmstripNativeLastActivityAt = now;
		}
		const delay = getNativeScrollSettleDelay(
			now,
			this.filmstripNativeLastActivityAt,
			this.filmstripNativePointerReleasedAt,
			false,
			FILMSTRIP_NATIVE_SETTLE_OPTIONS,
		);
		this.filmstripNativeSettleTimer = this.contentEl.win.setTimeout(() => {
			this.filmstripNativeSettleTimer = null;
			this.completeNativeFilmstripScroll();
		}, Math.max(1, delay));
	}

	private noteNativeFilmstripActivity(): void {
		this.filmstripNativeLastActivityAt =
			this.contentEl.win.performance.now();
	}

	private completeNativeFilmstripScroll(): void {
		if (this.closeRequested || this.hasActiveFilmstripContact()) {
			return;
		}
		const now = this.contentEl.win.performance.now();
		if (this.filmstripNativeLastActivityAt !== null) {
			const remaining = getNativeScrollSettleDelay(
				now,
				this.filmstripNativeLastActivityAt,
				this.filmstripNativePointerReleasedAt,
				false,
				FILMSTRIP_NATIVE_SETTLE_OPTIONS,
			);
			if (remaining > 1) {
				this.scheduleNativeFilmstripSettle();
				return;
			}
		}
		this.cancelNativeFilmstripSettle();
		const originalIndex = this.filmstripNativeOriginalIndex;
		const didScroll = this.filmstripNativeScrolling;
		this.filmstripNativeOriginalIndex = null;
		this.filmstripNativeScrolling = false;
		this.filmstripNativeLastActivityAt = null;
		this.filmstripNativePointerReleasedAt = null;
		if (originalIndex === null) {
			this.releaseFilmstripClickSuppression();
			return;
		}
		if (!didScroll) {
			this.snapFilmstripToCurrent();
			this.releaseFilmstripClickSuppression();
			return;
		}
		const index = this.getCenteredFilmstripIndex();
		if (index !== null) {
			this.queueScrubIndex(index);
		}
		this.flushPendingScrub();
		this.finishFilmstripScrub(originalIndex);
		this.releaseFilmstripClickSuppression();
	}

	private hasActiveFilmstripContact(): boolean {
		return this.filmstripTouchIds.size > 0 ||
			(this.filmstripScrub !== null && this.filmstripScrub.pointerType !== 'mouse');
	}

	private cancelNativeFilmstripSettle(): void {
		if (this.filmstripNativeSettleTimer !== null) {
			this.contentEl.win.clearTimeout(this.filmstripNativeSettleTimer);
			this.filmstripNativeSettleTimer = null;
		}
	}

	private startFilmstripInertia(
		originalIndex: number,
		initialVelocity: number,
	): void {
		this.cancelFilmstripInertia();
		this.filmstripInertiaOriginalIndex = originalIndex;
		let velocity = initialVelocity;
		let lastAt = this.contentEl.win.performance.now();

		const step = (now: number): void => {
			const scroller = this.filmstripScrollerEl;
			if (!scroller) {
				this.completeFilmstripInertia();
				return;
			}
			const elapsed = Math.min(40, Math.max(0, now - lastAt));
			lastAt = now;
			const previousScrollLeft = scroller.scrollLeft;
			scroller.scrollLeft += velocity * elapsed;
			const moved = Math.abs(scroller.scrollLeft - previousScrollLeft) > 0.01;
			const index = this.getCenteredFilmstripIndex();
			if (index !== null) {
				this.previewScrubIndex(index);
			}
			velocity *= Math.exp(-FILMSTRIP_INERTIA_FRICTION * elapsed);
			if (!moved || Math.abs(velocity) < FILMSTRIP_INERTIA_MIN_VELOCITY) {
				this.completeFilmstripInertia();
				return;
			}
			this.filmstripInertiaFrame =
				this.contentEl.win.requestAnimationFrame(step);
		};

		this.filmstripInertiaFrame =
			this.contentEl.win.requestAnimationFrame(step);
	}

	private completeFilmstripInertia(): void {
		const originalIndex =
			this.filmstripInertiaOriginalIndex ?? this.currentIndex;
		this.filmstripInertiaFrame = null;
		this.filmstripInertiaOriginalIndex = null;
		this.flushPendingScrub();
		this.finishFilmstripScrub(originalIndex);
		this.releaseFilmstripClickSuppression();
	}

	private cancelFilmstripInertia(): void {
		if (this.filmstripInertiaFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripInertiaFrame);
		}
		this.filmstripInertiaFrame = null;
		this.filmstripInertiaOriginalIndex = null;
	}

	private releaseFilmstripClickSuppression(): void {
		this.contentEl.win.requestAnimationFrame(() => {
			this.suppressFilmstripClick = false;
		});
	}

	private readonly handleFilmstripClick = (event: MouseEvent): void => {
		if (
			this.isStageMediaGestureActive() ||
			this.suppressFilmstripClick ||
			!this.filmstripEl
		) {
			return;
		}
		const target = event.targetNode;
		const button = target?.instanceOf(Element)
			? target.closest<HTMLElement>('.section-gallery-filmstrip-item')
			: null;
		if (!button || !this.filmstripEl.contains(button)) {
			return;
		}
		const index = Number(button.dataset.mediaIndex);
		if (!Number.isInteger(index) || !this.media[index]) {
			return;
		}
		this.cancelFilmstripSnap();
		if (index === this.currentIndex) {
			this.snapFilmstripToCurrent();
			return;
		}
		this.currentIndex = index;
		this.renderCurrent();
	};

	private getCenteredFilmstripIndex(): number | null {
		const viewport = this.filmstripViewportEl;
		const scroller = this.filmstripScrollerEl;
		if (!viewport || !scroller || !this.filmstripEl) {
			return null;
		}
		if (this.filmstripCenters.length === 0) {
			this.updateFilmstripGeometry();
		}
		const centers = this.filmstripCenters;
		if (centers.length === 0) {
			return null;
		}
		const target = scroller.scrollLeft + viewport.clientWidth / 2;
		let low = 0;
		let high = centers.length - 1;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			const entry = centers[middle];
			if (!entry || entry.center < target) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		const after = centers[low];
		const before = low > 0 ? centers[low - 1] : null;
		if (!after) {
			return before?.index ?? null;
		}
		if (!before) {
			return after.index;
		}
		return target - before.center <= after.center - target
			? before.index
			: after.index;
	}

	private queueScrubIndex(index: number): void {
		if (this.isStageMediaGestureActive()) {
			return;
		}
		this.filmstripScrubPendingIndex = index;
		if (this.filmstripScrubFrame !== null) {
			return;
		}
		this.filmstripScrubFrame = this.contentEl.win.requestAnimationFrame(() => {
			this.filmstripScrubFrame = null;
			this.flushPendingScrub();
		});
	}

	private flushPendingScrub(): void {
		if (this.filmstripScrubFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripScrubFrame);
			this.filmstripScrubFrame = null;
		}
		const index = this.filmstripScrubPendingIndex;
		this.filmstripScrubPendingIndex = null;
		if (index === null) {
			return;
		}
		this.previewScrubIndex(index);
	}

	private cancelFilmstripScrubFrame(): void {
		if (this.filmstripScrubFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripScrubFrame);
			this.filmstripScrubFrame = null;
		}
		this.filmstripScrubPendingIndex = null;
	}

	private previewScrubIndex(index: number): void {
		if (
			this.isStageMediaGestureActive() ||
			index === this.currentIndex ||
			!this.media[index]
		) {
			return;
		}
		this.invalidateStageMediaForScrub();
		this.currentIndex = index;
		this.updateCurrentText(false);
		this.showScrubPreview(index);
		// Changing `.is-current` changes slot widths. Compensating scrollLeft on
		// every selection frame cancels WebKit's native momentum, so defer that
		// visual geometry mutation until the native session has genuinely settled.
		if (this.filmstripNativeOriginalIndex === null) {
			this.markFilmstripSelection();
		}
	}

	private finishFilmstripScrub(originalIndex: number): void {
		if (this.closeRequested) {
			return;
		}
		if (this.currentIndex === originalIndex) {
			if (this.stageMediaInvalidatedForScrub) {
				this.renderCurrent(true, true);
			} else {
				this.clearScrubPreview();
				this.updateCurrentText();
				this.renderFilmstrip(true);
				this.resetShareState();
			}
		} else {
			this.renderCurrent(true, true);
		}
		this.snapFilmstripToCurrent();
	}

	private snapFilmstripToCurrent(): void {
		if (this.filmstripSelectionAnchorIndex !== null) {
			this.filmstripSnapAfterSelection = true;
			return;
		}
		const viewport = this.filmstripViewportEl;
		const scroller = this.filmstripScrollerEl;
		const button = this.filmstripButtons[this.currentIndex];
		if (!viewport || !scroller || !button) {
			return;
		}
		this.cancelFilmstripSnap();
		const viewportRect = viewport.getBoundingClientRect();
		const buttonRect = button.getBoundingClientRect();
		const offset =
			buttonRect.left +
			buttonRect.width / 2 -
			(viewportRect.left + viewportRect.width / 2);
		const startScrollLeft = scroller.scrollLeft;
		const targetScrollLeft = Math.max(
			0,
			Math.min(
				scroller.scrollWidth - scroller.clientWidth,
				startScrollLeft + offset,
			),
		);
		const reducedMotion = this.contentEl.win.matchMedia(
			'(prefers-reduced-motion: reduce)',
		).matches;
		if (reducedMotion || Math.abs(targetScrollLeft - startScrollLeft) < 0.5) {
			scroller.scrollLeft = targetScrollLeft;
			return;
		}

		const startedAt = this.contentEl.win.performance.now();
		const step = (now: number): void => {
			if (!scroller.isConnected || !viewport.isConnected) {
				this.filmstripSnapFrame = null;
				return;
			}
			const progress = Math.min(
				1,
				Math.max(0, (now - startedAt) / FILMSTRIP_SNAP_DURATION_MS),
			);
			const eased = Math.sin((progress * Math.PI) / 2);
			scroller.scrollLeft =
				startScrollLeft + (targetScrollLeft - startScrollLeft) * eased;
			if (progress < 1) {
				this.filmstripSnapFrame =
					this.contentEl.win.requestAnimationFrame(step);
				return;
			}
			this.filmstripSnapFrame = null;
			scroller.scrollLeft = targetScrollLeft;
		};
		this.filmstripSnapFrame = this.contentEl.win.requestAnimationFrame(step);
	}

	private cancelFilmstripSnap(): void {
		if (this.filmstripSnapFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripSnapFrame);
			this.filmstripSnapFrame = null;
		}
	}

	private showScrubPreview(index: number): void {
		if (!this.filmstripEl || !this.mediaStageEl) {
			return;
		}
		const item = this.media[index];
		if (!item) {
			return;
		}
		if (
			!this.mediaStageEl.hasClass('is-scrubbing') &&
			this.mediaEl?.instanceOf(HTMLVideoElement)
		) {
			this.mediaEl.pause();
		}
		this.mediaStageEl.addClass('is-scrubbing');
		const button = this.filmstripButtons[index];
		const thumbnail = button?.querySelector<HTMLImageElement>(
			'img.section-gallery-filmstrip-thumbnail',
		);
		const source = thumbnail?.currentSrc || thumbnail?.src || '';
		const canReuseThumbnail = source.startsWith('blob:') || source.startsWith('data:');

		if (canReuseThumbnail) {
			if (!this.scrubPreviewEl) {
				this.scrubPreviewEl = this.mediaStageEl.createEl('img', {
					cls: 'section-gallery-lightbox-scrub-preview',
					attr: { decoding: 'async', draggable: 'false' },
				});
			}
			this.scrubPreviewEl.alt = item.file.basename;
			this.sizeThumbnailPreview(this.scrubPreviewEl, item, thumbnail);
			if (this.scrubPreviewEl.src !== source) {
				this.scrubPreviewEl.src = source;
			}
			this.scrubPreviewEl.removeClass('is-hidden');
			this.scrubPlaceholderEl?.addClass('is-hidden');
			return;
		}

		this.scrubPreviewEl?.addClass('is-hidden');
		if (!this.scrubPlaceholderEl) {
			this.scrubPlaceholderEl = this.mediaStageEl.createDiv({
				cls: 'section-gallery-lightbox-scrub-placeholder',
			});
		}
		this.scrubPlaceholderEl.empty();
		const icon = this.scrubPlaceholderEl.createDiv({
			cls: 'section-gallery-lightbox-scrub-placeholder-icon',
		});
		setIcon(icon, item.kind === 'video' ? 'play' : 'image');
		this.scrubPlaceholderEl.createDiv({
			cls: 'section-gallery-lightbox-scrub-placeholder-name',
			text: item.file.name,
		});
		this.scrubPlaceholderEl.removeClass('is-hidden');
	}

	private clearScrubPreview(): void {
		this.mediaStageEl?.removeClass('is-scrubbing');
		if (this.scrubPreviewEl) {
			this.scrubPreviewEl.onload = null;
		}
		this.scrubPreviewEl?.remove();
		this.scrubPlaceholderEl?.remove();
		this.scrubPreviewEl = null;
		this.scrubPlaceholderEl = null;
	}

	private setInfoOpen(open: boolean): void {
		if (this.closeRequested || this.infoOpen === open) {
			return;
		}
		this.resetMediaTransform();
		// Freeze any native/custom carousel motion before its viewport starts
		// moving. Otherwise a momentum update and the layout transition both write
		// scrollLeft, producing an intermediate recenter followed by another jump.
		this.finalizeFilmstripForStageGesture();
		this.infoOpen = open;
		if (open && !this.controlsVisible) {
			this.setControlsVisible(true);
		}
		this.modalEl.toggleClass('is-info-open', open);
		this.infoButtonEl?.setAttr('aria-expanded', open ? 'true' : 'false');
		this.infoButtonEl?.setAttr('aria-pressed', open ? 'true' : 'false');
		this.infoButtonEl?.toggleClass('is-active', open);
		this.infoButtonEl?.setAttr(
			'aria-label',
			open ? 'Hide media information' : 'Show media information',
		);
		this.infoEl?.setAttr('aria-hidden', open ? 'false' : 'true');
		this.scheduleFilmstripLayoutRefresh();
	}

	private setControlsVisible(visible: boolean): void {
		this.controlsVisible = visible;
		this.modalEl.toggleClass('is-ui-hidden', !visible);
		for (const element of this.contentEl.querySelectorAll<HTMLElement>(
			'.section-gallery-lightbox-ui',
		)) {
			element.inert = !visible;
			if (!visible) {
				element.setAttr('aria-hidden', 'true');
			} else if (element === this.infoEl) {
				element.setAttr('aria-hidden', this.infoOpen ? 'false' : 'true');
			} else {
				element.removeAttribute('aria-hidden');
			}
		}
		if (this.zoomScale > 1) {
			this.contentEl.win.requestAnimationFrame(() => {
				this.reclampMediaTransform();
			});
		}
	}

	private readonly handleStageTransitionEnd = (
		event: TransitionEvent,
	): void => {
		const target = event.target as Node | null;
		if (
			(event.propertyName === 'transform' ||
				event.propertyName === 'translate') &&
			this.stagePageSettle !== null &&
			target?.instanceOf(HTMLElement) &&
			(target.hasClass('section-gallery-lightbox-media') ||
				target.hasClass('section-gallery-lightbox-scrub-preview') ||
				target.hasClass('section-gallery-lightbox-scrub-placeholder') ||
				target.hasClass('section-gallery-lightbox-page-preview'))
		) {
			this.completeStagePageSettle(this.stagePageSettle.generation);
			return;
		}
		if (
			event.target !== this.mediaStageEl ||
			(event.propertyName !== 'bottom' &&
				!event.propertyName.startsWith('padding'))
		) {
			return;
		}
		this.reclampMediaTransform();
	};

	private readonly handleFilmstripLayoutTransitionEnd = (
		event: TransitionEvent,
	): void => {
		if (
			event.target !== this.filmstripBottomEl ||
			(event.propertyName !== 'left' && event.propertyName !== 'bottom')
		) {
			return;
		}
		this.completeFilmstripLayoutRefresh();
	};

	private scheduleFilmstripLayoutRefresh(): void {
		this.cancelFilmstripLayoutRefresh();
		if (
			this.contentEl.win.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			this.filmstripLayoutRefreshFrame =
				this.contentEl.win.requestAnimationFrame(() => {
					this.filmstripLayoutRefreshFrame = null;
					this.refreshFilmstripLayout();
				});
			return;
		}
		const filmstripGap = this.filmstripEl
			? Number.parseFloat(
					this.contentEl.win.getComputedStyle(this.filmstripEl).columnGap,
				) || 0
			: 0;
		const compensate = (): void => {
			this.filmstripLayoutRefreshFrame = null;
			if (this.filmstripLayoutRefreshTimer === null) {
				return;
			}
			this.compensateFilmstripLayout(filmstripGap);
			this.filmstripLayoutRefreshFrame =
				this.contentEl.win.requestAnimationFrame(compensate);
		};
		this.filmstripLayoutRefreshFrame =
			this.contentEl.win.requestAnimationFrame(compensate);
		// Normal motion is finalized by transitionend. The fallback covers themes
		// that suppress/replace the bottom or left transition without leaving a
		// stale spacer geometry behind.
		this.filmstripLayoutRefreshTimer = this.contentEl.win.setTimeout(() => {
			this.completeFilmstripLayoutRefresh();
		}, INFO_LAYOUT_REFRESH_FALLBACK_MS);
	}

	private completeFilmstripLayoutRefresh(): void {
		if (
			this.filmstripLayoutRefreshFrame === null &&
			this.filmstripLayoutRefreshTimer === null
		) {
			return;
		}
		this.cancelFilmstripLayoutRefresh();
		this.refreshFilmstripLayout();
	}

	private compensateFilmstripLayout(filmstripGap: number): void {
		const viewport = this.filmstripViewportEl;
		const scroller = this.filmstripScrollerEl;
		const button =
			this.currentFilmstripButtonEl ??
			this.filmstripButtons[this.currentIndex] ??
			null;
		const startSpacer = this.filmstripStartSpacerEl;
		const endSpacer = this.filmstripEndSpacerEl;
		if (
			!viewport?.isConnected ||
			!scroller?.isConnected ||
			!button?.isConnected ||
			!startSpacer?.isConnected ||
			!endSpacer?.isConnected
		) {
			return;
		}
		const viewportRect = viewport.getBoundingClientRect();
		const buttonRect = button.getBoundingClientRect();
		const previousSpacerWidth =
			Number.parseFloat(startSpacer.style.width) || 0;
		const nextSpacerWidth = Math.max(
			0,
			(viewportRect.width - buttonRect.width) / 2 - filmstripGap,
		);
		const spacerDelta = nextSpacerWidth - previousSpacerWidth;
		if (Math.abs(spacerDelta) >= 0.01) {
			for (const spacer of [startSpacer, endSpacer]) {
				spacer.style.width = `${nextSpacerWidth}px`;
				spacer.style.minWidth = `${nextSpacerWidth}px`;
			}
		}
		const centerOffset =
			buttonRect.left +
			buttonRect.width / 2 -
			(viewportRect.left + viewportRect.width / 2);
		const nextScrollLeft =
			scroller.scrollLeft + centerOffset + spacerDelta;
		if (Math.abs(nextScrollLeft - scroller.scrollLeft) >= 0.01) {
			scroller.scrollLeft = nextScrollLeft;
		}
	}

	private cancelFilmstripLayoutRefresh(): void {
		if (this.filmstripLayoutRefreshFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(
				this.filmstripLayoutRefreshFrame,
			);
			this.filmstripLayoutRefreshFrame = null;
		}
		if (this.filmstripLayoutRefreshTimer !== null) {
			this.contentEl.win.clearTimeout(this.filmstripLayoutRefreshTimer);
			this.filmstripLayoutRefreshTimer = null;
		}
	}

	private refreshFilmstripLayout(): void {
		if (
			!this.filmstripViewportEl?.isConnected ||
			!this.filmstripScrollerEl?.isConnected
		) {
			return;
		}
		this.updateFilmstripGeometry();
		this.centerCurrentFilmstripItem('auto');
	}

	private reclampMediaTransform(): void {
		if (!this.mediaEl?.isConnected || this.zoomScale <= 1) {
			return;
		}
		this.clampPan();
		this.applyMediaTransform();
	}

	private move(delta: number): void {
		if (this.closeRequested || this.media.length < 2) {
			return;
		}
		this.cancelFilmstripInertia();
		this.cancelFilmstripMouseFrame();
		this.cancelFilmstripScrubFrame();
		this.cancelFilmstripSelectionCompensation();
		this.cancelFilmstripSnap();
		this.cancelNativeFilmstripSettle();
		this.filmstripNativeOriginalIndex = null;
		this.filmstripNativeScrolling = false;
		this.filmstripNativeLastActivityAt = null;
		this.filmstripNativePointerReleasedAt = null;
		this.filmstripScrub = null;
		this.suppressFilmstripClick = false;
		this.currentIndex =
			(this.currentIndex + delta + this.media.length) % this.media.length;
		this.renderCurrent();
	}

	private renderCurrent(
		preserveFilmstripPosition = false,
		preserveScrubPreview = false,
		promotedImage: HTMLImageElement | null = null,
	): void {
		const current = this.media[this.currentIndex];
		if (
			this.closeRequested ||
			!current ||
			!this.mediaStageEl ||
			!this.mediaTitleEl ||
			!this.sectionTitleEl ||
			!this.counterEl ||
			!this.statusEl
		) {
			return;
		}
		if (current.kind === 'video' && !this.controlsVisible) {
			this.setControlsVisible(true);
		}

		this.updateCurrentText();
		this.resetMediaTransform();
		const previousMedia = this.mediaEl;
		const videoThumbnail = current.kind === 'video'
			? this.filmstripButtons[this.currentIndex]?.querySelector<HTMLImageElement>('img.section-gallery-filmstrip-thumbnail')
			: null;
		const videoPoster = videoThumbnail?.currentSrc || videoThumbnail?.src || '';
		const keepScrubPreview =
			current.kind === 'image' &&
			preserveScrubPreview &&
			this.mediaStageEl.hasClass('is-scrubbing') &&
			(this.scrubPreviewEl !== null || this.scrubPlaceholderEl !== null);
		this.disposeStageMedia();
		this.stageMediaInvalidatedForScrub = false;
		const mediaGeneration = this.stageMediaGeneration + 1;
		this.stageMediaGeneration = mediaGeneration;
		if (keepScrubPreview) {
			previousMedia?.remove();
		} else {
			this.clearScrubPreview();
			this.mediaStageEl.empty();
		}
		this.mediaStageEl.toggleClass('is-image', current.kind === 'image');
		this.mediaStageEl.toggleClass('is-video', current.kind === 'video');

		if (current.kind === 'image') {
			const image =
				promotedImage ??
				this.mediaStageEl.createEl('img', {
					cls: 'section-gallery-lightbox-media',
					attr: {
						alt: current.file.basename,
						decoding: 'async',
						draggable: 'false',
					},
				});
			if (promotedImage) {
				this.setMediaFitRatio(image, image.naturalWidth, image.naturalHeight);
				image.addClass('section-gallery-lightbox-media');
				image.alt = current.file.basename;
				image.decoding = 'async';
				image.draggable = false;
				this.mediaStageEl.appendChild(image);
				this.rememberMediaDimensions(
					current,
					image.naturalWidth,
					image.naturalHeight,
				);
			}
			image.onload = () => {
				if (
					this.stageMediaGeneration !== mediaGeneration ||
					this.mediaEl !== image
				) {
					return;
				}
				this.setMediaFitRatio(image, image.naturalWidth, image.naturalHeight);
				this.rememberMediaDimensions(
					current,
					image.naturalWidth,
					image.naturalHeight,
				);
				this.clearScrubPreview();
			};
			image.onerror = () => {
				if (
					this.stageMediaGeneration === mediaGeneration &&
					this.mediaEl === image
				) {
					this.clearScrubPreview();
				}
			};
			image.oncontextmenu = this.handleMediaContextMenu;
			this.mediaEl = image;
			const knownDimensions = this.dimensionsByMediaId.get(current.id);
			if (knownDimensions) {
				this.setMediaFitRatio(image, knownDimensions.width, knownDimensions.height);
			}
			if (!promotedImage) {
				image.src = current.resourceUrl;
			}
		} else {
			const video = this.mediaStageEl.createEl('video', {
				cls: 'section-gallery-lightbox-media',
				attr: { 'aria-labelledby': LIGHTBOX_TITLE_ID },
			});
			video.controls = true;
			video.playsInline = true;
			video.preload = 'metadata';
			// iPhone can wait at HAVE_METADATA until the user presses Play. Keep
			// native controls visible immediately; a separate scrub image with
			// display:none on the video would prevent that required interaction.
			if (videoPoster.startsWith('blob:') || videoPoster.startsWith('data:')) {
				video.poster = videoPoster;
			}
			video.onloadedmetadata = () => {
				if (
					this.stageMediaGeneration !== mediaGeneration ||
					this.mediaEl !== video
				) {
					return;
				}
				this.rememberMediaDimensions(
					current,
					video.videoWidth,
					video.videoHeight,
				);
				this.setMediaFitRatio(video, video.videoWidth, video.videoHeight);
				this.rememberVideoDuration(current, video.duration);
			};
			video.onloadeddata = () => {
				if (
					this.stageMediaGeneration === mediaGeneration &&
					this.mediaEl === video
				) {
					this.clearScrubPreview();
				}
			};
			video.onerror = () => {
				if (
					this.stageMediaGeneration === mediaGeneration &&
					this.mediaEl === video
				) {
					this.clearScrubPreview();
				}
			};
			video.oncontextmenu = this.handleMediaContextMenu;
			this.mediaEl = video;
			video.src = current.resourceUrl;
			this.startVideoFrameRateMeasurement(
				video,
				current,
				mediaGeneration,
			);
		}
		this.renderFilmstrip(preserveFilmstripPosition);
		this.refreshNeighborImagePreloads();
		this.resetShareState();
		this.onViewed(current, this.currentIndex);
	}

	private updateCurrentText(announce = true): void {
		const current = this.media[this.currentIndex];
		if (
			!current ||
			!this.mediaTitleEl ||
			!this.sectionTitleEl ||
			!this.counterEl ||
			!this.statusEl
		) {
			return;
		}
		this.sectionTitleEl.setText(current.sectionTitle);
		this.sectionTitleEl.setAttr('title', current.sectionTitle);
		this.mediaTitleEl.setText(current.file.name);
		this.mediaTitleEl.setAttr('title', current.file.name);
		this.counterEl.setText(`${this.currentIndex + 1} / ${this.media.length}`);
		this.updateSectionChangeToast(current);
		if (announce) {
			this.statusEl.setText(
				`${this.currentIndex + 1} of ${this.media.length}, ${current.sectionTitle}, ${current.file.name}`,
			);
		}
		this.updateInfoPanel(current);
	}

	private updateSectionChangeToast(current: GalleryMedia): void {
		const previousKey = this.sectionStructuralKey;
		this.sectionStructuralKey = current.sectionStructuralKey;
		if (
			previousKey === null ||
			previousKey === current.sectionStructuralKey ||
			!this.sectionToastEl
		) {
			return;
		}
		if (this.sectionToastTimer !== null) {
			this.contentEl.win.clearTimeout(this.sectionToastTimer);
		}
		this.sectionToastEl.setText(current.sectionTitle);
		this.sectionToastEl.addClass('is-visible');
		this.sectionToastTimer = this.contentEl.win.setTimeout(() => {
			this.sectionToastTimer = null;
			this.sectionToastEl?.removeClass('is-visible');
			this.sectionToastEl?.setAttr('aria-hidden', 'true');
		}, SECTION_CHANGE_TOAST_MS);
	}

	private clearSectionToast(): void {
		if (this.sectionToastTimer !== null) {
			this.contentEl.win.clearTimeout(this.sectionToastTimer);
			this.sectionToastTimer = null;
		}
		this.sectionToastEl?.removeClass('is-visible');
		this.sectionToastEl?.setAttr('aria-hidden', 'true');
	}

	private readonly handleMediaContextMenu = (event: MouseEvent): void => {
		const current = this.media[this.currentIndex];
		if (!current) {
			return;
		}
		showMediaContextMenu({
			afterNavigate: () => this.closeAfterContextNavigation(),
			app: this.app,
			event,
			media: current,
			revealSource: this.onRevealSource,
		});
	};

	private closeAfterContextNavigation(): void {
		// Context-menu navigation has already activated its destination leaf. Do
		// not let the normal modal-close focus restoration reactivate the gallery
		// tile and steal focus back from the revealed note on desktop.
		this.restoreFocusOnClose = false;
		this.close();
	}

	private rememberMediaDimensions(
		item: GalleryMedia,
		width: number,
		height: number,
	): void {
		if (width <= 0 || height <= 0) {
			return;
		}
		this.dimensionsByMediaId.set(item.id, { height, width });
		if (this.media[this.currentIndex]?.id === item.id) {
			this.updateInfoPanel(item);
		}
	}

	private rememberVideoDuration(
		item: GalleryMedia,
		durationSeconds: number,
	): void {
		const previous = this.videoDetailsByMediaId.get(item.id);
		this.videoDetailsByMediaId.set(item.id, {
			...previous,
			approximateFps: previous?.approximateFps ?? null,
			durationSeconds:
				Number.isFinite(durationSeconds) && durationSeconds >= 0
					? durationSeconds
					: null,
		});
		if (this.media[this.currentIndex]?.id === item.id) {
			this.updateInfoPanel(item);
		}
	}

	private startVideoFrameRateMeasurement(
		video: HTMLVideoElement,
		item: GalleryMedia,
		mediaGeneration: number,
	): void {
		this.cancelVideoFrameRateMeasurement();
		const callbackMedia = video;
		if (typeof callbackMedia.requestVideoFrameCallback !== 'function') {
			const previous = this.videoDetailsByMediaId.get(item.id);
			this.videoDetailsByMediaId.set(item.id, {
				approximateFps: previous?.approximateFps ?? null,
				durationSeconds: previous?.durationSeconds ?? null,
				frameRateUnavailable: true,
			});
			this.updateInfoPanel(item);
			return;
		}
		this.videoFrameCallbackMedia = callbackMedia;
		this.videoFrameRateEstimatorState =
			createVideoFrameRateEstimatorState();

		const sampleFrame = (
			_now: number,
			metadata: VideoFrameCallbackMetadata,
		): void => {
			this.videoFrameCallbackId = null;
			if (
				this.stageMediaGeneration !== mediaGeneration ||
				this.mediaEl !== video ||
				this.videoFrameCallbackMedia !== callbackMedia
			) {
				return;
			}
			const previousState = this.videoFrameRateEstimatorState;
			if (!previousState) {
				return;
			}
			const nextState = updateVideoFrameRateEstimator(
				previousState,
				metadata.mediaTime,
				metadata.presentedFrames,
			);
			this.videoFrameRateEstimatorState = nextState;
			if (nextState.approximateFps !== null) {
				const previous = this.videoDetailsByMediaId.get(item.id);
				this.videoDetailsByMediaId.set(item.id, {
					approximateFps: nextState.approximateFps,
					durationSeconds: previous?.durationSeconds ?? null,
				});
				if (this.media[this.currentIndex]?.id === item.id) {
					this.updateInfoPanel(item);
				}
			}
			if (nextState.intervals.length >= 8) {
				this.videoFrameCallbackMedia = null;
				this.videoFrameRateEstimatorState = null;
				return;
			}
			this.videoFrameCallbackId =
				callbackMedia.requestVideoFrameCallback(sampleFrame);
		};

		this.videoFrameCallbackId =
			callbackMedia.requestVideoFrameCallback(sampleFrame);
	}

	private cancelVideoFrameRateMeasurement(): void {
		const callbackId = this.videoFrameCallbackId;
		const callbackMedia = this.videoFrameCallbackMedia;
		if (
			callbackId !== null &&
			callbackMedia &&
			typeof callbackMedia.cancelVideoFrameCallback === 'function'
		) {
			callbackMedia.cancelVideoFrameCallback(callbackId);
		}
		this.videoFrameCallbackId = null;
		this.videoFrameCallbackMedia = null;
		this.videoFrameRateEstimatorState = null;
	}

	private updateInfoPanel(item: GalleryMedia): void {
		const elements = this.infoElements;
		if (!elements) {
			return;
		}
		const dimensions = this.dimensionsByMediaId.get(item.id);
		const videoDetails = this.videoDetailsByMediaId.get(item.id);
		const showVideoDetails = item.kind === 'video';
		elements.path.setText(item.file.path);
		elements.path.setAttr('title', item.file.path);
		elements.size.setText(formatFileSize(item.file.stat.size));
		elements.dimensions.setText(
			dimensions ? `${dimensions.width} × ${dimensions.height} px` : '—',
		);
		for (const element of [
			elements.durationLabel,
			elements.duration,
			elements.frameRateLabel,
			elements.frameRate,
		]) {
			element.hidden = !showVideoDetails;
		}
		elements.duration.setText(
			showVideoDetails
				? (formatMediaDuration(videoDetails?.durationSeconds ?? Number.NaN) ??
						'—')
				: '—',
		);
		elements.frameRate.setText(
			showVideoDetails
				? (formatApproximateFrameRate(
						videoDetails?.approximateFps ?? null,
					) ?? (videoDetails?.frameRateUnavailable
						? 'Not available on this device'
						: 'Play video to measure'))
				: '—',
		);
		const extension = item.file.extension.toUpperCase();
		elements.extension.setText(
			`${item.kind === 'image' ? 'Image' : 'Video'} · ${extension}`,
		);
		elements.modified.setText(
			new Date(item.file.stat.mtime).toLocaleString(),
		);
	}

	private renderFilmstrip(preservePosition = false): void {
		if (!this.filmstripEl || !this.filmstripLoader) {
			return;
		}
		if (this.filmstripEl.childElementCount > 0) {
			this.markFilmstripSelection();
			if (!preservePosition) {
				this.contentEl.win.requestAnimationFrame(() => {
					this.centerCurrentFilmstripItem('auto');
				});
			}
			return;
		}
		for (const media of this.filmstripMedia) {
			this.filmstripLoader.unobserve(media);
		}
		this.filmstripMedia.clear();
		this.filmstripEl.empty();
		this.filmstripButtons = [];
		this.currentFilmstripButtonEl = null;
		this.filmstripStartSpacerEl = this.filmstripEl.createDiv({
			cls: 'section-gallery-filmstrip-edge-spacer',
		});
		this.filmstripStartSpacerEl.setAttr('aria-hidden', 'true');

		let currentButton: HTMLButtonElement | null = null;

		for (let index = 0; index < this.media.length; index += 1) {
			const item = this.media[index];
			if (!item) {
				continue;
			}
			const previous = index > 0 ? this.media[index - 1] : null;
			if (
				previous &&
				this.getHeadingPathKey(previous) !== this.getHeadingPathKey(item)
			) {
				const separator = this.filmstripEl.createSpan({
					cls: 'section-gallery-filmstrip-separator',
				});
				separator.setAttr('aria-hidden', 'true');
			}
			const button = this.filmstripEl.createEl('button', {
				cls: 'section-gallery-filmstrip-item',
			});
			button.type = 'button';
			button.dataset.mediaIndex = String(index);
			button.createSpan({
				cls: 'section-gallery-screen-reader-only',
				text: `Open ${item.file.name}`,
			});
			button.tabIndex = index === this.currentIndex ? 0 : -1;
			this.filmstripButtons[index] = button;

			if (index === this.currentIndex) {
				button.addClass('is-current');
				button.setAttr('aria-current', 'true');
				currentButton = button;
				this.currentFilmstripButtonEl = button;
			}

			// Canvas-backed stills avoid Android's native gray video/play poster
			// and keep offscreen carousel items free of live media decoders.
			const image = button.createEl('img', {
				cls: 'section-gallery-filmstrip-thumbnail',
				attr: { alt: '', decoding: 'async' },
			});
			image.onload = () => button.addClass('is-loaded');
			image.onerror = () => button.addClass('has-error');
			this.filmstripMedia.add(image);
			this.filmstripLoader.observe(image, item, undefined, (metadata) => {
				if (this.closeRequested || !this.filmstripEl?.contains(image)) return;
				this.rememberMediaDimensions(item, metadata.width, metadata.height);
				if (metadata.durationSeconds !== null) {
					this.rememberVideoDuration(item, metadata.durationSeconds);
				}
			});
			if (item.kind === 'video') {
				const badge = button.createSpan({
					cls: 'section-gallery-filmstrip-play-badge',
				});
				setIcon(badge, 'play');
			}
		}
		this.filmstripEndSpacerEl = this.filmstripEl.createDiv({
			cls: 'section-gallery-filmstrip-edge-spacer',
		});
		this.filmstripEndSpacerEl.setAttr('aria-hidden', 'true');

		if (currentButton) {
			this.contentEl.win.requestAnimationFrame(() => {
				if (!this.filmstripEl?.contains(currentButton)) {
					return;
				}
				this.updateFilmstripGeometry();
				if (!preservePosition) {
					this.centerFilmstripButton(currentButton, 'auto');
				}
			});
		}
	}

	private updateFilmstripGeometry(): void {
		const viewport = this.filmstripViewportEl;
		const firstItem = this.filmstripEl?.querySelector<HTMLElement>(
			'.section-gallery-filmstrip-item',
		);
		const expandedItem = this.currentFilmstripButtonEl ?? firstItem;
		if (
			!viewport ||
			!firstItem ||
			!expandedItem ||
			!this.filmstripStartSpacerEl ||
			!this.filmstripEndSpacerEl
		) {
			return;
		}
		this.updateFilmstripEdgeSpacers(expandedItem);
		this.filmstripCenters = [];
		for (const button of this.filmstripEl?.querySelectorAll<HTMLElement>(
			'.section-gallery-filmstrip-item',
		) ?? []) {
			const index = Number(button.dataset.mediaIndex);
			if (!Number.isInteger(index)) {
				continue;
			}
			this.filmstripCenters.push({
				center: button.offsetLeft + button.offsetWidth / 2,
				index,
			});
		}
	}

	private updateFilmstripEdgeSpacers(expandedItem: HTMLElement): void {
		const viewport = this.filmstripViewportEl;
		const startSpacer = this.filmstripStartSpacerEl;
		const endSpacer = this.filmstripEndSpacerEl;
		if (!viewport || !startSpacer || !endSpacer) {
			return;
		}
		const filmstripGap = this.filmstripEl
			? Number.parseFloat(
					this.contentEl.win.getComputedStyle(this.filmstripEl).columnGap,
				) || 0
			: 0;
		const spacerWidth = Math.max(
			0,
			(viewport.clientWidth - expandedItem.offsetWidth) / 2 - filmstripGap,
		);
		for (const spacer of [startSpacer, endSpacer]) {
			spacer.style.width = `${spacerWidth}px`;
			spacer.style.minWidth = `${spacerWidth}px`;
		}
	}

	private centerCurrentFilmstripItem(behavior: ScrollBehavior): void {
		const button = this.filmstripEl?.querySelector<HTMLElement>(
			`.section-gallery-filmstrip-item[data-media-index="${this.currentIndex}"]`,
		);
		if (button) {
			this.centerFilmstripButton(button, behavior);
		}
	}

	private centerFilmstripButton(
		button: HTMLElement,
		behavior: ScrollBehavior,
	): void {
		this.cancelFilmstripSnap();
		const viewport = this.filmstripViewportEl;
		const scroller = this.filmstripScrollerEl;
		if (!viewport || !scroller) {
			return;
		}
		const viewportRect = viewport.getBoundingClientRect();
		const buttonRect = button.getBoundingClientRect();
		const offset =
			buttonRect.left +
			buttonRect.width / 2 -
			(viewportRect.left + viewportRect.width / 2);
		scroller.scrollTo({
			behavior,
			left: scroller.scrollLeft + offset,
		});
	}

	private getHeadingPathKey(item: GalleryMedia): string {
		return item.sectionPath.map((entry) => entry.renderKey).join('\u001f');
	}

	private markFilmstripSelection(): void {
		const current = this.filmstripButtons[this.currentIndex] ?? null;
		if (!current) {
			return;
		}
		const previous = this.currentFilmstripButtonEl;
		const moveFocus = previous === this.contentEl.ownerDocument.activeElement;
		const anchorCenter =
			previous !== current
				? current.offsetLeft + current.offsetWidth / 2
				: null;
		if (previous && previous !== current) {
			previous.removeClass('is-current');
			previous.removeAttribute('aria-current');
			previous.tabIndex = -1;
		}
		current.addClass('is-current');
		current.setAttr('aria-current', 'true');
		current.tabIndex = 0;
		this.currentFilmstripButtonEl = current;
		this.filmstripCenters = [];
		if (anchorCenter !== null) {
			this.startFilmstripSelectionCompensation(
				this.currentIndex,
				anchorCenter,
			);
		}
		if (moveFocus && previous !== current) {
			current.focus({ preventScroll: true });
		}
	}

	private startFilmstripSelectionCompensation(
		index: number,
		anchorCenter: number,
	): void {
		this.cancelFilmstripSelectionCompensation();
		this.filmstripSelectionAnchorIndex = index;
		this.filmstripSelectionAnchorCenter = anchorCenter;
		const update = (): void => {
			this.filmstripSelectionFrame = null;
			if (!this.applyFilmstripSelectionCompensation()) {
				return;
			}
			this.filmstripSelectionFrame =
				this.contentEl.win.requestAnimationFrame(update);
		};
		this.filmstripSelectionFrame =
			this.contentEl.win.requestAnimationFrame(update);
		this.filmstripSelectionSettleTimer = this.contentEl.win.setTimeout(() => {
			this.finishFilmstripSelectionCompensation();
		}, FILMSTRIP_SELECTION_SETTLE_MS);
	}

	private applyFilmstripSelectionCompensation(): boolean {
		const index = this.filmstripSelectionAnchorIndex;
		const previousCenter = this.filmstripSelectionAnchorCenter;
		const scroller = this.filmstripScrollerEl;
		const button = index === null ? null : this.filmstripButtons[index];
		if (
			index === null ||
			previousCenter === null ||
			!scroller?.isConnected ||
			!button?.isConnected
		) {
			this.cancelFilmstripSelectionCompensation();
			return false;
		}
		this.updateFilmstripGeometry();
		const nextCenter = button.offsetLeft + button.offsetWidth / 2;
		const delta = nextCenter - previousCenter;
		scroller.scrollLeft += delta;
		if (this.filmstripScrub?.pointerType === 'mouse') {
			this.filmstripScrub.startScrollLeft += delta;
		}
		this.filmstripSelectionAnchorCenter = nextCenter;
		return true;
	}

	private finishFilmstripSelectionCompensation(): void {
		const snapAfterSelection = this.filmstripSnapAfterSelection;
		this.applyFilmstripSelectionCompensation();
		this.cancelFilmstripSelectionCompensation();
		this.updateFilmstripGeometry();
		if (snapAfterSelection) {
			this.snapFilmstripToCurrent();
		}
	}

	private cancelFilmstripSelectionCompensation(): void {
		if (this.filmstripSelectionFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.filmstripSelectionFrame);
			this.filmstripSelectionFrame = null;
		}
		if (this.filmstripSelectionSettleTimer !== null) {
			this.contentEl.win.clearTimeout(this.filmstripSelectionSettleTimer);
			this.filmstripSelectionSettleTimer = null;
		}
		this.filmstripSelectionAnchorIndex = null;
		this.filmstripSelectionAnchorCenter = null;
		this.filmstripSnapAfterSelection = false;
	}

	private readonly handleFilmstripItemTransitionEnd = (
		event: TransitionEvent,
	): void => {
		const target = event.target as Node | null;
		if (
			event.propertyName !== 'width' ||
			!target?.instanceOf(HTMLElement) ||
			!target.hasClass('section-gallery-filmstrip-item') ||
			Number(target.dataset.mediaIndex) !==
				this.filmstripSelectionAnchorIndex
		) {
			return;
		}
		this.finishFilmstripSelectionCompensation();
	};

	private readonly handleViewportOrientationChange = (): void => {
		// The event itself is the reliable flip signal on WebKit; viewport
		// dimensions may still describe the old orientation in this callback.
		this.beginViewportResizeTransition(this.shouldUseRotationFreeze());
	};

	private readonly handleViewportResize = (): void => {
		const landscape = this.getViewportLandscape(this.lastSettledLandscape);
		const orientationFlip =
			this.shouldUseRotationFreeze() &&
			landscape !== this.lastSettledLandscape &&
			landscape !== this.rotationFreezeLandscape;
		this.beginViewportResizeTransition(orientationFlip);
	};

	private beginViewportResizeTransition(orientationFlip: boolean): void {
		if (this.closeRequested) {
			return;
		}
		this.cancelViewportResizeSettle();
		if (orientationFlip) {
			this.resetMediaTransform();
			this.finalizeFilmstripForStageGesture();
			this.createOrRefreshRotationFreeze();
		} else if (!this.modalEl.hasClass('is-viewport-resizing')) {
			this.resetMediaTransform();
			this.finalizeFilmstripForStageGesture();
		}
		this.modalEl.addClass('is-viewport-resizing');
		this.cancelRotationFreezeReveal();
		this.viewportResizeSettleTimer = this.contentEl.win.setTimeout(() => {
			this.viewportResizeSettleTimer = null;
			this.viewportResizeFrame = this.contentEl.win.requestAnimationFrame(() => {
				this.viewportResizeFrame = null;
				if (!this.modalEl.isConnected) {
					return;
				}
				this.refreshFilmstripLayout();
				this.lastSettledLandscape = this.getViewportLandscape(
					this.lastSettledLandscape,
				);
				this.modalEl.removeClass('is-viewport-resizing');
				this.viewportResizeRevealFrame =
					this.contentEl.win.requestAnimationFrame(() => {
						this.viewportResizeRevealFrame = null;
						const overlay = this.rotationFreezeEl;
						if (!this.modalEl.isConnected || !overlay?.isConnected) {
							return;
						}
						overlay.addClass('is-revealing');
						if (
							this.contentEl.win.matchMedia(
								'(prefers-reduced-motion: reduce)',
							).matches
						) {
							this.removeRotationFreeze();
							return;
						}
						this.rotationFreezeCleanupTimer =
							this.contentEl.win.setTimeout(() => {
								this.rotationFreezeCleanupTimer = null;
								this.removeRotationFreeze();
							}, ROTATION_FREEZE_REMOVE_FALLBACK_MS);
					});
			});
		}, VIEWPORT_RESIZE_SETTLE_MS);
	}

	private shouldUseRotationFreeze(): boolean {
		return (
			Platform.isMobileApp || this.contentEl.doc.body.hasClass('is-mobile')
		);
	}

	private getViewportLandscape(fallback: boolean): boolean {
		return resolveViewportLandscape(
			this.contentEl.win.innerWidth,
			this.contentEl.win.innerHeight,
			fallback,
		);
	}

	private createOrRefreshRotationFreeze(): void {
		const content = this.createRotationFreezeContent();
		let overlay = this.rotationFreezeEl;
		if (!overlay) {
			overlay = this.getDomWindow().createDiv();
			overlay.addClasses([
				'section-gallery-lightbox-stage',
				'section-gallery-lightbox-rotation-freeze',
			]);
			overlay.setAttr('aria-hidden', 'true');
			overlay.appendChild(content);
			overlay.addEventListener(
				'transitionend',
				this.handleRotationFreezeTransitionEnd,
			);
			this.contentEl.appendChild(overlay);
			this.rotationFreezeEl = overlay;
		} else {
			overlay.replaceChildren(content);
		}
		this.rotationFreezeLandscape = this.getViewportLandscape(
			this.lastSettledLandscape,
		);
	}

	private createRotationFreezeContent(): HTMLElement {
		const button = this.filmstripButtons[this.currentIndex];
		const image = button?.querySelector<HTMLImageElement>(
			'img.section-gallery-filmstrip-thumbnail',
		);
		if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
			const canvas = this.drawRotationFreezeCanvas(
				image,
				image.naturalWidth,
				image.naturalHeight,
			);
			if (canvas) {
				return canvas;
			}
		}
		const video = button?.querySelector<HTMLVideoElement>(
			'video.section-gallery-filmstrip-thumbnail',
		);
		if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
			const canvas = this.drawRotationFreezeCanvas(
				video,
				video.videoWidth,
				video.videoHeight,
			);
			if (canvas) {
				return canvas;
			}
		}
		return this.createRotationFreezePlaceholder();
	}

	private drawRotationFreezeCanvas(
		source: CanvasImageSource,
		width: number,
		height: number,
	): HTMLCanvasElement | null {
		const dimensions = getCappedPreviewDimensions(
			width,
			height,
			ROTATION_FREEZE_MAX_EDGE_PX,
		);
		if (!dimensions) {
			return null;
		}
		const canvas = this.getDomWindow().createEl('canvas');
		canvas.addClass('section-gallery-lightbox-rotation-freeze-media');
		canvas.width = dimensions.width;
		canvas.height = dimensions.height;
		this.setMediaFitRatio(canvas, width, height);
		try {
			const context = canvas.getContext('2d');
			if (!context) {
				return null;
			}
			context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
			return canvas;
		} catch {
			return null;
		}
	}

	private createRotationFreezePlaceholder(): HTMLElement {
		const placeholder = this.getDomWindow().createDiv();
		placeholder.addClass(
			'section-gallery-lightbox-rotation-freeze-placeholder',
		);
		const icon = placeholder.createDiv({
			cls: 'section-gallery-lightbox-rotation-freeze-icon',
		});
		const item = this.media[this.currentIndex];
		setIcon(icon, item?.kind === 'video' ? 'play' : 'image');
		placeholder.createDiv({
			cls: 'section-gallery-lightbox-rotation-freeze-name',
			text: item?.file.name ?? 'Media',
		});
		return placeholder;
	}

	private readonly handleRotationFreezeTransitionEnd = (
		event: TransitionEvent,
	): void => {
		if (
			event.target !== this.rotationFreezeEl ||
			event.propertyName !== 'opacity' ||
			!this.rotationFreezeEl?.hasClass('is-revealing')
		) {
			return;
		}
		this.removeRotationFreeze();
	};

	private getDomWindow(): ObsidianDomWindow {
		return this.contentEl.doc.win as ObsidianDomWindow;
	}

	private cancelRotationFreezeReveal(): void {
		if (this.rotationFreezeCleanupTimer !== null) {
			this.contentEl.win.clearTimeout(this.rotationFreezeCleanupTimer);
			this.rotationFreezeCleanupTimer = null;
		}
		this.rotationFreezeEl?.removeClass('is-revealing');
	}

	private removeRotationFreeze(): void {
		if (this.rotationFreezeCleanupTimer !== null) {
			this.contentEl.win.clearTimeout(this.rotationFreezeCleanupTimer);
			this.rotationFreezeCleanupTimer = null;
		}
		this.rotationFreezeEl?.removeEventListener(
			'transitionend',
			this.handleRotationFreezeTransitionEnd,
		);
		this.rotationFreezeEl?.remove();
		this.rotationFreezeEl = null;
		this.rotationFreezeLandscape = null;
	}

	private cancelViewportResizeSettle(removeClass = false): void {
		if (this.viewportResizeSettleTimer !== null) {
			this.contentEl.win.clearTimeout(this.viewportResizeSettleTimer);
			this.viewportResizeSettleTimer = null;
		}
		if (this.viewportResizeFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.viewportResizeFrame);
			this.viewportResizeFrame = null;
		}
		if (this.viewportResizeRevealFrame !== null) {
			this.contentEl.win.cancelAnimationFrame(this.viewportResizeRevealFrame);
			this.viewportResizeRevealFrame = null;
		}
		if (removeClass) {
			this.modalEl.removeClass('is-viewport-resizing');
		}
	}

	private disposeStageMedia(): void {
		this.cancelVideoFrameRateMeasurement();
		const media = this.mediaEl;
		if (!media) {
			return;
		}
		this.stageMediaGeneration += 1;
		this.detachStageMediaLoadHandlers(media);
		media.oncontextmenu = null;
		if (media.instanceOf(HTMLVideoElement)) {
			media.pause();
		}
		media.removeAttribute('src');
		if (media.instanceOf(HTMLVideoElement)) {
			media.load();
		}
		this.mediaEl = null;
	}

	private invalidateStageMediaForScrub(): void {
		if (this.stageMediaInvalidatedForScrub) {
			return;
		}
		this.stageMediaInvalidatedForScrub = true;
		this.stageMediaGeneration += 1;
		this.cancelVideoFrameRateMeasurement();
		this.detachStageMediaLoadHandlers(this.mediaEl);
	}

	private detachStageMediaLoadHandlers(
		media: HTMLImageElement | HTMLVideoElement | null,
	): void {
		if (!media) {
			return;
		}
		media.onerror = null;
		if (media.instanceOf(HTMLImageElement)) {
			media.onload = null;
			return;
		}
		media.onloadeddata = null;
		media.onloadedmetadata = null;
	}

	private resetShareState(): void {
		this.shareGeneration += 1;
		const current = this.media[this.currentIndex];
		const button = this.shareButtonEl;
		if (!current || !button || this.closeRequested) {
			return;
		}
		button.disabled = false;
		button.removeClass('is-preparing');
		setIcon(button, 'share-2');
		const canWebShare = this.canWebShareMedia(current);
		const nativeOpen = getAndroidFileOpener(this.app.vault.adapter, Platform.isAndroidApp);
		if (!canWebShare && !nativeOpen) {
			button.addClass('is-hidden');
			return;
		}
		button.setAttr('aria-label', canWebShare ? 'Share media' : 'Share or open in another app');
		button.removeClass('is-hidden');
	}

	private canWebShareMedia(item: GalleryMedia): boolean {
		const navigator = this.contentEl.win.navigator;
		const rootWindow = this.contentEl.win as Window & { File?: typeof File };
		if (
			typeof navigator.share !== 'function' ||
			typeof navigator.canShare !== 'function' ||
			typeof rootWindow.File !== 'function'
		) return false;
		try {
			// Check name/MIME support before reading a potentially large video.
			// This only probes capabilities; it does not send an empty file.
			const probe = new rootWindow.File([], item.file.name, {
				type: getMediaMimeType(item.file.extension),
			});
			return navigator.canShare({ files: [probe] });
		} catch {
			return false;
		}
	}

	private handleShare(): void {
		void this.shareCurrent();
	}

	/**
	 * Opens Android's native original-file chooser when Web Share is unavailable.
	 * Otherwise keeps preparation and share() in the same explicit activation:
	 * WebKit retains activation briefly while the local vault read completes.
	 */
	private async shareCurrent(): Promise<void> {
		const index = this.currentIndex;
		const current = this.media[index];
		const button = this.shareButtonEl;
		if (!current || !button || this.closeRequested || button.disabled) {
			return;
		}
		const generation = this.shareGeneration;
		button.disabled = true;
		button.addClass('is-preparing');
		setIcon(button, 'loader-circle');
		button.setAttr('aria-label', 'Preparing media to share');
		try {
			const nativeOpen = getAndroidFileOpener(this.app.vault.adapter, Platform.isAndroidApp);
			if (!this.canWebShareMedia(current)) {
				if (nativeOpen) await nativeOpen(current.file.path);
				else new Notice('Sharing this file is not supported on this device.');
				return;
			}
			const bytes = await this.app.vault.readBinary(current.file);
			if (
				this.closeRequested ||
				generation !== this.shareGeneration ||
				index !== this.currentIndex ||
				!this.shareButtonEl
			) {
				return;
			}
			const rootWindow = this.contentEl.win as Window & {
				File: typeof File;
			};
			const file = new rootWindow.File([bytes], current.file.name, {
				lastModified: current.file.stat.mtime,
				type: getMediaMimeType(current.file.extension),
			});
			const navigator = this.contentEl.win.navigator;
			const payload: ShareData = { files: [file] };
			if (
				typeof navigator.share !== 'function' ||
				typeof navigator.canShare !== 'function' ||
				!navigator.canShare(payload)
			) {
				if (nativeOpen) await nativeOpen(current.file.path);
				else new Notice('Sharing this file is not supported on this device.');
				return;
			}
			await navigator.share(payload);
		} catch (error: unknown) {
			if (generation === this.shareGeneration && !this.closeRequested && !this.isAbortError(error)) {
				new Notice('Could not share or open this media.');
			}
		} finally {
			if (
				generation === this.shareGeneration &&
				index === this.currentIndex &&
				this.shareButtonEl
			) {
				this.resetShareState();
			}
		}
	}

	private isAbortError(error: unknown): boolean {
		return (
			typeof error === 'object' &&
			error !== null &&
			'name' in error &&
			error.name === 'AbortError'
		);
	}
}
