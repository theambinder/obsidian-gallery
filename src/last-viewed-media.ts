export interface LastViewedTrackableMedia {
	file: { path: string };
	sectionStructuralKey: string;
}

/**
 * Keeps modal-close focus local to the desktop gallery that still shows the
 * note the viewer came from. Mobile must not acquire synthetic focus after a
 * tap, and a note switch must not focus an unrelated tile.
 */
export function shouldRestoreLastViewedMediaFocus(
	isMobile: boolean,
	currentNotePath: string | null,
	viewedNotePath: string | null,
	trackingKey: string | null,
): boolean {
	return (
		!isMobile &&
		currentNotePath !== null &&
		currentNotePath === viewedNotePath &&
		trackingKey !== null
	);
}

/**
 * Builds a session-stable identity for every concrete media occurrence.
 *
 * Source offsets are intentionally excluded so inserting text above an embed does
 * not lose the marker on the next gallery render. The occurrence and total count
 * keep duplicate embeds distinct, while invalidating ambiguous keys when an
 * identical duplicate is added or removed.
 */
export function buildLastViewedMediaKeys(
	media: readonly LastViewedTrackableMedia[],
): string[] {
	const signatures = media.map((item) =>
		JSON.stringify([item.sectionStructuralKey, item.file.path]),
	);
	const totals = new Map<string, number>();
	for (const signature of signatures) {
		totals.set(signature, (totals.get(signature) ?? 0) + 1);
	}

	const occurrences = new Map<string, number>();
	return media.map((item, index) => {
		const signature = signatures[index]!;
		const occurrence = occurrences.get(signature) ?? 0;
		occurrences.set(signature, occurrence + 1);
		return JSON.stringify([
			item.sectionStructuralKey,
			item.file.path,
			occurrence,
			totals.get(signature)!,
		]);
	});
}
