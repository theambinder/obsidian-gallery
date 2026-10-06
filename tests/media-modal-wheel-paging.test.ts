import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/media-modal.ts', import.meta.url))],
	bundle: true, write: false, format: 'cjs', platform: 'browser',
	external: ['obsidian', 'electron'],
});

class ElementStub {
	readonly classes = new Set<string>();
	readonly properties = new Map<string, string>();
	isConnected = true;
	clientWidth = 1000;
	style = {
		setProperty: (name: string, value: string): void => { this.properties.set(name, value); },
		getPropertyValue: (name: string): string => this.properties.get(name) ?? '',
		removeProperty: (name: string): void => { this.properties.delete(name); },
	};
	addClass(value: string): void { this.classes.add(value); }
	removeClass(value: string): void { this.classes.delete(value); }
	hasClass(value: string): boolean { return this.classes.has(value); }
	toggleClass(value: string, enabled: boolean): void {
		if (enabled) this.addClass(value); else this.removeClass(value);
	}
	contains(node: unknown): boolean { return node === this; }
	instanceOf(type: unknown): boolean { return type === ElementStub; }
	closest(): null { return null; }
	getBoundingClientRect(): { width: number } { return { width: this.clientWidth }; }
}

interface ViewerHarness {
	currentIndex: number;
	mediaStageEl: ElementStub;
	stagePageSettle: { targetIndex: number; commit: boolean; generation: number } | null;
	stageWheelPageSwipe: { deltaX: number; originIndex: number } | null;
	handleViewerWheel(event: WheelEvent): void;
	renderStagePagePreview(index: number, delta: number): void;
	updateStagePageFilmstripSync(): void;
	finishStagePageFilmstripSettle(): void;
	clearStagePageFilmstripMorph(): void;
	renderCurrent(): void;
	resetMediaTransform(): void;
	renderFilmstrip(): void;
	snapFilmstripToCurrent(): void;
	showScrubPreview(): void;
	updateFilmstripGeometry(): void;
}

function createWheelViewer() {
	let now = 0;
	let sequence = 0;
	const scheduled = new Map<number, { at: number; run(): void }>();
	const published: number[] = [];
	const stage = new ElementStub();
	const schedule = (at: number, run: () => void): number => {
		const id = ++sequence;
		scheduled.set(id, { at, run });
		return id;
	};
	const win = {
		performance: { now: () => now },
		innerHeight: 800,
		matchMedia: () => ({ matches: false }),
		requestAnimationFrame: (callback: FrameRequestCallback) =>
			schedule((Math.floor(now / 16) + 1) * 16, () => callback(now)),
		cancelAnimationFrame: (id: number) => scheduled.delete(id),
		setTimeout: (callback: () => void, delay: number) => schedule(now + delay, callback),
		clearTimeout: (id: number) => scheduled.delete(id),
	};
	class ModalStub {
		contentEl = { win, doc: { elementFromPoint: () => stage } };
		containerEl = { contains: (node: unknown) => node === stage };
		modalEl = new ElementStub();
	}
	const module = { exports: {} as { MediaLightbox: new (...args: unknown[]) => ViewerHarness } };
	runInNewContext(compiled.outputFiles[0]!.text, {
		module, exports: module.exports,
		require: (id: string): unknown => {
			assert.equal(id, 'obsidian');
			return { Modal: ModalStub, Platform: { isDesktopApp: true }, setIcon: () => undefined };
		},
		HTMLVideoElement: class {}, HTMLImageElement: class {},
		Element: ElementStub, HTMLElement: ElementStub,
		WheelEvent: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
	});
	const viewer = new module.exports.MediaLightbox(
		{}, Array.from({ length: 10 }, (_, id) => ({ id: String(id), kind: 'image' })),
		4, async () => undefined, () => undefined, () => undefined,
	);
	viewer.mediaStageEl = stage;
	// Run the actual wheel/session/page/timer handlers; replace DOM painting and
	// file I/O only. A pure reducer test cannot detect a second page published by
	// the integration after the first page has already settled.
	viewer.renderStagePagePreview = () => undefined;
	viewer.updateStagePageFilmstripSync = () => undefined;
	viewer.finishStagePageFilmstripSettle = () => undefined;
	viewer.clearStagePageFilmstripMorph = () => undefined;
	viewer.renderCurrent = () => {
		published.push(viewer.currentIndex);
		viewer.resetMediaTransform();
	};
	viewer.renderFilmstrip = () => undefined;
	viewer.snapFilmstripToCurrent = () => undefined;
	viewer.showScrubPreview = () => undefined;
	viewer.updateFilmstripGeometry = () => undefined;
	const advance = (target: number): void => {
		assert.ok(target >= now);
		for (let ticks = 0; ticks < 10000; ticks += 1) {
			const next = [...scheduled.entries()].sort((a, b) => a[1].at - b[1].at)[0];
			if (!next || next[1].at > target) {
				now = target;
				return;
			}
			scheduled.delete(next[0]);
			now = next[1].at;
			next[1].run();
		}
		assert.fail('Runaway viewer scheduling');
	};
	const wheel = (at: number, deltaX: number, deltaY = 0): void => {
		advance(at);
		viewer.handleViewerWheel({
			clientX: 500, clientY: 400, deltaMode: 0, deltaX, deltaY,
			ctrlKey: false, shiftKey: false, timeStamp: at,
			preventDefault: () => undefined,
		} as WheelEvent);
	};
	return { viewer, wheel, advance, published };
}

void test('one macOS momentum tail cannot create a second page after its first page settled', () => {
	const { wheel, advance, published } = createWheelViewer();
	for (const [at, delta] of [[0, 70], [10, 90], [30, 50], [120, 9], [210, 5], [300, 3], [390, 2], [480, 1]] as const) {
		wheel(at, delta);
	}
	advance(900);
	assert.deepEqual(published, [5]);
});

void test('a coalesced fast swipe advances only one page and a short nudge returns', () => {
	for (const [distance, expected] of [[260, [5]], [32, []]] as const) {
		const { wheel, advance, published } = createWheelViewer();
		wheel(0, distance);
		advance(600);
		assert.deepEqual(published, expected);
	}
});

void test('rapid deliberate opposite swipes are both accepted without a fixed cooldown', () => {
	const { wheel, advance, published } = createWheelViewer();
	wheel(0, 70); wheel(10, 90);
	wheel(55, -70); wheel(65, -90);
	advance(700);
	assert.deepEqual(published, [5, 4]);
});

void test('rapid same-direction ramps separated by a quiet tail each advance one page', () => {
	const { wheel, advance, published } = createWheelViewer();
	wheel(0, 70); wheel(10, 90); wheel(30, 10); wheel(45, 8);
	wheel(70, 60); wheel(80, 90);
	advance(700);
	assert.deepEqual(published, [5, 6]);
});

void test('a fresh ramp during release animation is not discarded', () => {
	const { wheel, advance, published } = createWheelViewer();
	wheel(0, 70); wheel(10, 90);
	wheel(95, 35); wheel(110, 60); wheel(120, 65);
	advance(700);
	assert.deepEqual(published, [5, 6]);
});

void test('fast coalesced restart samples retain their ramp above the classifier cap', () => {
	const { wheel, advance, published } = createWheelViewer();
	wheel(0, 70); wheel(10, 90);
	wheel(95, 70); wheel(110, 90);
	advance(700);
	assert.deepEqual(published, [5, 6]);
});

void test('high coalesced momentum remains one gesture when raw energy keeps decaying', () => {
	const { wheel, advance, published } = createWheelViewer();
	for (const [at, delta] of [[0, 200], [10, 160], [100, 120], [110, 100], [200, 90], [210, 75], [300, 65], [390, 40], [480, 10]] as const) {
		wheel(at, delta);
	}
	advance(900);
	assert.deepEqual(published, [5]);
});

void test('the completion guard re-arms for a distinct swipe without requiring pointer movement', () => {
	const { wheel, advance, published } = createWheelViewer();
	for (const [at, delta] of [[0, -70], [10, -90], [30, -50], [120, -9], [210, -5], [300, -3], [390, -2]] as const) {
		wheel(at, delta);
	}
	wheel(430, -70); wheel(445, -90);
	advance(1000);
	assert.deepEqual(published, [3, 2]);
});

for (const spacing of [100, 140, 180, 200]) {
	for (const direction of [1, -1]) {
		void test(`peak-first repeated trackpad swipes ${spacing}ms apart direction ${direction} need no idle cooldown`, () => {
			const { wheel, advance, published } = createWheelViewer();
			for (const start of [0, spacing, spacing * 2]) {
				wheel(start, direction * 80);
				wheel(start + 10, direction * 64);
				wheel(start + 20, direction * 32);
			}
			advance(1000);
			assert.deepEqual(published, direction > 0 ? [5, 6, 7] : [3, 2, 1]);
		});
	}
}

void test('fresh peak-first impulse interrupts an above-threshold decaying tail immediately', () => {
	const { wheel, advance, published } = createWheelViewer();
	wheel(0, 80); wheel(10, 64); wheel(30, 48); wheel(50, 28);
	wheel(100, 80); wheel(110, 64); wheel(120, 32);
	advance(700);
	assert.deepEqual(published, [5, 6]);
});

void test('opposite full impulses 100ms apart remain responsive during animation', () => {
	const { wheel, advance, published } = createWheelViewer();
	for (const [start, direction] of [[0, 1], [100, -1], [200, 1], [300, -1]] as const) {
		wheel(start, direction * 80);
		wheel(start + 10, direction * 64);
		wheel(start + 20, direction * 32);
	}
	advance(1000);
	assert.deepEqual(published, [5, 4, 5, 4]);
});

for (const cadence of [8, 16, 32, 80, 120]) {
	void test(`a monotone momentum stream delivered every ${cadence}ms still advances once`, () => {
		const { wheel, advance, published } = createWheelViewer();
		for (const [index, delta] of [160, 128, 92, 64, 42, 26, 15, 9, 5, 2, 1].entries()) {
			wheel(index * cadence, delta);
		}
		advance(cadence * 10 + 700);
		assert.deepEqual(published, [5]);
	});
}

for (const twoTailSamples of [false, true]) {
	void test(`large 300→200→150 impulse re-arms after ${twoTailSamples ? 'two low samples' : 'one low5 sample'} without cooldown`, () => {
		const { wheel, advance, published } = createWheelViewer();
		wheel(0, 300); wheel(10, 200); wheel(20, 150); wheel(35, 5);
		if (twoTailSamples) wheel(45, 2);
		wheel(60, 60); wheel(70, 48); wheel(80, 24);
		advance(700);
		assert.deepEqual(published, [5, 6]);
	});
}

void test('large 300→200→150 impulse with only low momentum remains a single page', () => {
	const { wheel, advance, published } = createWheelViewer();
	for (const [at, delta] of [[0, 300], [10, 200], [20, 150], [35, 5], [45, 4], [60, 3], [160, 2], [260, 1], [360, 0.5]] as const) {
		wheel(at, delta);
	}
	advance(1000);
	assert.deepEqual(published, [5]);
});

for (const pulse of [[90, 45, 20], [120, 40, 15]] as const) {
	for (const spacing of [100, 140]) {
		void test(`steep peak-first ${pulse.join('→')} repeats every ${spacing}ms remain responsive`, () => {
			const { wheel, advance, published } = createWheelViewer();
			for (const start of [0, spacing, spacing * 2]) {
				wheel(start, pulse[0]); wheel(start + 10, pulse[1]); wheel(start + 20, pulse[2]);
			}
			advance(1000);
			assert.deepEqual(published, [5, 6, 7]);
		});
	}
}

void test('a short delayed coalesced rebound cannot advance another page', () => {
	const { wheel, advance, published } = createWheelViewer();
	wheel(0, 100); wheel(10, 100); wheel(20, 12);
	wheel(120, 52); wheel(130, 34); wheel(140, 20);
	advance(900);
	assert.deepEqual(published, [5]);
});
