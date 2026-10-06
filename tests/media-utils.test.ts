import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getEncodedImageDimensions,
	getMediaMimeType,
} from '../src/media-utils';

void test('maps media extensions to MIME types', () => {
	assert.equal(getMediaMimeType('WEBP'), 'image/webp');
	assert.equal(getMediaMimeType('mov'), 'video/quicktime');
	assert.equal(getMediaMimeType('unknown'), 'application/octet-stream');
});

void test('reads PNG dimensions without decoding pixels', () => {
	const bytes = new ArrayBuffer(24);
	const view = new DataView(bytes);
	view.setUint32(0, 0x89504e47);
	view.setUint32(4, 0x0d0a1a0a);
	view.setUint32(16, 1920);
	view.setUint32(20, 1080);

	assert.deepEqual(getEncodedImageDimensions(bytes, 'png'), {
		height: 1080,
		width: 1920,
	});
});

void test('reads lossy WebP dimensions without decoding pixels', () => {
	const bytes = new ArrayBuffer(30);
	const view = new DataView(bytes);
	writeAscii(view, 0, 'RIFF');
	writeAscii(view, 8, 'WEBP');
	writeAscii(view, 12, 'VP8 ');
	view.setUint32(16, 10, true);
	view.setUint8(23, 0x9d);
	view.setUint8(24, 0x01);
	view.setUint8(25, 0x2a);
	view.setUint16(26, 1920, true);
	view.setUint16(28, 1080, true);

	assert.deepEqual(getEncodedImageDimensions(bytes, 'webp'), {
		height: 1080,
		width: 1920,
	});
});

void test('reads JPEG frame dimensions without decoding pixels', () => {
	const bytes = new ArrayBuffer(23);
	const view = new DataView(bytes);
	view.setUint16(0, 0xffd8);
	view.setUint16(2, 0xffc0);
	view.setUint16(4, 17);
	view.setUint8(6, 8);
	view.setUint16(7, 3000);
	view.setUint16(9, 2000);

	assert.deepEqual(getEncodedImageDimensions(bytes, 'jpg'), {
		height: 3000,
		width: 2000,
	});
});

void test('uses an SVG viewBox as its safe thumbnail ratio', () => {
	const bytes = new TextEncoder().encode(
		'<svg viewBox="0 0 1200 300" xmlns="http://www.w3.org/2000/svg"></svg>',
	).buffer;

	assert.deepEqual(getEncodedImageDimensions(bytes, 'svg'), {
		height: 300,
		width: 1200,
	});
});

void test('returns null for malformed or unsupported image headers', () => {
	assert.equal(getEncodedImageDimensions(new ArrayBuffer(8), 'webp'), null);
	assert.equal(getEncodedImageDimensions(new ArrayBuffer(8), 'jxl'), null);
});

function writeAscii(view: DataView, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}
