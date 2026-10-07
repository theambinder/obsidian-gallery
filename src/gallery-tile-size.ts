import { DEFAULT_TILE_SCALE, normalizeTileScale } from './settings';

// Fixed nominal percentages: pane resizing changes only the grid's column
// count, never the meaning or number of a selected setting.
export const TILE_SCALE_PRESETS: readonly number[] = Object.freeze([
	10, 20, 30, 40, 50, 60, 80, 100, 120, 150,
	180, 220, 270, 330, 400, 500, 650, 850, 1200, 2000,
]);
export const MIN_TILE_SIZE_LEVEL = 1;
export const MAX_TILE_SIZE_LEVEL = TILE_SCALE_PRESETS.length;

export function tileLevelToScale(level: number): number {
	if (!Number.isFinite(level)) return DEFAULT_TILE_SCALE;
	const index = Math.min(MAX_TILE_SIZE_LEVEL - 1, Math.max(0, Math.round(level) - MIN_TILE_SIZE_LEVEL));
	return TILE_SCALE_PRESETS[index] ?? DEFAULT_TILE_SCALE;
}

/** Display the nearest fixed level without rewriting a legacy saved scale. */
export function tileScaleToLevel(scale: number): number {
	const normalized = normalizeTileScale(scale);
	let nearestIndex = 0;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const [index, preset] of TILE_SCALE_PRESETS.entries()) {
		const distance = Math.abs(Math.log(preset / normalized));
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestIndex = index;
		}
	}
	return nearestIndex + MIN_TILE_SIZE_LEVEL;
}
