export type AndroidFileOpener = (path: string) => Promise<void>;

/**
 * Obsidian's Android adapter opens a native chooser containing open/edit/share
 * actions for the original vault file. This bridge is not in the public adapter
 * typings, so feature-detect it and never call it on desktop or iOS.
 */
export function getAndroidFileOpener(
	adapter: unknown,
	isAndroidApp: boolean,
): AndroidFileOpener | null {
	if (
		!isAndroidApp || typeof adapter !== 'object' || adapter === null ||
		!('open' in adapter) || typeof adapter.open !== 'function'
	) return null;
	const nativeAdapter = adapter as { open(path: string): unknown };
	return async (path: string): Promise<void> => {
		// Keep the adapter receiver: the method resolves the vault-relative path
		// and grants native FileProvider access itself. Do not invent URI schemes,
		// bridge arguments or copy the file to an untracked temporary location.
		await nativeAdapter.open(path);
	};
}
