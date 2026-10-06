import { apiVersion, Modal, Notice, Platform, Setting, type App } from 'obsidian';
import { getAndroidFileOpener } from './mobile-sharing';

export const GALLERY_BUILD_VERSION = '0.9.2';

const VIEWER_NODES = {
	modal: '.modal.section-gallery-lightbox',
	content: '.section-gallery-lightbox-content',
	header: '.section-gallery-lightbox-header',
	stage: '.section-gallery-lightbox-stage',
	media: '.section-gallery-lightbox-stage > .section-gallery-lightbox-media',
	filmstrip: '.section-gallery-lightbox-bottom',
	footer: '.section-gallery-lightbox-footer',
	information: '.section-gallery-lightbox-info-panel',
} as const;

export function measureGalleryViewer(doc: Document): object | null {
	const modal = doc.querySelector(VIEWER_NODES.modal);
	if (!modal) return null;
	const win = doc.win;
	const nodes: Record<string, object | null> = {};
	for (const [name, selector] of Object.entries(VIEWER_NODES)) {
		const el = doc.querySelector(selector);
		if (!el) {
			nodes[name] = null;
			continue;
		}
		const rect = el.getBoundingClientRect();
		const css = win.getComputedStyle(el);
		nodes[name] = {
			x: rect.x, y: rect.y, width: rect.width, height: rect.height,
			padding: css.padding, display: css.display, visibility: css.visibility,
		};
	}
	const video = modal.querySelector<HTMLVideoElement>('.section-gallery-lightbox-stage > video');
	return {
		capturedAt: new Date().toISOString(),
		viewport: { width: win.innerWidth, height: win.innerHeight },
		controlsVisible: !modal.hasClass('is-ui-hidden'),
		informationOpen: modal.hasClass('is-info-open'),
		nodes,
		video: video ? {
			readyState: video.readyState, networkState: video.networkState,
			width: video.videoWidth, height: video.videoHeight,
			duration: Number.isFinite(video.duration) ? video.duration : null,
			paused: video.paused, seeking: video.seeking,
			currentTime: Number.isFinite(video.currentTime) ? video.currentTime : null,
			controls: video.controls, playsInline: video.playsInline,
			errorCode: video.error?.code ?? null,
		} : null,
	};
}

let lastViewer: object | null = null;

/** No filenames, URLs, note text or vault paths are collected. Memory only. */
export function captureGalleryViewerDiagnostics(doc: Document): void {
	lastViewer = measureGalleryViewer(doc) ?? lastViewer;
}

export function collectGalleryDiagnostics(doc: Document, pluginVersion: string, app?: App): object {
	const win = doc.win;
	const css = win.getComputedStyle(doc.body);
	const domWindow = win as Window & { createDiv: typeof createDiv; createEl: typeof createEl };
	const probe = domWindow.createDiv();
	probe.className = 'section-gallery-safe-area-probe';
	doc.body.appendChild(probe);
	const safeCss = win.getComputedStyle(probe);
	const environmentInsets = {
		top: safeCss.paddingTop, right: safeCss.paddingRight,
		bottom: safeCss.paddingBottom, left: safeCss.paddingLeft,
	};
	const stylesheetVersion = safeCss.getPropertyValue('--section-gallery-build-version').trim() || null;
	probe.remove();
	const visual = win.visualViewport;
	const video = domWindow.createEl('video');
	const currentViewer = measureGalleryViewer(doc);
	if (currentViewer) lastViewer = currentViewer;
	return {
		schema: 1, buildVersion: GALLERY_BUILD_VERSION, manifestVersion: pluginVersion, stylesheetVersion,
		obsidianApiVersion: apiVersion, capturedAt: new Date().toISOString(),
		platform: { android: Platform.isAndroidApp, ios: Platform.isIosApp, mobile: Platform.isMobile },
		userAgent: win.navigator.userAgent,
		theme: doc.body.hasClass('theme-dark') ? 'dark' : 'light',
		viewport: {
			width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio,
			visual: visual ? { x: visual.offsetLeft, y: visual.offsetTop, width: visual.width, height: visual.height, scale: visual.scale } : null,
		},
		environmentInsets,
		obsidianInsets: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, css.getPropertyValue(`--safe-area-inset-${side}`).trim()])),
		capabilities: {
			nativeAndroidFileChooser: Boolean(getAndroidFileOpener(app?.vault.adapter, Platform.isAndroidApp)),
			webShare: typeof win.navigator.share === 'function',
			webCanShare: typeof win.navigator.canShare === 'function',
			clipboard: typeof win.navigator.clipboard?.writeText === 'function',
			videoFrameCallback: typeof video.requestVideoFrameCallback === 'function',
			h264: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
			vp9: video.canPlayType('video/webm; codecs="vp9"'),
			hevc: video.canPlayType('video/mp4; codecs="hvc1"'),
		},
		currentViewer, lastViewer,
	};
}

class GalleryDiagnosticsModal extends Modal {
	constructor(app: App, private readonly onClosed?: (modal: Modal) => void) {
		super(app);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onClosed?.(this);
	}
}

export function openGalleryDiagnostics(
	app: App,
	pluginVersion: string,
	onClosed?: (modal: Modal) => void,
): Modal {
	const modal = new GalleryDiagnosticsModal(app, onClosed);
	// Capture before adding a second modal over the viewer.
	const report = JSON.stringify(collectGalleryDiagnostics(modal.contentEl.doc, pluginVersion, app), null, 2);
	modal.setTitle('Gallery mobile diagnostics');
	modal.contentEl.createEl('p', { text: 'Reproduce the problem, close the viewer, then open this report. It includes display bounds and device capabilities, but no filenames, paths or note contents. Nothing is sent automatically.' });
	const text = modal.contentEl.createEl('textarea', {
		cls: 'section-gallery-diagnostics-report',
		attr: { readonly: '', 'aria-label': 'Diagnostic report', spellcheck: 'false' },
	});
	text.value = report;
	new Setting(modal.contentEl).addButton(button => button.setButtonText('Copy report').setCta().onClick(async () => {
		try {
			await modal.contentEl.win.navigator.clipboard.writeText(report);
			new Notice('Diagnostic report copied.');
		} catch {
			text.focus();
			text.select();
			new Notice('Use the system copy action on the selected report.');
		}
	})).addButton(button => button.setButtonText('Save report to vault').onClick(async () => {
		button.setDisabled(true);
		try {
			const path = `Gallery diagnostics ${Date.now()}.json`;
			await app.vault.create(path, report);
			new Notice(`Saved ${path}`);
		} catch {
			new Notice('Could not save the report. Try copying it instead.');
		} finally {
			button.setDisabled(false);
		}
	}));
	modal.open();
	return modal;
}
