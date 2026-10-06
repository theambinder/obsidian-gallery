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
