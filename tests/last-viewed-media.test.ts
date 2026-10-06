import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildLastViewedMediaKeys,
	shouldRestoreLastViewedMediaFocus,
} from '../src/last-viewed-media';

interface TestMedia {
	file: { path: string };
	id: string;
	sectionStructuralKey: string;
}

function media(
	path: string,
	sectionStructuralKey: string,
	id: string,
): TestMedia {
	return { file: { path }, id, sectionStructuralKey };
}

void test('keeps a viewed occurrence stable when source offsets change', () => {
	const before = [
		media('images/a.webp', 'note-root/[1,"Season",0]', '20:images/a.webp'),
		media('images/b.webp', 'note-root/[1,"Season",0]', '40:images/b.webp'),
	];
	const after = [
		media('images/a.webp', 'note-root/[1,"Season",0]', '220:images/a.webp'),
		media('images/b.webp', 'note-root/[1,"Season",0]', '240:images/b.webp'),
	];

	assert.deepEqual(
		buildLastViewedMediaKeys(after),
		buildLastViewedMediaKeys(before),
	);
});

void test('distinguishes duplicate embeds in the same section', () => {
	const keys = buildLastViewedMediaKeys([
		media('images/a.webp', 'season', '10:images/a.webp'),
		media('images/a.webp', 'season', '20:images/a.webp'),
	]);

	assert.equal(new Set(keys).size, 2);
});

void test('invalidates ambiguous duplicate keys when their count changes', () => {
	const twoCopies = buildLastViewedMediaKeys([
		media('images/a.webp', 'season', '10:images/a.webp'),
		media('images/a.webp', 'season', '20:images/a.webp'),
	]);
	const threeCopies = buildLastViewedMediaKeys([
		media('images/a.webp', 'season', '10:images/a.webp'),
		media('images/a.webp', 'season', '15:images/a.webp'),
		media('images/a.webp', 'season', '20:images/a.webp'),
	]);

	assert.equal(
		twoCopies.some((key) => threeCopies.includes(key)),
		false,
	);
});

void test('separates the same file embedded under different sections', () => {
	const keys = buildLastViewedMediaKeys([
		media('images/a.webp', 'season/episode-1', '10:images/a.webp'),
		media('images/a.webp', 'season/episode-2', '20:images/a.webp'),
	]);

	assert.equal(new Set(keys).size, 2);
});

void test('builds unique tracking keys for a 341-item gallery', () => {
	const items = Array.from({ length: 341 }, (_, index) =>
		media(
			`images/frame-${index % 31}.webp`,
			`season/episode-${Math.floor(index / 31)}`,
			`${index}:frame`,
		),
	);
	const keys = buildLastViewedMediaKeys(items);

	assert.equal(keys.length, 341);
	assert.equal(new Set(keys).size, 341);
});

void test('restores last-viewed focus only in the originating desktop note', () => {
	assert.equal(
		shouldRestoreLastViewedMediaFocus(
			false,
			'notes/a.md',
			'notes/a.md',
			'tracking-key',
		),
		true,
	);
	assert.equal(
		shouldRestoreLastViewedMediaFocus(
			true,
			'notes/a.md',
			'notes/a.md',
			'tracking-key',
		),
		false,
	);
	assert.equal(
		shouldRestoreLastViewedMediaFocus(
			false,
			'notes/b.md',
			'notes/a.md',
			'tracking-key',
		),
		false,
	);
	assert.equal(
		shouldRestoreLastViewedMediaFocus(
			false,
			'notes/a.md',
			'notes/a.md',
			null,
		),
		false,
	);
});
