export interface RectLike {
	bottom: number;
	height: number;
	left: number;
	right: number;
	top: number;
	width: number;
}

export function isRectVisibleWithinRoot(
	root: RectLike,
	target: RectLike,
	margin: number,
): boolean {
	return (
		root.width > 0 &&
		root.height > 0 &&
		target.width > 0 &&
		target.height > 0 &&
		target.bottom >= root.top - margin &&
		target.top <= root.bottom + margin &&
		target.right >= root.left - margin &&
		target.left <= root.right + margin
	);
}
