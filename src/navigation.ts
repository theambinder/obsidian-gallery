import { App, MarkdownView, type WorkspaceLeaf } from 'obsidian';
import type { GalleryMedia } from './types';

function findNoteLeaf(app: App, notePath: string): WorkspaceLeaf | undefined {
	return app.workspace.getLeavesOfType('markdown').find((leaf) => {
		return (
			leaf.view instanceof MarkdownView &&
			leaf.view.file?.path === notePath
		);
	});
}

export async function revealMediaSource(
	app: App,
	media: GalleryMedia,
): Promise<void> {
	const leaf = findNoteLeaf(app, media.note.path) ?? app.workspace.getLeaf(false);
	const cursor = {
		line: media.source.line,
		ch: media.source.column,
	};

	await leaf.openFile(media.note, {
		active: true,
		eState: cursor,
	});
	await app.workspace.revealLeaf(leaf);

	if (!(leaf.view instanceof MarkdownView)) {
		return;
	}

	if (leaf.view.getMode() === 'preview') {
		leaf.view.setEphemeralState({ line: cursor.line });
		return;
	}

	leaf.view.editor.setCursor(cursor);
	leaf.view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
	leaf.view.editor.focus();
}
