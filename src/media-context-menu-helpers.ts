import type { MediaKind } from './types';

export interface ClipboardSupport {
	canCopyOriginalMacFile: boolean;
	canWriteItems: boolean;
	supportsType(type: string): boolean;
}

export interface DesktopPlatform {
	isMacOS: boolean;
	isWin: boolean;
}

/**
 * Describes how the original media is written to the clipboard. The plan never
 * converts an image to a different format.
 */
export type ClipboardMediaPlan =
	| { fallbackMimeType: string | null; method: 'macos-file-url' }
	| { method: 'original-blob'; targetMimeType: string };

export function getClipboardMediaPlan(
	sourceMimeType: string,
	support: ClipboardSupport,
): ClipboardMediaPlan | null {
	if (support.canCopyOriginalMacFile) {
		return {
			fallbackMimeType:
				support.canWriteItems && support.supportsType(sourceMimeType)
					? sourceMimeType
					: null,
			method: 'macos-file-url',
		};
	}
	if (!support.canWriteItems) {
		return null;
	}
	if (support.supportsType(sourceMimeType)) {
		return {
			method: 'original-blob',
			targetMimeType: sourceMimeType,
		};
	}
	return null;
}

export function encodeMacOsFileUrl(fullPath: string): string {
	if (!fullPath.startsWith('/')) {
		throw new Error('A macOS file URL requires an absolute path.');
	}
	return `file://${fullPath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')}`;
}

export function getCopyMediaLabel(kind: MediaKind): string {
	return kind === 'image' ? 'Copy image' : 'Copy video';
}

export function getRevealInFileManagerLabel(
	platform: DesktopPlatform,
): string {
	if (platform.isMacOS) {
		return 'Reveal in Finder';
	}
	if (platform.isWin) {
		return 'Show in File Explorer';
	}
	return 'Show in file manager';
}

/** Completes workspace navigation before dismissing its originating viewer. */
export async function runNavigationThenClose(
	navigate: () => Promise<void>,
	afterNavigate: (() => Promise<void> | void) | undefined,
): Promise<void> {
	await navigate();
	await afterNavigate?.();
}
