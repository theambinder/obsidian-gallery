import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildMediaIndex,
	buildMediaSectionTree,
	classifyMediaExtension,
} from '../src/media-index';
import type {
	EmbedReference,
	HeadingReference,
	MediaFileLike,
} from '../src/types';

const files = new Map<string, MediaFileLike>([
	['photo.png', { extension: 'png', name: 'photo.png', path: 'photo.png' }],
	['clip.mp4', { extension: 'mp4', name: 'clip.mp4', path: 'clip.mp4' }],
	['note.md', { extension: 'md', name: 'note.md', path: 'note.md' }],
]);

function embed(link: string, offset: number): EmbedReference {
	return {
		link,
		position: { offset, line: offset, column: 0 },
	};
}

function heading(
	headingText: string,
	level: number,
	offset: number,
): HeadingReference {
	return {
		heading: headingText,
		level,
		position: { offset },
	};
}

const resolve = (link: string): MediaFileLike | null => files.get(link) ?? null;

void test('classifies supported image and video extensions', () => {
	assert.equal(classifyMediaExtension('WEBP'), 'image');
	assert.equal(classifyMediaExtension('heic'), 'image');
	assert.equal(classifyMediaExtension('Mp4'), 'video');
	assert.equal(classifyMediaExtension('pdf'), null);
});

void test('sorts embeds and assigns the nearest heading', () => {
	const result = buildMediaIndex(
		[embed('clip.mp4', 40), embed('photo.png', 5)],
		[heading('Later', 2, 30)],
		resolve,
		'No heading',
	);

	assert.deepEqual(
		result.map((item) => [item.file.name, item.sectionTitle]),
		[
			['photo.png', 'No heading'],
			['clip.mp4', 'Later'],
		],
	);
});

void test('builds section breadcrumbs for nested headings', () => {
	const result = buildMediaIndex(
		[embed('photo.png', 35), embed('clip.mp4', 55)],
		[
			heading('Chapter', 1, 10),
			heading('Scene', 3, 30),
			heading('Next chapter', 1, 50),
		],
		resolve,
		'No heading',
	);

	assert.equal(result[0]?.sectionTitle, 'Chapter › Scene');
	assert.equal(result[1]?.sectionTitle, 'Next chapter');
});

void test('retains complete H1-H6 ancestry with keys for every level', () => {
	const headings = Array.from({ length: 6 }, (_, index) =>
		heading(`Level ${index + 1}`, index + 1, (index + 1) * 10),
	);
	const [item] = buildMediaIndex(
		[embed('photo.png', 70)],
		headings,
		resolve,
		'No heading',
	);

	assert.deepEqual(
		item?.sectionPath.map((entry) => [entry.level, entry.title]),
		[
			[1, 'Level 1'],
			[2, 'Level 2'],
			[3, 'Level 3'],
			[4, 'Level 4'],
			[5, 'Level 5'],
			[6, 'Level 6'],
		],
	);
	assert.equal(
		new Set(item?.sectionPath.map((entry) => entry.renderKey)).size,
		6,
	);
	assert.equal(
		new Set(item?.sectionPath.map((entry) => entry.structuralKey)).size,
		6,
	);
	assert.equal(
		item?.sectionRenderKey,
		item?.sectionPath[item.sectionPath.length - 1]?.renderKey,
	);
	assert.equal(
		item?.sectionStructuralKey,
		item?.sectionPath[item.sectionPath.length - 1]?.structuralKey,
	);
});

void test('preserves hierarchy when heading levels are skipped', () => {
	const result = buildMediaIndex(
		[embed('photo.png', 30), embed('clip.mp4', 60)],
		[
			heading('Chapter', 1, 10),
			heading('Deep scene', 4, 20),
			heading('Section', 2, 40),
			heading('Deep detail', 6, 50),
		],
		resolve,
		'No heading',
	);

	assert.deepEqual(
		result.map((item) =>
			item.sectionPath.map((entry) => [entry.level, entry.title]),
		),
		[
			[
				[1, 'Chapter'],
				[4, 'Deep scene'],
			],
			[
				[1, 'Chapter'],
				[2, 'Section'],
				[6, 'Deep detail'],
			],
		],
	);
});

void test('keeps repeated headings and repeated embeds as distinct occurrences', () => {
	const result = buildMediaIndex(
		[embed('photo.png', 20), embed('photo.png', 40)],
		[heading('Shots', 2, 10), heading('Shots', 2, 30)],
		resolve,
		'No heading',
	);

	assert.equal(result.length, 2);
	assert.notEqual(result[0]?.id, result[1]?.id);
	assert.notEqual(result[0]?.sectionKey, result[1]?.sectionKey);
	assert.notEqual(
		result[0]?.sectionStructuralKey,
		result[1]?.sectionStructuralKey,
	);
});

void test('distinguishes duplicate sibling titles under the same parent', () => {
	const result = buildMediaIndex(
		[embed('photo.png', 25), embed('clip.mp4', 45)],
		[
			heading('Chapter', 1, 10),
			heading('Shots', 3, 20),
			heading('Shots', 3, 40),
		],
		resolve,
		'No heading',
	);

	assert.equal(result[0]?.sectionTitle, 'Chapter › Shots');
	assert.equal(result[1]?.sectionTitle, 'Chapter › Shots');
	assert.notEqual(result[0]?.sectionRenderKey, result[1]?.sectionRenderKey);
	assert.notEqual(
		result[0]?.sectionStructuralKey,
		result[1]?.sectionStructuralKey,
	);
	assert.equal(
		result[0]?.sectionPath[0]?.structuralKey,
		result[1]?.sectionPath[0]?.structuralKey,
	);
});

void test('keeps structural keys stable when source offsets move', () => {
	const before = buildMediaIndex(
		[embed('photo.png', 25), embed('clip.mp4', 45)],
		[
			heading('Chapter', 1, 10),
			heading('Shots', 2, 20),
			heading('Shots', 2, 40),
		],
		resolve,
		'No heading',
	);
	const after = buildMediaIndex(
		[embed('photo.png', 125), embed('clip.mp4', 145)],
		[
			heading('Chapter', 1, 110),
			heading('Shots', 2, 120),
			heading('Shots', 2, 140),
		],
		resolve,
		'No heading',
	);

	assert.deepEqual(
		before.map((item) => item.sectionStructuralKey),
		after.map((item) => item.sectionStructuralKey),
	);
	assert.notDeepEqual(
		before.map((item) => item.sectionRenderKey),
		after.map((item) => item.sectionRenderKey),
	);
});

void test('uses the synthetic root for media before the first heading', () => {
	const [item] = buildMediaIndex(
		[embed('photo.png', 5)],
		[heading('Later', 1, 10)],
		resolve,
		'No heading',
	);

	assert.deepEqual(item?.sectionPath, []);
	assert.equal(item?.sectionRenderKey, 'note-root');
	assert.equal(item?.sectionStructuralKey, 'note-root');
	assert.equal(item?.sectionTitle, 'No heading');
});

void test('skips unresolved links and unsupported embeds', () => {
	const result = buildMediaIndex(
		[
			embed('missing.jpg', 10),
			embed('note.md', 20),
			embed('photo.png', 30),
		],
		[],
		resolve,
		'No heading',
	);

	assert.deepEqual(result.map((item) => item.file.name), ['photo.png']);
});

void test('indexes a large note without changing occurrence order', () => {
	const embeds = Array.from({ length: 5_000 }, (_, index) =>
		embed(index % 2 === 0 ? 'photo.png' : 'clip.mp4', index),
	);
	const result = buildMediaIndex(embeds.reverse(), [], resolve, 'No heading');

	assert.equal(result.length, 5_000);
	assert.equal(result[0]?.source.offset, 0);
	assert.equal(result[result.length - 1]?.source.offset, 4_999);
});

void test('builds a pruned section tree with direct and descendant counts', () => {
	const media = buildMediaIndex(
		[
			embed('photo.png', 5),
			embed('photo.png', 15),
			embed('clip.mp4', 25),
			embed('photo.png', 35),
			embed('clip.mp4', 55),
		],
		[
			heading('Chapter', 1, 10),
			heading('Scene', 2, 20),
			heading('Detail', 3, 30),
			heading('Empty section', 2, 40),
			heading('Next scene', 2, 50),
			heading('Trailing empty chapter', 1, 60),
		],
		resolve,
		'No heading',
	);
	const tree = buildMediaSectionTree(media, 'No heading');

	assert.equal(tree.title, 'No heading');
	assert.deepEqual(tree.itemIndices, [0]);
	assert.equal(tree.descendantItemCount, 4);
	assert.equal(tree.totalItemCount, 5);
	assert.deepEqual(tree.children.map((node) => node.title), ['Chapter']);

	const chapter = tree.children[0]!;
	assert.deepEqual(chapter.itemIndices, [1]);
	assert.equal(chapter.descendantItemCount, 3);
	assert.equal(chapter.totalItemCount, 4);
	assert.deepEqual(
		chapter.children.map((node) => node.title),
		['Scene', 'Next scene'],
	);

	const scene = chapter.children[0]!;
	assert.deepEqual(scene.itemIndices, [2]);
	assert.equal(scene.descendantItemCount, 1);
	assert.equal(scene.totalItemCount, 2);
	assert.deepEqual(scene.children[0]?.itemIndices, [3]);
	assert.equal(scene.children[0]?.totalItemCount, 1);

	const nextScene = chapter.children[1]!;
	assert.deepEqual(nextScene.itemIndices, [4]);
	assert.equal(nextScene.descendantItemCount, 0);
	assert.equal(nextScene.totalItemCount, 1);
	assert.equal(
		JSON.stringify(tree).includes('Empty section'),
		false,
	);
	assert.equal(
		JSON.stringify(tree).includes('Trailing empty chapter'),
		false,
	);
});

void test('keeps duplicate section nodes separate in the pruned tree', () => {
	const media = buildMediaIndex(
		[embed('photo.png', 20), embed('clip.mp4', 40)],
		[heading('Shots', 2, 10), heading('Shots', 2, 30)],
		resolve,
		'No heading',
	);
	const tree = buildMediaSectionTree(media, 'No heading');

	assert.deepEqual(tree.children.map((node) => node.title), [
		'Shots',
		'Shots',
	]);
	assert.deepEqual(
		tree.children.map((node) => node.itemIndices),
		[[0], [1]],
	);
	assert.notEqual(
		tree.children[0]?.structuralKey,
		tree.children[1]?.structuralKey,
	);
});
