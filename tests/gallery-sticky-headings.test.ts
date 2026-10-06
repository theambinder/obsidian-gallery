import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const stylesheet = readFileSync('styles.css', 'utf8');
const stickyStyles = stylesheet.slice(stylesheet.indexOf('/* Keep the current section in view'));

void test('sticky headings use one native summary row, independent of hierarchy depth', () => {
	assert.match(stickyStyles, /\.section-gallery-view \.section-gallery-section-header \{[^}]*position: sticky;[^}]*inset-block-start: 0;/u);
	assert.doesNotMatch(stickyStyles, /--section-gallery-depth/u);
	assert.match(stickyStyles, /scroll-padding-block-start: max\(30px, 2em\)/u);
	assert.match(stickyStyles, /isolation: isolate/u);
	const headerRule = stickyStyles.match(/\.section-gallery-view \.section-gallery-section-header \{([^}]*)\}/u)?.[1] ?? '';
	assert.match(headerRule, /z-index: 2/u);
	assert.match(headerRule, /background-color: var\(--section-gallery-sticky-background, var\(--background-secondary\)\)/u);
	assert.doesNotMatch(headerRule, /pointer-events:\s*none/u);
	assert.doesNotThrow(() => transformSync(stylesheet, { loader: 'css' }));
});

void test('nested sibling summaries hand off without a margin exposing their sticky ancestor', () => {
	const nestedSectionRule = stylesheet.match(/\.section-gallery-view \.section-gallery-section \.section-gallery-section \{([^}]*)\}/u)?.[1] ?? '';
	// A 2px top margin exposed the parent's text throughout the 30px handoff,
	// even though either child's summary was correct once fully pinned.
	assert.match(nestedSectionRule, /margin-block: 0;/u);
	assert.doesNotMatch(nestedSectionRule, /margin(?:-block-start|-top)?:\s*(?!0(?:px)?;)/u);
	assert.doesNotMatch(stickyStyles, /(?:gap|row-gap):\s*[1-9]/u);
});

void test('sticky search and hover highlights retain an opaque native theme background', () => {
	assert.match(stickyStyles, /body\.is-mobile \.section-gallery-view \{[^}]*--section-gallery-sticky-background: var\(--section-gallery-mobile-background\)/u);
	for (const selector of ['is-search-match', 'hover']) {
		const expression = new RegExp(`section-gallery-section-header[.:]${selector} \\{[^}]*background-color: var\\(--section-gallery-sticky-background, var\\(--background-secondary\\)\\);[^}]*background-image: linear-gradient`, 'u');
		assert.match(stickyStyles, expression);
	}
});

void test('phone drawer sticky headers override native floating top padding without removing safe areas', () => {
	assert.match(stickyStyles, /body\.is-mobile\.is-floating-nav\.is-phone\s+\.workspace-drawer\s+\.workspace-leaf-content\.section-gallery-view\s+\.nav-header ~ div\.section-gallery-content:last-child \{\s*padding-top: 0;\s*\}/u);
	assert.match(stickyStyles, /body\.is-mobile\.is-phone\s+\.workspace-drawer\s+\.section-gallery-view:not\(\.is-search-open\)\s+\.section-gallery-summary \{\s*padding-top: 0;\s*\}/u);
	assert.doesNotMatch(stickyStyles, /\.workspace-drawer-inner\s*\{/u);
	assert.doesNotMatch(stickyStyles, /padding-bottom: 0|padding:\s*0[;\s}]/u);
});
