export type GalleryArrowKey =
	| 'ArrowDown'
	| 'ArrowLeft'
	| 'ArrowRight'
	| 'ArrowUp';

export type SectionNavigationIntent =
	| 'collapse'
	| 'expand'
	| 'focus-child'
	| 'focus-next'
	| 'focus-parent'
	| 'focus-previous';

export function isGalleryArrowKey(key: string): key is GalleryArrowKey {
	return (
		key === 'ArrowLeft' ||
		key === 'ArrowRight' ||
		key === 'ArrowUp' ||
		key === 'ArrowDown'
	);
}

export function getSectionNavigationIntent(
	direction: GalleryArrowKey,
	isOpen: boolean,
): SectionNavigationIntent {
	if (direction === 'ArrowRight') {
		return isOpen ? 'focus-child' : 'expand';
	}
	if (direction === 'ArrowLeft') {
		return isOpen ? 'collapse' : 'focus-parent';
	}
	return direction === 'ArrowDown' ? 'focus-next' : 'focus-previous';
}

/**
 * Resolves the linear fallback used when spatial movement inside a tile grid
 * has reached an edge. Vertical movement skips the remaining tiles in the
 * current grid so focus lands on the surrounding section header instead of
 * moving sideways through the same row.
 */
export function findGalleryControlFallbackIndex<Group>(
	groups: readonly (Group | null)[],
	currentIndex: number,
	direction: GalleryArrowKey,
): number | null {
	if (currentIndex < 0 || currentIndex >= groups.length) {
		return null;
	}
	const step =
		direction === 'ArrowRight' || direction === 'ArrowDown' ? 1 : -1;
	let index = currentIndex + step;
	const currentGroup = groups[currentIndex];

	if (
		currentGroup !== null &&
		(direction === 'ArrowUp' || direction === 'ArrowDown')
	) {
		while (index >= 0 && index < groups.length && groups[index] === currentGroup) {
			index += step;
		}
	}

	return index >= 0 && index < groups.length ? index : null;
}
