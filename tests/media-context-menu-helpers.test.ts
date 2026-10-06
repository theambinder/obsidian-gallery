import assert from 'node:assert/strict';
import test from 'node:test';
import {
	encodeMacOsFileUrl,
	getClipboardMediaPlan,
	getCopyMediaLabel,
	getRevealInFileManagerLabel,
	runNavigationThenClose,
	type ClipboardSupport,
} from '../src/media-context-menu-helpers';

function createSupport(
	supportedTypes: readonly string[],
	overrides: Partial<ClipboardSupport> = {},
): ClipboardSupport {
	return {
		canCopyOriginalMacFile: false,
		canWriteItems: true,
		supportsType: (type) => supportedTypes.includes(type),
		...overrides,
	};
}

void test('copies a media type directly when the clipboard supports it', () => {
	assert.deepEqual(
		getClipboardMediaPlan(
			'image/jpeg',
			createSupport(['image/jpeg', 'image/png']),
		),
		{ method: 'original-blob', targetMimeType: 'image/jpeg' },
	);
	assert.deepEqual(
		getClipboardMediaPlan(
			'video/mp4',
			createSupport(['video/mp4']),
		),
		{ method: 'original-blob', targetMimeType: 'video/mp4' },
	);
});

void test('uses a native macOS file object without browser media support', () => {
	assert.deepEqual(
		getClipboardMediaPlan(
			'image/webp',
			createSupport([], {
				canCopyOriginalMacFile: true,
				canWriteItems: false,
			}),
		),
		{ fallbackMimeType: null, method: 'macos-file-url' },
	);
});

void test('keeps an exact original MIME fallback for macOS file URL errors', () => {
	assert.deepEqual(
		getClipboardMediaPlan(
			'image/webp',
			createSupport(['image/webp'], {
				canCopyOriginalMacFile: true,
			}),
		),
		{
			fallbackMimeType: 'image/webp',
			method: 'macos-file-url',
		},
	);
});

void test('never silently converts an unsupported original format to PNG', () => {
	assert.equal(
		getClipboardMediaPlan(
			'video/mp4',
			createSupport(['image/png']),
		),
		null,
	);
	assert.equal(
		getClipboardMediaPlan(
			'image/webp',
			createSupport(['image/png']),
		),
		null,
	);
	assert.equal(
		getClipboardMediaPlan(
			'image/png',
			createSupport(['image/png'], { canWriteItems: false }),
		),
		null,
	);
});

void test('encodes an absolute macOS path as a safe file URL', () => {
	assert.equal(
		encodeMacOsFileUrl('/Users/A B/100% #?/кадр.webp'),
		'file:///Users/A%20B/100%25%20%23%3F/%D0%BA%D0%B0%D0%B4%D1%80.webp',
	);
	assert.throws(
		() => encodeMacOsFileUrl('relative/image.webp'),
		/A macOS file URL requires an absolute path/u,
	);
});

void test('uses media-specific native menu labels', () => {
	assert.equal(getCopyMediaLabel('image'), 'Copy image');
	assert.equal(getCopyMediaLabel('video'), 'Copy video');
});

void test('uses the native desktop file manager name', () => {
	assert.equal(
		getRevealInFileManagerLabel({ isMacOS: true, isWin: false }),
		'Reveal in Finder',
	);
	assert.equal(
		getRevealInFileManagerLabel({ isMacOS: false, isWin: true }),
		'Show in File Explorer',
	);
	assert.equal(
		getRevealInFileManagerLabel({ isMacOS: false, isWin: false }),
		'Show in file manager',
	);
});

void test('finishes context-menu navigation before closing its viewer', async () => {
	const calls: string[] = [];
	let finishNavigation!: () => void;
	const navigationGate = new Promise<void>((resolve) => {
		finishNavigation = resolve;
	});
	const action = runNavigationThenClose(
		async () => {
			calls.push('navigate-start');
			await navigationGate;
			calls.push('navigate-finished');
		},
		() => {
			calls.push('close');
		},
	);
	await Promise.resolve();
	assert.deepEqual(calls, ['navigate-start']);
	finishNavigation();
	await action;
	assert.deepEqual(calls, ['navigate-start', 'navigate-finished', 'close']);
});

void test('keeps the viewer open when context-menu navigation rejects', async () => {
	let closed = false;
	await assert.rejects(
		runNavigationThenClose(
			() => Promise.reject(new Error('navigation failed')),
			() => {
				closed = true;
			},
		),
		/navigation failed/u,
	);
	assert.equal(closed, false);
});
