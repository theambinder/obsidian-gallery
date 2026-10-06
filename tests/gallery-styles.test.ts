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

void test('desktop centering leaves mobile portrait reserves and landscape safe geometry unchanged', () => {
	const mobile = rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-stage', '132px');
	assert.match(mobile, /padding-top: calc\(132px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(mobile, /padding-bottom: calc\(132px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const mobileInfo = rule('body.is-mobile .modal.section-gallery-lightbox.is-info-open .section-gallery-lightbox-stage', '82px');
	assert.match(mobileInfo, /padding-top: calc\(82px \+ var\(--section-gallery-safe-top\)\);/u);
	assert.match(mobileInfo, /padding-bottom: calc\(82px \+ var\(--section-gallery-safe-bottom\)\);/u);
	const landscape = rule('body.is-mobile .modal.section-gallery-lightbox .section-gallery-lightbox-stage', '--section-gallery-landscape-stage-top');
	assert.match(landscape, /padding-top: var\(--section-gallery-landscape-stage-top\);/u);
	assert.match(landscape, /padding-bottom: var\(--section-gallery-landscape-stage-bottom\);/u);
});

void test('tile-scale percentage has a stable tabular four-character slot scoped to its setting', () => {
	const value = rule('.section-gallery-tile-scale-setting .slider-value');
	assert.match(value, /min-width: 4ch;/u);
	assert.match(value, /flex: 0 0 4ch;/u);
	assert.match(value, /font-variant-numeric: tabular-nums;/u);
	assert.match(value, /text-align: right;/u);
	assert.equal(rule('.slider-value'), '', 'Do not change native slider labels in other settings');
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
