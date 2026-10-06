import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildVisibleMediaProjection,
	clearGallerySearchCollapseForNoteChange,
	createGallerySearchExcerpt,
	filterMediaSectionTree,
	normalizeGallerySearchQuery,
	segmentGallerySearchText,
} from '../src/gallery-search';
import { buildMediaIndex, buildMediaSectionTree } from '../src/media-index';
import type {
	EmbedReference,
	HeadingReference,
	MediaFileLike,
} from '../src/types';

const files = new Map<string, MediaFileLike>([
	['intro.png', { extension: 'png', name: 'intro.png', path: 'intro.png' }],
	['poster.jpg', { extension: 'jpg', name: 'poster.jpg', path: 'poster.jpg' }],
	['scene.png', { extension: 'png', name: 'scene.png', path: 'scene.png' }],
	[
		'season-guide.webp',
		{
			extension: 'webp',
			name: 'season-guide.webp',
			path: 'season-guide.webp',
		},
	],
]);

function embed(link: string, offset: number): EmbedReference {
	return {
		link,
		position: { column: 0, line: offset, offset },
	};
}

function heading(
	title: string,
	level: number,
	offset: number,
): HeadingReference {
	return { heading: title, level, position: { offset } };
}

const media = buildMediaIndex(
	[
		embed('intro.png', 5),
		embed('poster.jpg', 20),
		embed('scene.png', 30),
		embed('season-guide.webp', 50),
	],
	[
		heading('Season 1', 2, 10),
		heading('Episode 1', 3, 25),
		heading('Extras', 2, 40),
	],
	(link) => files.get(link) ?? null,
	'No heading',
);
const tree = buildMediaSectionTree(media, 'No heading');

void test('normalizes surrounding whitespace and letter case', () => {
	assert.equal(normalizeGallerySearchQuery('  СЕЗОН  '), 'сезон');
	assert.equal(normalizeGallerySearchQuery('  İ  '), 'i\u0307');
});

void test('marks every matching display substring without changing its case', () => {
	assert.deepEqual(segmentGallerySearchText('Season SEASON', 'season'), [
		{ isMatch: true, text: 'Season' },
		{ isMatch: false, text: ' ' },
		{ isMatch: true, text: 'SEASON' },
	]);
});

void test('treats regex punctuation as literal filename text', () => {
	assert.deepEqual(segmentGallerySearchText('take [final].jpg', '[final].'), [
		{ isMatch: false, text: 'take ' },
		{ isMatch: true, text: '[final].' },
		{ isMatch: false, text: 'jpg' },
	]);
});

void test('maps expanded Unicode lowercase matches back to source ranges', () => {
	assert.deepEqual(segmentGallerySearchText('İmage', 'mage'), [
		{ isMatch: false, text: 'İ' },
		{ isMatch: true, text: 'mage' },
	]);
	assert.deepEqual(segmentGallerySearchText('İx', 'x'), [
		{ isMatch: false, text: 'İ' },
		{ isMatch: true, text: 'x' },
	]);
	assert.deepEqual(segmentGallerySearchText('İx', 'i'), [
		{ isMatch: true, text: 'İ' },
		{ isMatch: false, text: 'x' },
	]);
});

void test('never emits empty or shifted marks after Unicode folding', () => {
	for (const [text, query] of [
		['İmage', 'mage'],
		['İx', 'x'],
		['İİ', 'i'],
	] as const) {
		const segments = segmentGallerySearchText(text, query);
		assert.equal(
			segments.map((segment) => segment.text).join(''),
			text,
		);
		assert.equal(
			segments.some((segment) => segment.isMatch && segment.text.length === 0),
			false,
		);
	}
});

void test('uses the same Unicode fold for filename filtering and highlighting', () => {
	const unicodeFile: MediaFileLike = {
		extension: 'png',
		name: 'İmage.png',
		path: 'İmage.png',
	};
	const unicodeMedia = buildMediaIndex(
		[embed(unicodeFile.path, 1)],
		[],
		(link) => (link === unicodeFile.path ? unicodeFile : null),
		'No heading',
	);
	const unicodeTree = buildMediaSectionTree(unicodeMedia, 'No heading');
	const result = filterMediaSectionTree(unicodeTree, unicodeMedia, 'mage');

	assert.equal(result.visibleItemCount, 1);
	assert.deepEqual([...result.matchedItemIndices], [0]);
	assert.deepEqual(segmentGallerySearchText(unicodeFile.name, 'mage'), [
		{ isMatch: false, text: 'İ' },
		{ isMatch: true, text: 'mage' },
		{ isMatch: false, text: '.png' },
	]);
});

void test('keeps the first match visible in a bounded filename excerpt', () => {
	const filename = 'Apocalypse-Hotel-S01E01-00-02-41.0001.webp';
	const excerpt = createGallerySearchExcerpt(filename, '00-02-41');
	const sourceText = excerpt.segments
		.map((segment) => segment.text)
		.join('');
	const markedText = excerpt.segments
		.filter((segment) => segment.isMatch)
		.map((segment) => segment.text)
		.join('');

	assert.equal(excerpt.leadingEllipsis, true);
	assert.equal(excerpt.trailingEllipsis, true);
	assert.equal(markedText, '00-02-41');
	assert.equal(sourceText.includes('00-02-41'), true);
	assert.equal(sourceText.length <= 16, true);
	assert.equal(sourceText.startsWith('00-02-41'), true);
	assert.equal(sourceText.endsWith('00-02-41'), false);
	assert.equal(excerpt.segments[0]?.isMatch, true);
});

void test('clears transient collapsed keys only when the note path changes', () => {
	const repeatedStructuralKey = 'heading:season-1:0';
	const collapsed = new Set([repeatedStructuralKey]);

	assert.equal(
		clearGallerySearchCollapseForNoteChange(
			'Notes/A.md',
			'Notes/A.md',
			collapsed,
		),
		false,
	);
	assert.deepEqual([...collapsed], [repeatedStructuralKey]);
	assert.equal(
		clearGallerySearchCollapseForNoteChange(
			'Notes/A.md',
			'Notes/B.md',
			collapsed,
		),
		true,
	);
	assert.deepEqual([...collapsed], []);
});

void test('keeps only a filename hit and its unmarked section ancestry', () => {
	const result = filterMediaSectionTree(tree, media, 'scene');

	assert.equal(result.visibleItemCount, 1);
	assert.deepEqual([...result.matchedItemIndices], [2]);
	assert.deepEqual([...result.matchedSectionKeys], []);
	assert.equal(result.tree.itemIndices.length, 0);
	assert.deepEqual(result.tree.children.map((node) => node.title), ['Season 1']);
	assert.deepEqual(result.tree.children[0]?.itemIndices, []);
	assert.equal(result.tree.children[0]?.totalItemCount, 1);
	assert.deepEqual(
		result.tree.children[0]?.children.map((node) => node.title),
		['Episode 1'],
	);
	assert.deepEqual(result.tree.children[0]?.children[0]?.itemIndices, [2]);
});

void test('a direct section-title hit includes its complete subtree', () => {
	const result = filterMediaSectionTree(tree, media, 'episode');
	const season = result.tree.children[0];
	const episode = season?.children[0];

	assert.equal(result.visibleItemCount, 1);
	assert.deepEqual([...result.matchedItemIndices], []);
	assert.deepEqual([...result.matchedSectionKeys], [
		media[2]?.sectionStructuralKey,
	]);
	assert.equal(season?.title, 'Season 1');
	assert.equal(episode?.title, 'Episode 1');
	assert.deepEqual(episode?.itemIndices, [2]);
});

void test('distinguishes a title subtree from an independent filename hit', () => {
	const result = filterMediaSectionTree(tree, media, 'season');

	assert.equal(result.visibleItemCount, 3);
	assert.deepEqual([...result.matchedItemIndices], [3]);
	assert.deepEqual([...result.matchedSectionKeys], [
		media[1]?.sectionStructuralKey,
	]);
	assert.deepEqual(result.tree.children.map((node) => node.title), [
		'Season 1',
		'Extras',
	]);
	assert.equal(result.tree.children[0]?.totalItemCount, 2);
	assert.deepEqual(result.tree.children[1]?.itemIndices, [3]);
});

void test('matching the synthetic root includes only pre-heading media', () => {
	const result = filterMediaSectionTree(tree, media, 'no heading');

	assert.equal(result.visibleItemCount, 1);
	assert.deepEqual(result.tree.itemIndices, [0]);
	assert.deepEqual(result.tree.children, []);
	assert.deepEqual([...result.matchedSectionKeys], ['note-root']);
});

void test('keeps repeated matching section occurrences distinct', () => {
	const repeatedMedia = buildMediaIndex(
		[embed('poster.jpg', 20), embed('scene.png', 40)],
		[heading('Shots', 2, 10), heading('Shots', 2, 30)],
		(link) => files.get(link) ?? null,
		'No heading',
	);
	const repeatedTree = buildMediaSectionTree(repeatedMedia, 'No heading');
	const result = filterMediaSectionTree(repeatedTree, repeatedMedia, 'shots');

	assert.equal(result.visibleItemCount, 2);
	assert.equal(result.tree.children.length, 2);
	assert.deepEqual(result.tree.children.map((node) => node.title), [
		'Shots',
		'Shots',
	]);
	assert.equal(result.matchedSectionKeys.size, 2);
	assert.notEqual(
		result.tree.children[0]?.structuralKey,
		result.tree.children[1]?.structuralKey,
	);
});

void test('returns an empty pruned tree when nothing matches', () => {
	const result = filterMediaSectionTree(tree, media, 'not-present');

	assert.equal(result.visibleItemCount, 0);
	assert.deepEqual(result.tree.itemIndices, []);
	assert.deepEqual(result.tree.children, []);
	assert.deepEqual([...result.matchedItemIndices], []);
	assert.deepEqual([...result.matchedSectionKeys], []);
});

void test('filters 341 items without changing original index order', () => {
	const largeFiles = new Map<string, MediaFileLike>();
	const largeEmbeds = Array.from({ length: 341 }, (_, index) => {
		const name = `frame-${String(index).padStart(3, '0')}.jpg`;
		largeFiles.set(name, { extension: 'jpg', name, path: name });
		return embed(name, index + 1);
	});
	const largeMedia = buildMediaIndex(
		largeEmbeds,
		[],
		(link) => largeFiles.get(link) ?? null,
		'No heading',
	);
	const largeTree = buildMediaSectionTree(largeMedia, 'No heading');
	const result = filterMediaSectionTree(largeTree, largeMedia, 'frame-3');
	const visibleIndices = result.tree.itemIndices;

	assert.equal(largeMedia.length, 341);
	assert.equal(result.visibleItemCount, 41);
	assert.deepEqual(visibleIndices, Array.from({ length: 41 }, (_, i) => i + 300));
	assert.deepEqual([...result.matchedItemIndices], visibleIndices);
	assert.equal(largeTree.totalItemCount, 341);
});

void test('an empty query returns the original unpruned tree', () => {
	const result = filterMediaSectionTree(tree, media, '   ');

	assert.equal(result.tree, tree);
	assert.equal(result.visibleItemCount, media.length);
	assert.deepEqual([...result.matchedItemIndices], []);
	assert.deepEqual([...result.matchedSectionKeys], []);
});

void test('media kind filtering composes with literal search in source order', () => {
	const mixedFiles = new Map<string, MediaFileLike>([
		['poster.png', { extension: 'png', name: 'poster.png', path: 'poster.png' }],
		['scene.mp4', { extension: 'mp4', name: 'scene.mp4', path: 'scene.mp4' }],
		['scene.jpg', { extension: 'jpg', name: 'scene.jpg', path: 'scene.jpg' }],
		['scene.mov', { extension: 'mov', name: 'scene.mov', path: 'scene.mov' }],
	]);
	const mixedMedia = buildMediaIndex(
		[
			embed('poster.png', 1),
			embed('scene.mp4', 2),
			embed('scene.jpg', 3),
			embed('scene.mov', 4),
		],
		[],
		(link) => mixedFiles.get(link) ?? null,
		'No heading',
	);
	const mixedTree = buildMediaSectionTree(mixedMedia, 'No heading');

	const videos = filterMediaSectionTree(
		mixedTree,
		mixedMedia,
		'scene',
		'video',
	);
	assert.deepEqual(videos.visibleItemIndices, [1, 3]);
	assert.deepEqual(videos.tree.itemIndices, [1, 3]);
	assert.deepEqual([...videos.matchedItemIndices], [1, 3]);

	const images = filterMediaSectionTree(mixedTree, mixedMedia, '', 'image');
	assert.deepEqual(images.visibleItemIndices, [0, 2]);
	assert.deepEqual(images.tree.itemIndices, [0, 2]);
	assert.deepEqual([...images.matchedItemIndices], []);
});

void test('returns no projection entries when the selected kind is absent', () => {
	const result = filterMediaSectionTree(tree, media, '', 'video');
	assert.equal(result.visibleItemCount, 0);
	assert.deepEqual(result.visibleItemIndices, []);
	assert.deepEqual(result.tree.itemIndices, []);
	assert.deepEqual(result.tree.children, []);
});

void test('builds a viewer snapshot with a local index and original mapping', () => {
	const projection = buildVisibleMediaProjection(
		['zero', 'one', 'two', 'three'],
		[1, 3],
		3,
	);
	assert.deepEqual(projection, {
		initialIndex: 1,
		items: ['one', 'three'],
		originalIndices: [1, 3],
	});
	assert.equal(
		buildVisibleMediaProjection(['zero', 'one'], [1], 0),
		null,
	);
});
