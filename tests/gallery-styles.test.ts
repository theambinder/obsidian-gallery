import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const stylesheet = readFileSync('styles.css', 'utf8');
const rules = Array.from(stylesheet.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu));

function rule(selector: string, contains = ''): string {
	return rules.find(([, selectors, declarations]) =>
		declarations?.includes(contains) && selectors?.split(',').some(candidate => candidate.trim().replace(/\s+/gu, ' ') === selector),
	)?.[2] ?? '';
}

void test('gallery styling uses explicit local state without broad relational selectors', () => {
	assert.doesNotMatch(stylesheet, /:has\(/u);
	assert.match(rule('body:not(.is-mobile) .section-gallery-view.has-keyboard-focus .section-gallery-tile.is-last-viewed:not(:focus-visible)'), /outline-color: transparent;/u);
	assert.match(rule('.section-gallery-view .section-gallery-tile.has-video-duration .section-gallery-search-filename'), /top: 4px;[\s\S]*bottom: auto;/u);
	assert.match(rule('.section-gallery-view .section-gallery-search-filename'), /bottom: 4px;/u);
});

void test('lightbox keeps a vh fallback and opts into dynamic viewport height without duplicate declarations', () => {
	const base = rule('.modal.section-gallery-lightbox', 'height: 100vh;');
	assert.match(base, /height: 100vh;/u);
	assert.match(base, /max-height: 100vh;/u);
	assert.doesNotMatch(base, /100dvh;(?:\s|$)/u);
	assert.equal(Array.from(base.matchAll(/(?:^|\n)\s*height:/gu)).length, 1);
	assert.equal(Array.from(base.matchAll(/(?:^|\n)\s*max-height:/gu)).length, 1);
	assert.match(stylesheet, /@supports \(height: 100dvh\)\s*\{\s*\.modal\.section-gallery-lightbox\s*\{\s*height: 100dvh;\s*max-height: 100dvh;/u);
	assert.doesNotThrow(() => transformSync(stylesheet, { loader: 'css' }));
});

void test('metadata grid retains zero row gap and sixteen-pixel column spacing', () => {
	const metadata = rule('.modal.section-gallery-lightbox .section-gallery-lightbox-info-list');
	assert.match(metadata, /display: grid;/u);
	assert.match(metadata, /grid-template-columns: minmax\(92px, 0\.28fr\) minmax\(0, 1fr\);/u);
	assert.match(metadata, /gap: 0 16px;/u);
	assert.doesNotMatch(metadata, /column-gap:/u);
});

void test('desktop metadata height stays compact on large windows without changing mobile limits', () => {
	const desktop = rule('body:not(.is-mobile) .modal.section-gallery-lightbox', '--section-gallery-info-height:');
	assert.match(desktop, /--section-gallery-info-height: min\(32vh, 248px\);/u);
	assert.match(desktop, /--section-gallery-info-height: min\(32dvh, 248px\);/u);
	assert.match(rule('.modal.section-gallery-lightbox', 'min(44vh'), /min\(44vh, 360px\)/u);
	assert.match(rule('.modal.section-gallery-lightbox .section-gallery-lightbox-info-scroll'), /overflow-y: auto;/u);
	const scroll = rule('body:not(.is-mobile) .modal.section-gallery-lightbox .section-gallery-lightbox-info-scroll');
	assert.match(scroll, /bottom: calc\(52px \+ var\(--section-gallery-safe-bottom\)\);/u);
	assert.match(scroll, /padding-top: 10px;/u);
	assert.match(scroll, /padding-bottom: 6px;/u);
});

void test('filmstrip keyboard focus never draws a ring while control buttons keep their focus indicator', () => {
	for (const state of ['focus', 'focus-visible']) {
		const item = rule(`.modal.section-gallery-lightbox button.section-gallery-filmstrip-item:${state}`);
		assert.match(item, /outline: 0;/u);
		assert.match(item, /outline-offset: 0;/u);
		assert.match(item, /box-shadow: none;/u);
	}
	assert.match(rule('.modal.section-gallery-lightbox button:focus-visible'), /outline: 2px solid/u);
});

void test('cached previews skip only the opacity fade while filmstrip geometry still animates', () => {
	for (const selector of [
		'.section-gallery-view .section-gallery-tile.is-cached-preview',
		'.modal.section-gallery-lightbox .section-gallery-filmstrip-item.is-cached-preview',
	]) {
		const cached = rule(selector);
		assert.match(cached, /--section-gallery-thumbnail-fade-duration: 0ms;/u);
		assert.doesNotMatch(cached, /transition: none;/u);
	}
	const image = rule('.section-gallery-view .section-gallery-thumbnail');
	assert.match(image, /transition: opacity var\(--section-gallery-thumbnail-fade-duration, 120ms\) ease-out;/u);
	const strip = rule('.modal.section-gallery-lightbox .section-gallery-filmstrip-thumbnail');
	assert.match(strip, /opacity var\(--section-gallery-thumbnail-fade-duration, 120ms\) ease-out;/u);
	for (const property of ['top', 'right', 'bottom', 'left', 'width', 'height']) {
		assert.match(strip, new RegExp(`${property} var\\(--section-gallery-selection-duration\\)`, 'u'));
	}
});

void test('filmstrip separators retain the original narrow vertical lines on desktop and phones', () => {
	const separator = rule('.modal.section-gallery-lightbox .section-gallery-filmstrip-separator');
	assert.match(separator, /width: 4px;/u);
	assert.match(separator, /height: 42px;/u);
	assert.match(separator, /min-width: 4px;/u);
	assert.match(separator, /margin: 0 14px;/u);
	assert.match(separator, /flex: 0 0 auto;/u);
	assert.match(separator, /border-radius: 999px;/u);
	assert.match(separator, /background: var\(--section-gallery-filmstrip-separator-color\);/u);
	const phone = rule('body.is-phone .modal.section-gallery-lightbox .section-gallery-filmstrip-separator');
	assert.match(phone, /height: 34px;/u);
	assert.match(phone, /margin-right: 12px;/u);
	assert.match(phone, /margin-left: 12px;/u);
});

void test('desktop fit uses actual compact header and filmstrip heights with equal breathing gaps', () => {
	const desktop = rule('body:not(.is-mobile) .modal.section-gallery-lightbox', '--section-gallery-desktop-header-top:');
	assert.match(desktop, /--section-gallery-desktop-header-top: 6px;/u);
	assert.match(desktop, /--section-gallery-desktop-stage-gap: 22px;/u);
	assert.match(desktop, /--section-gallery-desktop-filmstrip-bottom: calc\(60px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const header = rule('body:not(.is-mobile) .modal.section-gallery-lightbox .section-gallery-lightbox-header');
	assert.match(header, /top: var\(--section-gallery-desktop-header-top\);/u);
	assert.match(header, /min-height: 36px;/u);
	const stage = rule('body:not(.is-mobile) .modal.section-gallery-lightbox .section-gallery-lightbox-stage');
	assert.match(stage, /bottom: var\(--section-gallery-desktop-panel-offset\);/u);
	assert.match(stage, /padding-top: calc\(\s*var\(--section-gallery-desktop-header-top\) \+\s*var\(--section-gallery-desktop-header-height, 36px\) \+\s*var\(--section-gallery-desktop-stage-gap\)\s*\);/u);
	assert.match(stage, /padding-bottom: calc\(\s*var\(--section-gallery-desktop-filmstrip-bottom\) \+\s*var\(--section-gallery-desktop-filmstrip-height, 54px\) \+\s*var\(--section-gallery-desktop-stage-gap\)\s*\);/u);
	assert.doesNotMatch(stylesheet, /padding-top: calc\(86px \+ var\(--titlebar-height/u);
	assert.equal(rule('body.mod-macos:not(.is-fullscreen):not(.is-mobile) .modal.section-gallery-lightbox .section-gallery-lightbox-stage'), '', 'No old high-specificity macOS padding overrides the compact stage');
	assert.match(rule('.modal.section-gallery-lightbox .section-gallery-lightbox-page-preview'), /padding: inherit;/u);
});

void test('desktop metadata and short windows share chrome coordinates while hidden UI restores full bounds', () => {
	const info = rule('body:not(.is-mobile) .modal.section-gallery-lightbox.is-info-open');
	assert.match(info, /--section-gallery-desktop-panel-offset: var\(--section-gallery-info-height\);/u);
	assert.match(info, /--section-gallery-desktop-filmstrip-bottom: 12px;/u);
	assert.match(rule('body:not(.is-mobile) .modal.section-gallery-lightbox .section-gallery-lightbox-bottom'), /bottom: calc\(\s*var\(--section-gallery-desktop-panel-offset\) \+\s*var\(--section-gallery-desktop-filmstrip-bottom\)\s*\);/u);
	// The desktop body's selector is stronger than legacy compact-window rules,
	// including metadata-open ones; no viewport-dependent titlebar reserve.
	assert.match(stylesheet, /@media \(max-height: 560px\)/u);
	const hidden = rule('body .modal.section-gallery-lightbox.is-ui-hidden .section-gallery-lightbox-stage');
	assert.match(hidden, /bottom: 0;/u);
	assert.match(hidden, /padding-top: var\(--section-gallery-safe-top\);/u);
	assert.match(hidden, /padding-bottom: var\(--section-gallery-safe-bottom\);/u);
	assert.ok(stylesheet.indexOf('body .modal.section-gallery-lightbox.is-ui-hidden .section-gallery-lightbox-stage') > stylesheet.indexOf('--section-gallery-desktop-stage-gap: 22px;'), 'Equal-specificity hidden UI override must follow desktop fit');
	// Verify the equations used by desktop CSS for every relevant geometry.
	for (const [windowHeight, headerHeight, filmstripHeight, panelHeight] of [
		[1030, 36, 54, 0], [420, 36, 54, 0],
		[1030, 48, 54, 248], [420, 48, 54, 142],
	] as const) {
		const filmstripBottom = panelHeight ? 12 : 60;
		const headerBottom = 6 + headerHeight;
		const filmstripTop = windowHeight - panelHeight - filmstripBottom - filmstripHeight;
		const stageTop = headerBottom + 22;
		const stageBottom = filmstripTop - 22;
		assert.equal(stageTop - headerBottom, filmstripTop - stageBottom);
		assert.equal((stageTop + stageBottom) / 2, (headerBottom + filmstripTop) / 2);
	}
});

void test('mobile portrait trims chrome spacing without shifting the hidden UI center', () => {
	const mobile = rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-stage', '124px');
	assert.match(mobile, /padding-top: calc\(124px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(mobile, /padding-bottom: calc\(124px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const mobileInfo = rule('body.is-mobile .modal.section-gallery-lightbox.is-info-open .section-gallery-lightbox-stage', '82px');
	assert.match(mobileInfo, /padding-top: calc\(82px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(mobileInfo, /padding-bottom: calc\(82px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const hidden = rule('body .modal.section-gallery-lightbox.is-ui-hidden .section-gallery-lightbox-stage');
	assert.match(hidden, /padding-top: var\(--section-gallery-safe-top\);/u);
	assert.match(hidden, /padding-bottom: var\(--section-gallery-safe-bottom\);/u);
	assert.match(rule('body.is-mobile .modal.section-gallery-lightbox.is-info-open.is-ui-hidden .section-gallery-lightbox-stage'), /bottom: var\(--section-gallery-info-height\);/u);
	// Symmetric chrome reserves cancel from the center equation, including the
	// compact portrait reserve and a panel that stays open while hidden.
	for (const [height, safeTop, safeBottom, panelHeight, reserve] of [
		[844, 59, 34, 0, 124], [844, 59, 34, 360, 82],
		[800, 24, 48, 0, 124], [800, 24, 48, 352, 82],
		[520, 24, 48, 0, 114], [520, 24, 48, 150, 70],
		[540, 0, 20, 0, 118], [540, 0, 20, 150, 74],
	] as const) {
		const visibleCenter = (safeTop + reserve + height - panelHeight - safeBottom - reserve) / 2;
		const hiddenCenter = (safeTop + height - panelHeight - safeBottom) / 2;
		assert.equal(visibleCenter, hiddenCenter);
	}
});

void test('mobile portrait carousel clears 44px controls and the fit stage with full safe insets', () => {
	assert.match(rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-bottom', '56px'), /bottom: calc\(56px \+ var\(--section-gallery-safe-bottom\)\);/u);
	assert.match(rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-footer', '8px'), /bottom: calc\(8px \+ var\(--section-gallery-safe-bottom\)\);/u);
	assert.match(rule('body.is-mobile .modal.section-gallery-lightbox.is-info-open .section-gallery-lightbox-bottom', '--section-gallery-info-height'), /bottom: calc\(var\(--section-gallery-info-height\) \+ 12px\);/u);
	assert.match(rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-info-scroll', '52px'), /bottom: calc\(52px \+ var\(--section-gallery-safe-bottom\)\);/u);
	assert.match(rule('.modal.section-gallery-lightbox button'), /width: 44px;\s*height: 44px;/u);
	assert.match(rule('.modal.section-gallery-lightbox .section-gallery-lightbox-footer'), /height: 44px;/u);
	assert.match(rule('.modal.section-gallery-lightbox .section-gallery-lightbox-filmstrip-viewport'), /height: calc\(var\(--section-gallery-filmstrip-item-height\) \+ 6px\);/u);
	assert.match(rule('body.is-phone .modal.section-gallery-lightbox .section-gallery-lightbox-filmstrip-viewport'), /--section-gallery-filmstrip-item-height: 44px;/u);
	const compactPhone = rule('body.is-phone .modal.section-gallery-lightbox .section-gallery-lightbox-stage', '114px');
	assert.match(compactPhone, /padding-top: calc\(114px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(compactPhone, /padding-bottom: calc\(114px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const compactTablet = rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-stage', '118px');
	assert.match(compactTablet, /padding-top: calc\(118px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(compactTablet, /padding-bottom: calc\(118px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const compactPhoneInfo = rule('body.is-phone .modal.section-gallery-lightbox.is-info-open .section-gallery-lightbox-stage', '70px');
	assert.match(compactPhoneInfo, /padding-top: calc\(70px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(compactPhoneInfo, /padding-bottom: calc\(70px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const compactTabletInfo = rule('body.is-mobile .modal.section-gallery-lightbox.is-info-open .section-gallery-lightbox-stage', '74px');
	assert.match(compactTabletInfo, /padding-top: calc\(74px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(compactTabletInfo, /padding-bottom: calc\(74px \+ var\(--section-gallery-safe-bottom\)\);/u);
	for (const side of ['top', 'right', 'bottom', 'left']) {
		assert.ok(rule('body.is-mobile .modal.section-gallery-lightbox', `--section-gallery-safe-${side}:`).includes(`--section-gallery-safe-${side}: max(env(safe-area-inset-${side}, 0px), var(--safe-area-inset-${side}, 0px));`));
	}
	// Short portrait previously put the fit stage under the carousel. Its
	// smaller symmetric reserve now leaves the same intentional 8px clearance.
	for (const [height, safeTop, safeBottom, filmstripHeight, reserve] of [
		[844, 59, 34, 50, 124], [800, 24, 48, 50, 124], [1024, 24, 20, 54, 124],
		[520, 24, 48, 50, 114], [540, 0, 20, 54, 118], [360, 24, 48, 50, 114],
		[340, 24, 48, 50, 114],
	] as const) {
		const footerTop = height - safeBottom - 8 - 44;
		const filmstripBottom = height - safeBottom - 56;
		const filmstripTop = filmstripBottom - filmstripHeight;
		const fitBottom = height - safeBottom - reserve;
		assert.equal(footerTop - filmstripBottom, 4, 'Carousel keeps clearance for the button focus ring');
		assert.ok(filmstripTop - fitBottom >= 8, 'Actual media/native controls stay above the carousel');
		assert.ok(safeTop + reserve < fitBottom, 'The portrait fit stage has positive height');
		const panelHeight = height <= 560 ? Math.min(height * 0.34, 150) : Math.min(height * 0.44, 360);
		const metadataReserve = height <= 560 ? 12 + filmstripHeight + 8 : 82;
		const metadataFitBottom = height - panelHeight - safeBottom - metadataReserve;
		const metadataCarouselTop = height - panelHeight - 12 - filmstripHeight;
		assert.ok(metadataCarouselTop - metadataFitBottom >= 8);
		assert.ok(safeTop + metadataReserve < metadataFitBottom, 'Short portrait metadata retains a positive fit height');
		assert.ok(metadataReserve >= 8 + 54 + 8, 'Metadata fit still clears the Android header hit targets');
		assert.equal(52, 8 + 44, 'Metadata scrolling ends above the footer hit targets');
	}
});

void test('compact mobile landscape and Android system-bar protection remain intact', () => {
	const geometry = rule('body.is-mobile .modal.section-gallery-lightbox', '--section-gallery-landscape-edge-gap:');
	assert.match(geometry, /--section-gallery-landscape-edge-gap: 8px;/u);
	assert.match(geometry, /--section-gallery-landscape-filmstrip-bottom: calc\(\s*44px \+ 2 \* var\(--section-gallery-landscape-edge-gap\) \+\s*var\(--section-gallery-safe-bottom\)\s*\);/u);
	const landscape = rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-stage', '--section-gallery-landscape-stage-top');
	assert.match(landscape, /padding-top: var\(--section-gallery-landscape-stage-top\);/u);
	assert.match(landscape, /padding-bottom: var\(--section-gallery-landscape-stage-bottom\);/u);
	const android = rule('body.is-android .modal.section-gallery-lightbox .section-gallery-lightbox-header');
	assert.match(android, /top: calc\(8px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(android, /right: max\(8px, var\(--section-gallery-safe-right\)\);/u);
	assert.match(android, /left: max\(8px, var\(--section-gallery-safe-left\)\);/u);
	const androidFooter = rule('body.is-android .modal.section-gallery-lightbox .section-gallery-lightbox-footer');
	assert.match(androidFooter, /right: max\(8px, var\(--section-gallery-safe-right\)\);/u);
	assert.match(androidFooter, /left: max\(8px, var\(--section-gallery-safe-left\)\);/u);
	for (const [height, safeTop, safeBottom, filmstripHeight] of [
		[390, 0, 21, 50], [412, 24, 48, 50], [540, 0, 20, 54],
	] as const) {
		const footerTop = height - safeBottom - 8 - 44;
		const filmstripBottom = height - safeBottom - (44 + 2 * 8);
		const filmstripTop = filmstripBottom - filmstripHeight;
		const fitBottom = filmstripTop - 8;
		assert.equal(footerTop - filmstripBottom, 8);
		assert.equal(filmstripTop - fitBottom, 8);
		assert.ok(safeTop + 8 + 54 + 8 < fitBottom);
	}
});

void test('tile-size level has a stable tabular label slot scoped to its setting', () => {
	const value = rule('.section-gallery-tile-scale-setting .slider-value');
	assert.match(value, /min-width: 4ch;/u);
	assert.match(value, /flex: 0 0 4ch;/u);
	assert.match(value, /font-variant-numeric: tabular-nums;/u);
	assert.match(value, /text-align: right;/u);
	assert.equal(rule('.slider-value'), '', 'Do not change native slider labels in other settings');
});

void test('default desktop tile sizing fits four columns in a standard sidebar while mobile keeps its baseline', () => {
	assert.match(rule('.section-gallery-view', '--section-gallery-tile-min:'), /--section-gallery-tile-min: 72px;/u);
	assert.match(rule('body:not(.is-mobile) .section-gallery-view', '--section-gallery-tile-min:'), /--section-gallery-tile-min: 56px;/u);
	assert.equal(rule('body.is-mobile .section-gallery-view', '--section-gallery-tile-min:'), '');
	const grid = rule('.section-gallery-view .section-gallery-grid');
	assert.match(grid, /var\(--section-gallery-tile-min\) \* var\(--section-gallery-tile-scale, 1\)/u);
	assert.match(grid, /auto-fill/u);
	assert.match(grid, /minmax\([\s\S]*1fr\)/u);
	assert.doesNotMatch(grid, /justify-content: center|tile-base-size|tile-size:/u);
	// The standard test-vault sidebar has 261px of usable grid width.
	// Four columns also fit narrower standard panes down to 230px.
	for (const width of [230, 240, 246, 261]) {
		assert.equal(Math.floor((width + 2) / (56 + 2)), 4);
	}
	// The grid remains adaptive, including unusually narrow custom sidebars.
	for (const [width, columns] of [[188, 3], [288, 5], [346, 6]] as const) {
		assert.equal(Math.floor((width + 2) / (56 + 2)), columns);
	}
	assert.equal(Math.floor((261 + 2) / (72 + 2)), 3);
});

void test('desktop toolbar and search keyboard focus use a crisp tile-matching ring without native glow', () => {
	for (const control of ['section-gallery-toolbar-button', 'section-gallery-search-input', 'section-gallery-search-clear']) {
		const selector = `body:not(.is-mobile) .section-gallery-view .${control}`;
		assert.match(rule(`${selector}:focus`), /box-shadow: none;/u);
		const visible = rule(`${selector}:focus-visible`);
		assert.match(visible, /outline: 2px solid var\(--interactive-accent\);/u);
		assert.match(visible, /outline-offset: -2px;/u);
		assert.match(visible, /box-shadow: none;/u);
	}
});

void test('scaled tracks retain full-width rows and the original percentage-based geometry', () => {
	const grid = rule('.section-gallery-view .section-gallery-grid');
	assert.match(grid, /minmax\(min\(calc\(var\(--section-gallery-tile-min\) \* var\(--section-gallery-tile-scale, 1\)\), 100%\), 1fr\)/u);
	for (const [width, baseline, expectedColumns] of [
		[188, 56, 1], [261, 56, 1], [360, 72, 1], [320, 72, 1],
		[800, 56, 2], [1024, 72, 2],
	] as const) {
		const minimum = Math.min(baseline * 5, width);
		const columns = Math.floor((width + 2) / (minimum + 2));
		const tileWidth = (width - (columns - 1) * 2) / columns;
		assert.equal(columns, expectedColumns);
		assert.ok(tileWidth <= width);
		assert.equal(tileWidth * columns + (columns - 1) * 2, width);
	}
});

void test('native tile scaling has no responsive sizing probes or fitted track variables', () => {
	assert.doesNotMatch(stylesheet, /section-gallery-tile-size-probe|--section-gallery-probe-|--section-gallery-tile-base-size/u);
});

void test('desktop tile rings stay inside paint containment and below opaque sticky summaries', () => {
	for (const state of [':focus-visible', '.is-last-viewed', '.is-last-viewed:focus-visible']) {
		const selector = `.section-gallery-view .section-gallery-tile${state}`;
		assert.match(rule(`body:not(.is-mobile) ${selector}`), /outline-offset: -2px;/u);
		assert.match(rule(selector), /outline-offset: 1px;/u, 'Touch keyboard focus retains the existing base rule');
	}
	assert.match(rule('.section-gallery-view .section-gallery-tile:focus-visible'), /z-index: 1;/u);
	const header = rule('.section-gallery-view .section-gallery-section-header', 'position: sticky;');
	assert.match(header, /z-index: 2;/u);
	assert.match(header, /background-color: var\(--section-gallery-sticky-background, var\(--background-secondary\)\);/u);
	assert.match(rule('.section-gallery-view .section-gallery-tile'), /contain: layout paint style;/u);
});

void test('original-fit thumbnails and video frames cap their inset so ten-percent tiles retain media', () => {
	assert.match(rule('.section-gallery-view .section-gallery-tile'), /--section-gallery-effective-fit-inset: min\(var\(--section-gallery-fit-inset\), 10%\);/u);
	for (const selector of [
		'.section-gallery-view .section-gallery-grid.is-fit .section-gallery-thumbnail',
		'.section-gallery-view .section-gallery-grid.is-fit .section-gallery-video-frame',
	]) {
		const fit = rule(selector);
		for (const side of ['top', 'right', 'bottom', 'left']) {
			assert.match(fit, new RegExp(`${side}: var\\(--section-gallery-effective-fit-inset\\);`, 'u'));
		}
		assert.doesNotMatch(fit, /var\(--section-gallery-fit-inset\)/u);
	}
	const thumbnail = rule('.section-gallery-view .section-gallery-grid.is-fit .section-gallery-thumbnail');
	assert.equal(Array.from(thumbnail.matchAll(/var\(--section-gallery-effective-fit-inset\)/gu)).length, 8);
	assert.match(thumbnail, /object-fit: contain;/u);
	for (const tileWidth of [1, 5.6, 7.2, 16.8, 56, 72]) {
		const inset = Math.min(3, tileWidth * 0.1);
		const mediaWidth = tileWidth - 2 * inset;
		assert.ok(mediaWidth > 0);
		assert.ok(mediaWidth >= tileWidth * 0.8 - 1e-10);
	}
});

void test('tiny tile text overlays disappear through local scale math while normal-scale labels stay unchanged', () => {
	const tile = rule('.section-gallery-view .section-gallery-tile');
	assert.match(tile, /--section-gallery-tile-overlay-opacity: clamp\(\s*0,\s*calc\(\(var\(--section-gallery-tile-scale, 1\) - 0\.2\) \* 10\),\s*1\s*\);/u);
	assert.match(tile, /overflow: hidden;/u);
	for (const selector of [
		'.section-gallery-view .section-gallery-search-filename',
		'.section-gallery-view .section-gallery-video-duration',
		'.section-gallery-view .section-gallery-tile.has-error .section-gallery-video-preview-unavailable',
	]) {
		assert.match(rule(selector), /opacity: var\(--section-gallery-tile-overlay-opacity\);/u);
	}
	assert.match(rule('.section-gallery-view .section-gallery-video-duration'), /max-width: max\(0px, calc\(100% - 8px\)\);/u);
	const opacityAt = (scale: number): number => Math.max(0, Math.min((scale / 100 - 0.2) * 10, 1));
	assert.equal(opacityAt(10), 0);
	assert.equal(opacityAt(20), 0);
	assert.ok(opacityAt(30) >= 1 - 1e-10);
	assert.equal(opacityAt(100), 1);
	assert.equal(opacityAt(180), 1);
});

void test('native iOS still anchors remain invisible above loaded thumbnail cascade without important', () => {
	assert.doesNotMatch(stylesheet, /!important/u);
	for (const [loadedSelector, anchorSelector] of [
		['.section-gallery-view .section-gallery-tile.is-loaded .section-gallery-thumbnail', '.section-gallery-view .section-gallery-tile img.section-gallery-thumbnail.section-gallery-native-preview-anchor'],
		['.modal.section-gallery-lightbox .section-gallery-filmstrip-item.is-loaded .section-gallery-filmstrip-thumbnail', '.modal.section-gallery-lightbox .section-gallery-filmstrip-item img.section-gallery-filmstrip-thumbnail.section-gallery-native-preview-anchor'],
	] as const) {
		assert.match(rule(loadedSelector), /opacity: 1;/u);
		const anchorRule = rules.find(([, selectors]) => selectors?.split(',').some(selector => selector.trim().replace(/\s+/gu, ' ') === anchorSelector));
		assert.ok(anchorRule, `missing anchor rule for ${anchorSelector}`);
		assert.match(anchorRule[2]!, /opacity: 0;/u);
		// These selectors have no functional pseudos. Equal class counts plus
		// the image type selector makes the anchor override more specific, even
		// if the loaded state comes later or the filmstrip is mid-swipe.
		const classCount = (selector: string): number => Array.from(selector.matchAll(/\.[\w-]+/gu)).length;
		assert.equal(classCount(anchorSelector), classCount(loadedSelector));
		assert.match(anchorSelector, /\simg\./u);
	}
	assert.match(rule('.modal.section-gallery-lightbox img.section-gallery-native-preview-anchor'), /opacity: 0;/u);
});
