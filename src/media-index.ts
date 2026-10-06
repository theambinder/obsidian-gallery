import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './constants';
import type {
	EmbedReference,
	HeadingReference,
	HeadingLevel,
	IndexedMedia,
	MediaFileLike,
	MediaKind,
	MediaSectionNode,
	MediaSectionTree,
	SectionPathEntry,
} from './types';

interface HeadingState {
	entry: SectionPathEntry;
	level: HeadingLevel;
}

const ROOT_SECTION_KEY = 'note-root' as const;

export function classifyMediaExtension(extension: string): MediaKind | null {
	const normalized = extension.toLowerCase();
	if (IMAGE_EXTENSIONS.has(normalized)) {
		return 'image';
	}
	if (VIDEO_EXTENSIONS.has(normalized)) {
		return 'video';
	}
	return null;
}

export function buildMediaIndex<TFileLike extends MediaFileLike>(
	embeds: readonly EmbedReference[],
	headings: readonly HeadingReference[],
	resolveLink: (link: string) => TFileLike | null,
	rootTitle: string,
): IndexedMedia<TFileLike>[] {
	const orderedEmbeds = [...embeds].sort(
		(left, right) => left.position.offset - right.position.offset,
	);
	const orderedHeadings = [...headings].sort(
		(left, right) => left.position.offset - right.position.offset,
	);
	const media: IndexedMedia<TFileLike>[] = [];
	let headingIndex = -1;
	const headingStack: HeadingState[] = [];
	const siblingOccurrences = new Map<string, number>();

	for (const embed of orderedEmbeds) {
		while (
			headingIndex + 1 < orderedHeadings.length &&
			orderedHeadings[headingIndex + 1]!.position.offset <=
				embed.position.offset
		) {
			headingIndex += 1;
			const nextHeading = orderedHeadings[headingIndex]!;
			const level = normalizeHeadingLevel(nextHeading.level);
			while (
				headingStack.length > 0 &&
				headingStack[headingStack.length - 1]!.level >= level
			) {
				headingStack.pop();
			}

			const title = nextHeading.heading.trim();
			const parentStructuralKey =
				headingStack[headingStack.length - 1]?.entry.structuralKey ??
				ROOT_SECTION_KEY;
			const siblingSignature = JSON.stringify([
				parentStructuralKey,
				level,
				title,
			]);
			const occurrence = siblingOccurrences.get(siblingSignature) ?? 0;
			siblingOccurrences.set(siblingSignature, occurrence + 1);

			const structuralKey = `${parentStructuralKey}/${JSON.stringify([
				level,
				title,
				occurrence,
			])}`;
			headingStack.push({
				entry: {
					level,
					renderKey: `heading:${nextHeading.position.offset}:${headingIndex}`,
					sourceOffset: nextHeading.position.offset,
					structuralKey,
					title,
				},
				level,
			});
		}

		const file = resolveLink(embed.link);
		if (!file) {
			continue;
		}

		const kind = classifyMediaExtension(file.extension);
		if (!kind) {
			continue;
		}

		const sectionPath = headingStack.map((state) => state.entry);
		const section = sectionPath[sectionPath.length - 1];
		const sectionTitle = sectionPath
			.map((entry) => entry.title)
			.filter(Boolean)
			.join(' › ');
		media.push({
			file,
			id: `${embed.position.offset}:${file.path}`,
			kind,
			sectionKey: section?.renderKey ?? ROOT_SECTION_KEY,
			sectionLevel: section?.level ?? null,
			sectionPath,
			sectionRenderKey: section?.renderKey ?? ROOT_SECTION_KEY,
			sectionStructuralKey:
				section?.structuralKey ?? ROOT_SECTION_KEY,
			sectionTitle: sectionTitle || rootTitle,
			source: embed.position,
		});
	}

	return media;
}

/**
 * Builds a hierarchy containing only sections that lead to indexed media.
 * Media before the first heading live directly on the synthetic root node.
 */
export function buildMediaSectionTree<
	TFileLike extends MediaFileLike,
>(
	media: readonly IndexedMedia<TFileLike>[],
	rootTitle: string,
): MediaSectionTree {
	const root: MediaSectionTree = {
		children: [],
		descendantItemCount: 0,
		itemIndices: [],
		level: null,
		path: [],
		renderKey: ROOT_SECTION_KEY,
		sourceOffset: null,
		structuralKey: ROOT_SECTION_KEY,
		title: rootTitle,
		totalItemCount: 0,
	};
	const childrenByParent = new Map<
		MediaSectionNode,
		Map<string, MediaSectionNode>
	>();

	for (const [itemIndex, item] of media.entries()) {
		let parent: MediaSectionNode = root;
		for (let depth = 0; depth < item.sectionPath.length; depth += 1) {
			const pathEntry = item.sectionPath[depth]!;
			let childMap = childrenByParent.get(parent);
			if (!childMap) {
				childMap = new Map();
				childrenByParent.set(parent, childMap);
			}

			let child = childMap.get(pathEntry.renderKey);
			if (!child) {
				child = {
					children: [],
					descendantItemCount: 0,
					itemIndices: [],
					level: pathEntry.level,
					path: item.sectionPath.slice(0, depth + 1),
					renderKey: pathEntry.renderKey,
					sourceOffset: pathEntry.sourceOffset,
					structuralKey: pathEntry.structuralKey,
					title: pathEntry.title,
					totalItemCount: 0,
				};
				childMap.set(pathEntry.renderKey, child);
				parent.children.push(child);
			}
			parent = child;
		}
		parent.itemIndices.push(itemIndex);
	}

	countSectionItems(root);
	return root;
}

function countSectionItems(node: MediaSectionNode): number {
	let descendantItemCount = 0;
	for (const child of node.children) {
		descendantItemCount += countSectionItems(child);
	}
	node.descendantItemCount = descendantItemCount;
	node.totalItemCount = node.itemIndices.length + descendantItemCount;
	return node.totalItemCount;
}

function normalizeHeadingLevel(level: number): HeadingLevel {
	return Math.min(6, Math.max(1, Math.trunc(level))) as HeadingLevel;
}
