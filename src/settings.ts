import type { GalleryLayoutMode } from './types';

export const DEFAULT_TILE_SCALE = 100;
export const MIN_TILE_SCALE = 30;
export const MAX_TILE_SCALE = 180;
export const TILE_SCALE_STEP = 10;

export interface GallerySettings extends Record<string, unknown> {
	layoutMode: GalleryLayoutMode;
	tileScale: number;
	showSections: boolean;
	version: 1;
}

export function normalizeTileScale(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_TILE_SCALE;
	}
	return Math.min(
		MAX_TILE_SCALE,
		Math.max(MIN_TILE_SCALE, Math.round(value / TILE_SCALE_STEP) * TILE_SCALE_STEP),
	);
}

export function normalizeGallerySettings(value: unknown): GallerySettings {
	const saved = value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		...saved,
		layoutMode: saved.layoutMode === 'aspect' ? 'aspect' : 'square',
		tileScale: normalizeTileScale(saved.tileScale),
		showSections: typeof saved.showSections === 'boolean' ? saved.showSections : true,
		version: 1,
	};
}
