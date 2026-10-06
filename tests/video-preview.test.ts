import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoPreview } from '../src/video-preview';
import type { VideoTileMetadata } from '../src/video-metadata';

class VideoStub extends EventTarget {
	autoplay = false;
	controls = false;
	crossOrigin: string | null = null;
	currentTime = 0;
	defaultMuted = false;
	duration = 12;
	loadCalls = 0;
	muted = false;
	pauseCalls = 0;
	playCalls = 0;
	playsInline = false;
	preload = '';
	readyState = 0;
	seeking = false;
	src = '';
	videoHeight = 1080;
	videoWidth = 1920;
	load(): void { this.loadCalls += 1; }
	pause(): void { this.pauseCalls += 1; }
	play(): Promise<void> { this.playCalls += 1; return Promise.resolve(); }
	removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
	emit(name: string): void { this.dispatchEvent(new Event(name)); }
}

function createHarness() {
	const video = new VideoStub();
	const controller = new AbortController();
	const metadata: VideoTileMetadata[] = [];
	const timers = new Map<number, () => void>();
	let sequence = 0;
	let drawCalls = 0;
	let encodedSize: [number, number] | null = null;
	let encode: BlobCallback | null = null;
	const canvas = {
		width: 0, height: 0,
		getContext: () => ({ drawImage: () => { drawCalls += 1; } }),
		toBlob(callback: BlobCallback): void {
			encodedSize = [canvas.width, canvas.height];
			encode = callback;
		},
	};
	const win = {
		setTimeout: (callback: () => void) => { timers.set(++sequence, callback); return sequence; },
		clearTimeout: (id: number) => { timers.delete(id); },
		createEl: (tag: string) => tag === 'video' ? video : canvas,
	};
	const document = { defaultView: win, win } as unknown as Document;
	const promise = createVideoPreview({
		document, maxSize: 384, resourceUrl: 'https://localhost/_capacitor_file_/clip.mp4',
		signal: controller.signal, onMetadata: (value) => { metadata.push(value); },
	});
	return {
		video, controller, metadata, timers, canvas, promise,
		drawCalls: () => drawCalls,
		encodedSize: () => encodedSize,
		completeEncode: (blob: Blob | null = new Blob(['frame'])) => { encode?.(blob); },
	};
}

void test('Android metadata-only state seeks a real frame and produces a bounded image without playback', async () => {
	const h = createHarness();
	assert.equal(h.video.preload, 'auto');
	assert.equal(h.video.muted, true);
	assert.equal(h.video.playsInline, true);
	h.video.readyState = 1;
	h.video.emit('loadedmetadata');
	assert.equal(h.video.currentTime, 0.001);
	assert.equal(h.drawCalls(), 0, 'Metadata alone is never treated as a thumbnail');
	assert.deepEqual(h.metadata[0], { durationSeconds: 12, width: 1920, height: 1080 });
	h.video.readyState = 2;
	h.video.emit('seeked');
	assert.equal(h.drawCalls(), 1);
	assert.deepEqual(h.encodedSize(), [384, 216]);
	assert.equal(h.video.src, '', 'Decoder is released before image encoding finishes');
	h.completeEncode();
	const result = await h.promise;
	assert.ok(result.blob.size > 0);
	assert.deepEqual(result.metadata, h.metadata[0]);
	assert.equal(h.video.playCalls, 0);
	assert.equal(h.video.loadCalls, 2, 'One load and one unload, no duplicate teardown');
	assert.equal(h.timers.size, 0);
	assert.equal(h.canvas.width, 1);
});

void test('canplay can capture a frame when mobile data saver omits loadeddata', async () => {
	const h = createHarness();
	h.video.readyState = 3;
	h.video.emit('canplay');
	h.completeEncode();
	await h.promise;
	assert.equal(h.drawCalls(), 1);
	assert.equal(h.video.currentTime, 0);
});

void test('a temporarily unseekable local Android video can retry when loading progresses', async () => {
	const h = createHarness();
	let attempts = 0;
	let currentTime = 0;
	Object.defineProperty(h.video, 'currentTime', {
		get: () => currentTime,
		set: (value: number) => {
			attempts += 1;
			if (attempts === 1) throw new Error('Not seekable yet');
			currentTime = value;
		},
	});
	h.video.readyState = 1;
	h.video.emit('loadedmetadata');
	assert.equal(attempts, 1);
	h.video.emit('progress');
	assert.equal(attempts, 2);
	assert.equal(currentTime, 0.001);
	h.video.readyState = 2;
	h.video.emit('seeked');
	h.completeEncode();
	await h.promise;
	assert.equal(h.drawCalls(), 1);
});

void test('duration discovered after initial metadata is retained in the cached preview', async () => {
	const h = createHarness();
	h.video.duration = Number.NaN;
	h.video.readyState = 1;
	h.video.emit('loadedmetadata');
	h.video.duration = 8.5;
	h.video.emit('durationchange');
	h.video.readyState = 2;
	h.video.emit('seeked');
	h.completeEncode();
	const result = await h.promise;
	assert.equal(result.metadata.durationSeconds, 8.5);
	assert.equal(h.metadata.at(-1)?.durationSeconds, 8.5);
});

void test('aborting an offscreen preview unloads decoder and ignores queued metadata', async () => {
	const h = createHarness();
	h.controller.abort();
	await assert.rejects(h.promise, /cancelled/u);
	h.video.readyState = 4;
	h.video.emit('loadedmetadata');
	h.video.emit('seeked');
	assert.equal(h.video.src, '');
	assert.equal(h.video.pauseCalls, 1);
	assert.equal(h.drawCalls(), 0);
	assert.equal(h.metadata.length, 0);
	assert.equal(h.timers.size, 0);
});

void test('a late canvas result cannot publish a preview after cancellation', async () => {
	const h = createHarness();
	h.video.readyState = 2;
	h.video.emit('loadeddata');
	h.controller.abort();
	await assert.rejects(h.promise, /cancelled/u);
	h.completeEncode();
	assert.equal(h.canvas.width, 1);
	assert.equal(h.video.pauseCalls, 1);
});

void test('unsupported codecs report failure and release the temporary resource', async () => {
	const h = createHarness();
	h.video.emit('error');
	await assert.rejects(h.promise, /could not decode/u);
	assert.equal(h.video.src, '');
	assert.equal(h.drawCalls(), 0);
	assert.equal(h.timers.size, 0);
});

void test('a stalled video cannot occupy the preview worker indefinitely', async () => {
	const h = createHarness();
	for (const callback of h.timers.values()) callback();
	await assert.rejects(h.promise, /timed out/u);
	assert.equal(h.video.src, '');
	assert.equal(h.timers.size, 0);
});

void test('failed frame encoding is an error rather than a fake loaded thumbnail', async () => {
	const h = createHarness();
	h.video.readyState = 2;
	h.video.emit('loadeddata');
	h.completeEncode(null);
	await assert.rejects(h.promise, /encode/u);
	assert.equal(h.canvas.width, 1);
	assert.equal(h.timers.size, 0);
});
