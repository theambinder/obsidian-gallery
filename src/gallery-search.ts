import type {
	IndexedMedia,
	MediaFileLike,
	MediaKind,
	MediaSectionNode,
	MediaSectionTree,
} from './types';

export interface GallerySearchResult {
	matchedItemIndices: ReadonlySet<number>;
	matchedSectionKeys: ReadonlySet<string>;
	normalizedQuery: string;
	tree: MediaSectionTree;
	visibleItemIndices: readonly number[];
	visibleItemCount: number;
}

export interface VisibleMediaProjection<T> {
	initialIndex: number;
	items: T[];
	originalIndices: number[];
}

export interface GallerySearchExcerpt {
	leadingEllipsis: boolean;
	segments: GallerySearchTextSegment[];
	trailingEllipsis: boolean;
}

export interface GallerySearchTextSegment {
	isMatch: boolean;
	text: string;
}

interface FilteredSection {
	node: MediaSectionNode;
	visibleItemCount: number;
}

interface FoldedGallerySearchText {
	endByFoldedIndex: number[];
	folded: string;
	startByFoldedIndex: number[];
}

const DEFAULT_SEARCH_EXCERPT_CHARACTERS = 16;

/** Filtering needs only folded text; source-position maps are for highlights. */
function foldGallerySearchValue(text: string): string {
	let folded = '';
	for (const character of text) {
		folded += character.toLowerCase();
	}
	return folded;
}

function foldGallerySearchText(text: string): FoldedGallerySearchText {
	let folded = '';
	const startByFoldedIndex: number[] = [];
	const endByFoldedIndex: number[] = [];
	for (let sourceStart = 0; sourceStart < text.length; ) {
		const codePoint = text.codePointAt(sourceStart);
		if (codePoint === undefined) {
			break;
		}
		const sourceCharacter = String.fromCodePoint(codePoint);
		const sourceEnd = sourceStart + sourceCharacter.length;
		const foldedCharacter = sourceCharacter.toLowerCase();
		folded += foldedCharacter;
		for (let index = 0; index < foldedCharacter.length; index += 1) {
			startByFoldedIndex.push(sourceStart);
			endByFoldedIndex.push(sourceEnd);
		}
		sourceStart = sourceEnd;
	}
	return { endByFoldedIndex, folded, startByFoldedIndex };
}

/**
 * Search deliberately uses predictable, case-insensitive substring matching.
 * Keeping the normalized query separate lets the DOM renderer preserve the
 * original title and filename casing when it marks matching ranges.
 */
export function normalizeGallerySearchQuery(query: string): string {
	return foldGallerySearchValue(query.trim());
}

/** Search collapse is transient and must never leak between notes. */
export function clearGallerySearchCollapseForNoteChange(
	previousNotePath: string | null,
	nextNotePath: string,
	collapsed: Set<string>,
): boolean {
	if (previousNotePath === nextNotePath) {
		return false;
	}
	collapsed.clear();
	return true;
}

/** Splits display text into safe DOM text/mark segments without using HTML. */
export function segmentGallerySearchText(
	text: string,
	query: string,
): GallerySearchTextSegment[] {
	const normalizedQuery = normalizeGallerySearchQuery(query);
	if (!text) {
		return [];
	}
	if (!normalizedQuery) {
		return [{ isMatch: false, text }];
	}

	const foldedText = foldGallerySearchText(text);
	const segments: GallerySearchTextSegment[] = [];
	let foldedCursor = 0;
	let sourceCursor = 0;
	while (foldedCursor < foldedText.folded.length) {
		const matchIndex = foldedText.folded.indexOf(
			normalizedQuery,
			foldedCursor,
		);
		if (matchIndex === -1) {
			break;
		}
		const foldedMatchEnd = matchIndex + normalizedQuery.length;
		const sourceMatchStart = foldedText.startByFoldedIndex[matchIndex];
		const sourceMatchEnd = foldedText.endByFoldedIndex[foldedMatchEnd - 1];
		if (
			sourceMatchStart === undefined ||
			sourceMatchEnd === undefined ||
			sourceMatchEnd <= sourceCursor
		) {
			foldedCursor = foldedMatchEnd;
			continue;
		}
		if (sourceMatchStart > sourceCursor) {
			segments.push({
				isMatch: false,
				text: text.slice(sourceCursor, sourceMatchStart),
			});
		}
		segments.push({
			isMatch: true,
			text: text.slice(sourceMatchStart, sourceMatchEnd),
		});
		sourceCursor = sourceMatchEnd;
		foldedCursor = foldedMatchEnd;
	}
	if (sourceCursor < text.length) {
		segments.push({ isMatch: false, text: text.slice(sourceCursor) });
	}

	return segments.length > 0 ? segments : [{ isMatch: false, text }];
}

/**
 * Keeps the first filename hit visible in a compact badge instead of relying
 * on end-ellipsis, which can hide a match in the middle of a long filename.
 */
export function createGallerySearchExcerpt(
	text: string,
	query: string,
	maxCharacters = DEFAULT_SEARCH_EXCERPT_CHARACTERS,
): GallerySearchExcerpt {
	const fullSegments = segmentGallerySearchText(text, query);
	let sourceCursor = 0;
	let matchStart: number | null = null;
	let matchEnd: number | null = null;
	for (const segment of fullSegments) {
		const segmentEnd = sourceCursor + segment.text.length;
		if (segment.isMatch) {
			matchStart = sourceCursor;
			matchEnd = segmentEnd;
			break;
		}
		sourceCursor = segmentEnd;
	}

	const boundaries = [0];
	for (const character of text) {
		boundaries.push(boundaries[boundaries.length - 1]! + character.length);
	}
	const characterLimit = Math.max(1, Math.trunc(maxCharacters));
	if (matchStart === null || matchEnd === null) {
		const excerptEnd = boundaries[Math.min(characterLimit, boundaries.length - 1)]!;
		return {
			leadingEllipsis: false,
			segments: segmentGallerySearchText(text.slice(0, excerptEnd), query),
			trailingEllipsis: excerptEnd < text.length,
		};
	}

	const matchStartCharacter = boundaries.indexOf(matchStart);
	const matchEndCharacter = boundaries.indexOf(matchEnd);
	if (matchStartCharacter === -1 || matchEndCharacter === -1) {
		return {
			leadingEllipsis: false,
			segments: fullSegments,
			trailingEllipsis: false,
		};
	}

	const matchCharacters = matchEndCharacter - matchStartCharacter;
	const contextBudget = Math.max(0, characterLimit - matchCharacters);
	const availableBefore = matchStartCharacter;
	const availableAfter = boundaries.length - 1 - matchEndCharacter;
	// A one-line badge can be only 9–10 characters wide in a four-column
	// mobile grid. Keep a middle hit immediately after the leading ellipsis;
	// symmetric context would let CSS end-ellipsis hide the actual match.
	const before =
		availableBefore <= 1 ? Math.min(availableBefore, contextBudget) : 0;
	const after = Math.min(availableAfter, contextBudget - before);

	const excerptStartCharacter = matchStartCharacter - before;
	const excerptEndCharacter = matchEndCharacter + after;
	const excerptStart = boundaries[excerptStartCharacter]!;
	const excerptEnd = boundaries[excerptEndCharacter]!;
	return {
		leadingEllipsis: excerptStartCharacter > 0,
		segments: segmentGallerySearchText(
			text.slice(excerptStart, excerptEnd),
			query,
		),
		trailingEllipsis: excerptEndCharacter < boundaries.length - 1,
	};
}

/**
 * Returns a pruned projection while retaining original media indices.
 *
 * A filename match includes only that media item plus its section ancestry. A
 * direct section-title match includes the section's complete media subtree.
 * Ancestors retained only for context are not marked as direct title hits.
 */
export function filterMediaSectionTree<TFileLike extends MediaFileLike>(
	tree: MediaSectionTree,
	media: readonly IndexedMedia<TFileLike>[],
	query: string,
	kindFilter: MediaKind | null = null,
): GallerySearchResult {
	const normalizedQuery = normalizeGallerySearchQuery(query);
	if (!normalizedQuery && kindFilter === null) {
		return {
			matchedItemIndices: new Set<number>(),
			matchedSectionKeys: new Set<string>(),
			normalizedQuery,
			tree,
			visibleItemIndices: media.map((_, index) => index),
			visibleItemCount: tree.totalItemCount,
		};
	}

	const matchedItemIndices = new Set<number>();
	const matchedSectionKeys = new Set<string>();
	const allowsKind = (index: number): boolean => {
		return kindFilter === null || media[index]?.kind === kindFilter;
	};

	const matchesFilename = (index: number): boolean => {
		const item = media[index];
		const matches = allowsKind(index) && item
			? foldGallerySearchValue(item.file.name).includes(normalizedQuery)
			: false;
		if (matches) {
			matchedItemIndices.add(index);
		}
		return matches;
	};

	const filterNode = (
		node: MediaSectionNode,
		includedByAncestor: boolean,
		isRoot: boolean,
	): FilteredSection | null => {
		const titleMatches =
			normalizedQuery.length > 0 &&
			foldGallerySearchValue(node.title).includes(normalizedQuery);
		if (titleMatches) {
			matchedSectionKeys.add(node.structuralKey);
		}

		// The synthetic root title describes only pre-heading media, not every
		// section in the note, so a "No heading" hit must not include children.
		const includesOwnItems = includedByAncestor || titleMatches;
		const includesChildren = includedByAncestor || (!isRoot && titleMatches);
		const itemIndices = node.itemIndices.filter((index) => {
			return (
				allowsKind(index) &&
				(!normalizedQuery || includesOwnItems || matchesFilename(index))
			);
		});
		// Record independent filename hits even when a matching section already
		// made every item visible, so tile highlighting remains unambiguous.
		if (includesOwnItems && normalizedQuery) {
			for (const index of node.itemIndices) {
				matchesFilename(index);
			}
		}

		const children = node.children.flatMap((child) => {
			const filtered = filterNode(child, includesChildren, false);
			return filtered ? [filtered] : [];
		});
		const descendantItemCount = children.reduce(
			(total, child) => total + child.visibleItemCount,
			0,
		);
		const visibleItemCount = itemIndices.length + descendantItemCount;
		if (!isRoot && visibleItemCount === 0) {
			return null;
		}

		return {
			node: {
				...node,
				children: children.map((child) => child.node),
				descendantItemCount,
				itemIndices,
				totalItemCount: visibleItemCount,
			},
			visibleItemCount,
		};
	};

	const filteredRoot = filterNode(tree, false, true);
	const filteredTree = (filteredRoot?.node ?? {
		...tree,
		children: [],
		descendantItemCount: 0,
		itemIndices: [],
		totalItemCount: 0,
	}) as MediaSectionTree;
	const visibleItemIndices: number[] = [];
	const collectVisibleIndices = (node: MediaSectionNode): void => {
		visibleItemIndices.push(...node.itemIndices);
		for (const child of node.children) {
			collectVisibleIndices(child);
		}
	};
	collectVisibleIndices(filteredTree);
	visibleItemIndices.sort((left, right) => left - right);

	return {
		matchedItemIndices,
		matchedSectionKeys,
		normalizedQuery,
		tree: filteredTree,
		visibleItemIndices,
		visibleItemCount: filteredTree.totalItemCount,
	};
}

/** Builds a stable viewer snapshot from the currently visible source indices. */
export function buildVisibleMediaProjection<T>(
	items: readonly T[],
	visibleIndices: readonly number[],
	initialOriginalIndex: number,
): VisibleMediaProjection<T> | null {
	const initialIndex = visibleIndices.indexOf(initialOriginalIndex);
	if (initialIndex === -1) {
		return null;
	}
	const originalIndices: number[] = [];
	const projectedItems: T[] = [];
	for (const originalIndex of visibleIndices) {
		const item = items[originalIndex];
		if (item === undefined) {
			continue;
		}
		originalIndices.push(originalIndex);
		projectedItems.push(item);
	}
	const correctedInitialIndex = originalIndices.indexOf(initialOriginalIndex);
	if (correctedInitialIndex === -1) {
		return null;
	}
	return {
		initialIndex: correctedInitialIndex,
		items: projectedItems,
		originalIndices,
	};
}
