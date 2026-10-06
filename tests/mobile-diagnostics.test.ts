import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

interface ViewerReport {
	viewport: { width: number; height: number };
	controlsVisible: boolean;
	informationOpen: boolean;
	nodes: Record<string, { x: number; y: number; width: number; height: number } | null>;
	video: { duration: number | null; errorCode: number | null; controls: boolean; playsInline: boolean; seeking: boolean; currentTime: number | null } | null;
}

interface DiagnosticReport {
	buildVersion: string;
	manifestVersion: string;
	stylesheetVersion: string | null;
	obsidianApiVersion: string;
	userAgent: string;
	theme: string;
	environmentInsets: Record<string, string>;
	obsidianInsets: Record<string, string>;
	capabilities: Record<string, boolean | string>;
	viewport: { width: number; height: number; visual: unknown };
	currentViewer: ViewerReport | null;
	lastViewer: ViewerReport | null;
}

interface DiagnosticsModule {
	GALLERY_BUILD_VERSION: string;
	collectGalleryDiagnostics(doc: unknown, pluginVersion: string): DiagnosticReport;
	captureGalleryViewerDiagnostics(doc: unknown): void;
	openGalleryDiagnostics(app: unknown, pluginVersion: string, onClosed?: (modal: object) => void): { close(): void };
}

const bundle = build({
	entryPoints: ['src/mobile-diagnostics.ts'],
	bundle: true,
	external: ['obsidian'],
	format: 'cjs',
	platform: 'node',
	write: false,
}).then(result => result.outputFiles[0]!.text);

const secret = 'PRIVATE_NOTE_VAULT_PATH_AND_FILE.jpg';

function sensitiveElement<T extends object>(el: T): T {
	for (const property of ['textContent', 'innerText', 'innerHTML', 'outerHTML', 'src', 'currentSrc', 'dataset', 'title']) {
		Object.defineProperty(el, property, {
			get: () => { throw new Error(`Diagnostic report read private ${property}: ${secret}`); },
		});
	}
	return el;
}

async function harness(options: { viewer?: boolean; capabilities?: boolean; visual?: boolean; stylesheetVersion?: string } = {}) {
	let viewerOpen = options.viewer ?? true;
	let width = 412;
	const calls = { probesAdded: 0, probesRemoved: 0, clipboard: 0, vaultWrites: 0, opened: 0, emptied: 0 };
	const reportFields: { value?: string }[] = [];
	const clicks = new Map<string, () => unknown>();
	const node = sensitiveElement({
		getBoundingClientRect: () => ({ x: 12, y: 32, width: width - 24, height: 600 }),
	});
	const currentVideo = sensitiveElement({
		readyState: 2, networkState: 1, videoWidth: 1920, videoHeight: 1080,
		duration: NaN, paused: true, seeking: false, currentTime: 0, controls: true, playsInline: true,
		error: { code: 4, message: secret },
	});
	const modal = sensitiveElement({
		...node,
		hasClass: (name: string) => name === 'is-info-open',
		querySelector: () => currentVideo,
	});
	const body = {
		hasClass: (name: string) => name === 'theme-dark',
		appendChild: () => { calls.probesAdded += 1; },
	};
	const navigator = {
		userAgent: 'Android WebView test user agent',
		...(options.capabilities ? {
			share: () => Promise.resolve(),
			canShare: () => true,
			clipboard: { writeText: () => { calls.clipboard += 1; return Promise.resolve(); } },
		} : {}),
	};
	const win = {
		get innerWidth() { return width; },
		innerHeight: 915, devicePixelRatio: 3, navigator,
		visualViewport: options.visual ? { offsetLeft: 2, offsetTop: 3, width: 410, height: 880, scale: 1 } : null,
		getComputedStyle: (el: object) => el === body
			? { getPropertyValue: (name: string) => ({ '--safe-area-inset-top': ' 24px ', '--safe-area-inset-right': ' 0px ', '--safe-area-inset-bottom': ' 48px ', '--safe-area-inset-left': ' 4px ' }[name] ?? '') }
			: { padding: '32px 12px', display: 'block', visibility: 'visible', paddingTop: '25px', paddingRight: '1px', paddingBottom: '49px', paddingLeft: '5px', getPropertyValue: (name: string) => name === '--section-gallery-build-version' ? ` ${options.stylesheetVersion ?? ''} ` : '' },
		createDiv: () => ({ className: '', remove: () => { calls.probesRemoved += 1; } }),
		createEl: () => ({
			canPlayType: (mime: string) => options.capabilities && mime.includes('avc1') ? 'probably' : '',
			...(options.capabilities ? { requestVideoFrameCallback: () => 1 } : {}),
		}),
	};
	const doc = {
		win, body,
		querySelector: (selector: string) => viewerOpen
			? selector === '.modal.section-gallery-lightbox' ? modal : node
			: null,
	};
	const contentEl = {
		doc, win,
		empty: () => { calls.emptied += 1; },
		createEl: (tag: string) => {
			const el = { value: '', focus: () => undefined, select: () => undefined };
			if (tag === 'textarea') reportFields.push(el);
			return el;
		},
	};
	class MockModal {
		contentEl = contentEl;
		setTitle(): void {}
		open(): void { calls.opened += 1; }
		onClose(): void {}
		close(): void { this.onClose(); }
	}
	class MockSetting {
		addButton(callback: (button: object) => unknown): this {
			let label = '';
			const button = {
				setButtonText(value: string) { label = value; return this; },
				setCta() { return this; },
				setDisabled() { return this; },
				onClick(action: () => unknown) { clicks.set(label, action); return this; },
			};
			callback(button);
			return this;
		}
	}
	const module = { exports: {} };
	runInNewContext(await bundle, {
		module,
		require: () => ({
			apiVersion: '1.13.8',
			Platform: { isAndroidApp: true, isIosApp: false, isMobile: true },
			Modal: MockModal, Setting: MockSetting, Notice: class {},
		}),
	});
	return {
		api: module.exports as DiagnosticsModule,
		doc, calls, reportFields, clicks,
		app: { vault: { create: () => { calls.vaultWrites += 1; return Promise.resolve(); } } },
		closeViewer: () => { viewerOpen = false; },
		resize: (nextWidth: number) => { width = nextWidth; },
	};
}

void test('diagnostics distinguish runtime build from a stale manifest without sending or saving automatically', async () => {
	const h = await harness({ capabilities: true, visual: true, stylesheetVersion: '0.0.1-stale-stylesheet' });
	h.api.openGalleryDiagnostics(h.app, '0.0.0-stale-manifest');
	const report = JSON.parse(h.reportFields[0]!.value!) as DiagnosticReport;
	assert.equal(report.buildVersion, h.api.GALLERY_BUILD_VERSION);
	assert.notEqual(report.buildVersion, report.manifestVersion);
	assert.equal(report.manifestVersion, '0.0.0-stale-manifest');
	assert.equal(report.stylesheetVersion, '0.0.1-stale-stylesheet');
	assert.notEqual(report.stylesheetVersion, report.buildVersion);
	assert.notEqual(report.stylesheetVersion, report.manifestVersion);
	assert.equal(report.obsidianApiVersion, '1.13.8');
	assert.equal(h.calls.opened, 1);
	assert.equal(h.calls.clipboard, 0);
	assert.equal(h.calls.vaultWrites, 0);
	assert.ok(h.clicks.has('Copy report'));
	assert.ok(h.clicks.has('Save report to vault'));
});

void test('diagnostics report only geometry and playback state, never content, URLs, filenames or error messages', async () => {
	const h = await harness({ capabilities: true });
	const report = h.api.collectGalleryDiagnostics(h.doc, '0.8.3');
	const json = JSON.stringify(report);
	assert.equal(json.includes(secret), false);
	for (const privateKey of ['fileName', 'path', 'src', 'currentSrc', 'textContent', 'errorMessage', 'dataset']) {
		assert.equal(json.includes(`"${privateKey}"`), false);
	}
	assert.equal(report.currentViewer?.nodes.media?.width, 388);
	assert.equal(report.currentViewer?.informationOpen, true);
	assert.equal(report.currentViewer?.controlsVisible, true);
	assert.equal(report.currentViewer?.video?.duration, null);
	assert.equal(report.currentViewer?.video?.errorCode, 4);
	assert.equal(report.currentViewer?.video?.controls, true);
	assert.equal(report.currentViewer?.video?.playsInline, true);
	assert.equal(report.currentViewer?.video?.seeking, false);
	assert.equal(report.currentViewer?.video?.currentTime, 0);
	assert.equal(h.calls.probesAdded, 1);
	assert.equal(h.calls.probesRemoved, 1);
});

void test('last viewer snapshot survives close and reflects the latest measured bounds', async () => {
	const h = await harness();
	h.api.captureGalleryViewerDiagnostics(h.doc);
	h.resize(915);
	const current = h.api.collectGalleryDiagnostics(h.doc, '0.8.3');
	assert.equal(current.currentViewer?.viewport.width, 915);
	assert.equal(current.lastViewer?.viewport.width, 915);
	h.closeViewer();
	h.api.captureGalleryViewerDiagnostics(h.doc);
	const closed = h.api.collectGalleryDiagnostics(h.doc, '0.8.3');
	assert.equal(closed.currentViewer, null);
	assert.equal(closed.lastViewer?.viewport.width, 915);
	assert.equal(JSON.stringify(closed.lastViewer), JSON.stringify(current.lastViewer));
});

void test('all four inset sides are reported and missing browser capabilities or viewer are handled safely', async () => {
	const h = await harness({ viewer: false });
	const report = h.api.collectGalleryDiagnostics(h.doc, '0.8.3');
	assert.equal(JSON.stringify(report.environmentInsets), JSON.stringify({ top: '25px', right: '1px', bottom: '49px', left: '5px' }));
	assert.equal(JSON.stringify(report.obsidianInsets), JSON.stringify({ top: '24px', right: '0px', bottom: '48px', left: '4px' }));
	assert.equal(JSON.stringify(report.capabilities), JSON.stringify({ nativeAndroidFileChooser: false, webShare: false, webCanShare: false, clipboard: false, videoFrameCallback: false, h264: '', vp9: '', hevc: '' }));
	assert.equal(report.viewport.visual, null);
	assert.equal(report.stylesheetVersion, null);
	assert.equal(report.currentViewer, null);
	assert.equal(report.lastViewer, null);
	assert.equal(report.theme, 'dark');
});

void test('diagnostics return an owned modal that releases its report and notifies close without saving', async () => {
	const h = await harness();
	const closed: object[] = [];
	const modal = h.api.openGalleryDiagnostics(h.app, 'test', value => closed.push(value));
	modal.close();
	assert.equal(closed[0], modal);
	assert.equal(h.calls.emptied, 1);
	assert.equal(h.calls.vaultWrites, 0);
	assert.equal(h.calls.clipboard, 0);
});
