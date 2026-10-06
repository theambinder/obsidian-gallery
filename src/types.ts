import type { TFile } from 'obsidian';

export type MediaKind = 'image' | 'video';

export type GalleryLayoutMode = 'aspect' | 'square';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface SourcePosition {
	offset: number;
	line: number;
	column: number;
}

export interface EmbedReference {
	link: string;
	position: SourcePosition;
}

export interface HeadingReference {
	heading: string;
	level: number;
	position: Pick<SourcePosition, 'offset'>;
}

export interface MediaFileLike {
	extension: string;
	name: string;
	path: string;
}

/**
 * One concrete heading occurrence in a media item's complete ancestry.
 *
 * `renderKey` identifies the occurrence in the current parse, while
 * `structuralKey` is independent of source offsets and can persist UI state
 * when text is inserted above a section.
 */
export interface SectionPathEntry {
	level: HeadingLevel;
	renderKey: string;
	sourceOffset: number;
	structuralKey: string;
	title: string;
}

export interface IndexedMedia<TFileLike extends MediaFileLike> {
	file: TFileLike;
	id: string;
	kind: MediaKind;
	/** Compatibility alias for sectionRenderKey. */
	sectionKey: string;
	sectionLevel: number | null;
	sectionPath: readonly SectionPathEntry[];
	sectionRenderKey: string;
	sectionStructuralKey: string;
	sectionTitle: string;
	source: SourcePosition;
}

/** A pruned section branch: every node has media somewhere in its subtree. */
export interface MediaSectionNode {
	children: MediaSectionNode[];
	/** Number of media in child nodes, excluding this node's own items. */
	descendantItemCount: number;
	/** Indices into the IndexedMedia array for media directly in this section. */
	itemIndices: number[];
	level: HeadingLevel | null;
	path: readonly SectionPathEntry[];
	renderKey: string;
	sourceOffset: number | null;
	structuralKey: string;
	title: string;
	/** Number of media in this complete subtree, including direct items. */
	totalItemCount: number;
}

export interface MediaSectionTree extends MediaSectionNode {
	level: null;
	path: readonly [];
	renderKey: 'note-root';
	sourceOffset: null;
	structuralKey: 'note-root';
}

export interface GalleryMedia extends IndexedMedia<TFile> {
	note: TFile;
	resourceUrl: string;
}
