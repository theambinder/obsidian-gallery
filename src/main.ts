import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	type Modal,
} from 'obsidian';
import {
	OPEN_GALLERY_COMMAND_NAME,
	VIEW_TYPE_SECTION_GALLERY,
} from './constants';
import { SectionGalleryView } from './gallery-view';
import { classifyMediaExtension } from './media-index';
import { MediaLightbox } from './media-modal';
import { openGalleryDiagnostics } from './mobile-diagnostics';
import { revealMediaSource } from './navigation';
import { normalizeGallerySettings, normalizeTileScale } from './settings';
import { GallerySettingsTab } from './settings-tab';
import type { GalleryLayoutMode, GalleryMedia } from './types';

const REFRESH_DELAY_MS = 120;

export default class SectionGalleryPlugin extends Plugin {
	private readonly activeLightboxes = new Set<MediaLightbox>();
	private readonly activeDiagnostics = new Set<Modal>();
	private activeNote: TFile | null = null;
	private forceRefreshPending = false;
	private isLayoutReady = false;
	private isUnloaded = true;
	private gallerySettings = normalizeGallerySettings(null);
	private settingsSave: Promise<void> = Promise.resolve();
	private lifecycleGeneration = 0;
	private refreshTimer: number | null = null;

	async onload(): Promise<void> {
		const generation = ++this.lifecycleGeneration;
		this.isUnloaded = false;
		const data: unknown = await this.loadData();
		if (!this.isActiveGeneration(generation)) {
			return;
		}
		this.gallerySettings = normalizeGallerySettings(data);
		this.addSettingTab(new GallerySettingsTab(this.app, this, this));

		this.registerView(
			VIEW_TYPE_SECTION_GALLERY,
			(leaf) => new SectionGalleryView(leaf, this),
		);

		this.addRibbonIcon('images', OPEN_GALLERY_COMMAND_NAME, () => {
			this.openGalleryFromCommand(false);
		});
		this.addCommand({
			id: 'open-media-gallery',
			name: OPEN_GALLERY_COMMAND_NAME,
			callback: () => {
				this.openGalleryFromCommand(false);
			},
		});
		this.addCommand({
			id: 'focus-media-gallery',
			name: 'Focus media',
			callback: () => {
				this.openGalleryFromCommand(true);
			},
		});
		this.addCommand({
			id: 'show-mobile-diagnostics',
			name: 'Show mobile diagnostics',
			callback: () => this.showDiagnostics(),
		});

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.activeNote = file?.extension === 'md' ? file : null;
				this.queueRefresh();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView && leaf.view.file) {
					this.activeNote = leaf.view.file;
					this.queueRefresh();
				} else if (
					leaf &&
					leaf.view.getViewType() !== VIEW_TYPE_SECTION_GALLERY &&
					this.app.workspace.getActiveFile()?.extension !== 'md'
				) {
					this.activeNote = null;
					this.queueRefresh();
				}
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file.path === this.activeNote?.path) {
					this.queueRefresh();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (this.galleryReferences(file.path)) {
					this.queueRefresh(true);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (
					this.isLayoutReady &&
					file instanceof TFile &&
					classifyMediaExtension(file.extension)
				) {
					this.queueRefresh(true);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const affectsActiveNote =
					this.activeNote === file || this.activeNote?.path === oldPath;
				if (affectsActiveNote && file instanceof TFile) {
					this.activeNote = file.extension === 'md' ? file : null;
				}
				if (
					affectsActiveNote ||
					this.galleryReferences(oldPath) ||
					this.galleryReferences(file.path) ||
					(file instanceof TFile &&
						classifyMediaExtension(file.extension) !== null)
				) {
					this.queueRefresh(true);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				const affectsActiveNote =
					this.activeNote === file || file.path === this.activeNote?.path;
				const affectsGallery = this.galleryReferences(file.path);
				if (affectsActiveNote) {
					this.activeNote = null;
				}
				if (affectsActiveNote || affectsGallery) {
					this.queueRefresh(true);
				}
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			// Obsidian's layout-ready callback cannot be unregistered. A mobile
			// vault can finish opening after this plugin has already been disabled.
			if (!this.isActiveGeneration(generation)) {
				return;
			}
			this.isLayoutReady = true;
			this.captureActiveNote();
			this.queueRefresh();
		});
	}

	onunload(): void {
		this.isUnloaded = true;
		this.lifecycleGeneration += 1;
		this.isLayoutReady = false;
		this.forceRefreshPending = false;
		this.activeNote = null;
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		for (const lightbox of [...this.activeLightboxes]) {
			lightbox.close();
		}
		this.activeLightboxes.clear();
		for (const modal of [...this.activeDiagnostics]) {
			modal.close();
		}
		this.activeDiagnostics.clear();
	}

	getActiveNote(): TFile | null {
		if (this.isUnloaded) {
			return null;
		}
		this.captureActiveNote();
		return this.activeNote;
	}

	getLayoutMode(): GalleryLayoutMode {
		return this.gallerySettings.layoutMode;
	}

	getTileScale(): number {
		return this.gallerySettings.tileScale;
	}

	showDiagnostics(): void {
		if (!this.isUnloaded) {
			const modal = openGalleryDiagnostics(this.app, this.manifest.version, (closed) => {
				this.activeDiagnostics.delete(closed);
			});
			this.activeDiagnostics.add(modal);
		}
	}

	async setLayoutMode(mode: GalleryLayoutMode): Promise<void> {
		if (this.isUnloaded) {
			return;
		}
		this.gallerySettings.layoutMode = mode;
		for (const view of this.getGalleryViews()) {
			view.setLayoutMode(mode);
		}
		await this.saveSettings();
	}

	async setTileScale(value: number): Promise<void> {
		if (this.isUnloaded) {
			return;
		}
		const scale = normalizeTileScale(value);
		this.gallerySettings.tileScale = scale;
		for (const view of this.getGalleryViews()) {
			view.setTileScale(scale);
		}
		await this.saveSettings();
	}

	private saveSettings(): Promise<void> {
		const snapshot = { ...this.gallerySettings };
		// Layout changes and live slider updates share the same serial writer;
		// an older, slower write must never overwrite the latest selection.
		this.settingsSave = this.settingsSave.catch(() => undefined).then(() => {
			return this.saveData(snapshot);
		});
		return this.settingsSave;
	}

	revealSource(media: GalleryMedia): Promise<void> {
		// Preserve rejection so context-menu navigation can keep its viewer open
		// and let the invoking surface report the failure exactly once.
		return revealMediaSource(this.app, media);
	}

	openLightbox(
		media: readonly GalleryMedia[],
		initialIndex: number,
		onViewed: (item: GalleryMedia, index: number) => void,
		restoreFocus?: () => void,
	): void {
		if (this.isUnloaded) {
			return;
		}
		let lightbox!: MediaLightbox;
		lightbox = new MediaLightbox(
			this.app,
			media,
			initialIndex,
			(item) => this.revealSource(item),
			onViewed,
			(shouldRestoreFocus) => {
				this.activeLightboxes.delete(lightbox);
				if (shouldRestoreFocus && !this.isUnloaded) {
					restoreFocus?.();
				}
			},
		);
		this.activeLightboxes.add(lightbox);
		lightbox.open();
	}

	private captureActiveNote(): void {
		const file = this.app.workspace.getActiveFile();
		this.activeNote = file?.extension === 'md' ? file : null;
	}

	private async activateGallery(): Promise<SectionGalleryView | null> {
		const generation = this.lifecycleGeneration;
		if (!this.isActiveGeneration(generation)) {
			return null;
		}
		this.captureActiveNote();
		let createdLeaf = false;
		let leaf = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_SECTION_GALLERY,
		)[0];

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
			if (!leaf) {
				new Notice('Could not open the right sidebar.');
				return null;
			}
			createdLeaf = true;
			try {
				await leaf.setViewState({
					type: VIEW_TYPE_SECTION_GALLERY,
					active: true,
				});
			} catch (error) {
				if (!this.isActiveGeneration(generation)) {
					return null;
				}
				throw error;
			}
		}

		if (!this.isActiveGeneration(generation)) {
			return null;
		}
		try {
			await this.app.workspace.revealLeaf(leaf);
		} catch (error) {
			if (!this.isActiveGeneration(generation)) {
				return null;
			}
			throw error;
		}
		if (!this.isActiveGeneration(generation)) {
			return null;
		}
		if (leaf.view instanceof SectionGalleryView) {
			if (!createdLeaf) {
				leaf.view.refresh();
			}
			leaf.view.refreshVisibleMedia();
			return leaf.view;
		}
		return null;
	}

	private async focusGallery(): Promise<void> {
		const generation = this.lifecycleGeneration;
		const view = await this.activateGallery();
		if (this.isActiveGeneration(generation)) {
			view?.focusGallery();
		}
	}

	private openGalleryFromCommand(focus: boolean): void {
		const generation = this.lifecycleGeneration;
		const action = focus ? this.focusGallery() : this.activateGallery();
		void action.catch(() => {
			if (this.isActiveGeneration(generation)) {
				new Notice(focus ? 'Could not focus the gallery. Please try again.' : 'Could not open the gallery. Please try again.');
			}
		});
	}

	private isActiveGeneration(generation: number): boolean {
		return !this.isUnloaded && this.lifecycleGeneration === generation;
	}

	private galleryReferences(path: string): boolean {
		return this.getGalleryViews().some((view) => view.referencesFile(path));
	}

	private getGalleryViews(): SectionGalleryView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_SECTION_GALLERY)
			.map((leaf) => leaf.view)
			.filter((view): view is SectionGalleryView => {
				return view instanceof SectionGalleryView;
			});
	}

	private queueRefresh(force = false): void {
		if (this.isUnloaded) {
			return;
		}
		const generation = this.lifecycleGeneration;
		this.forceRefreshPending ||= force;
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			if (!this.isActiveGeneration(generation)) {
				return;
			}
			this.refreshTimer = null;
			const forceRefresh = this.forceRefreshPending;
			this.forceRefreshPending = false;
			for (const view of this.getGalleryViews()) {
				view.refresh(forceRefresh);
			}
		}, REFRESH_DELAY_MS);
	}
}
