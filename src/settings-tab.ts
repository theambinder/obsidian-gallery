import { Notice, PluginSettingTab, type App, type Plugin, type SettingDefinitionItem } from 'obsidian';
import type { Setting } from 'obsidian';
import { DEFAULT_TILE_SCALE } from './settings';
import { MIN_TILE_SIZE_LEVEL, MAX_TILE_SIZE_LEVEL, tileLevelToScale, tileScaleToLevel } from './gallery-tile-size';

interface GallerySettingsHost {
	getTileScale(): number;
	setTileScale(value: number): Promise<void>;
	getSeparateMobileTileScale(): boolean;
	setSeparateMobileTileScale(value: boolean): Promise<void>;
	getMobileTileScale(): number;
	setMobileTileScale(value: number): Promise<void>;
	getShowSections(): boolean;
	setShowSections(value: boolean): Promise<void>;
}

export class GallerySettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly host: GallerySettingsHost) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		if (key === 'showSections') return this.host.getShowSections();
		if (key === 'separateMobileTileScale') return this.host.getSeparateMobileTileScale();
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (typeof value !== 'boolean') return;
		if (key === 'showSections') {
			await this.host.setShowSections(value);
		} else if (key === 'separateMobileTileScale') {
			await this.host.setSeparateMobileTileScale(value);
			this.update();
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: this.host.getSeparateMobileTileScale() ? 'Desktop tile scale' : 'Tile scale',
				desc: 'Choose a fixed size from 1 to 20. Larger sizes show fewer tiles. Resizing the panel does not change this setting.',
				aliases: ['size', 'zoom', 'thumbnails'],
				render: (setting) => this.renderTileScale(setting, false),
			},
			{
				name: 'Use separate mobile tile scale',
				desc: 'Choose a different tile size on phones and tablets. Turn off to use the same size on every device.',
				aliases: ['phone', 'tablet', 'Android', 'iOS'],
				control: { type: 'toggle', key: 'separateMobileTileScale', defaultValue: false },
			},
			{
				name: 'Mobile tile scale',
				desc: 'Choose a fixed size from 1 to 20 for phones and tablets. Desktop tile size stays unchanged.',
				aliases: ['phone', 'tablet', 'Android', 'iOS', 'size', 'zoom'],
				visible: () => this.host.getSeparateMobileTileScale(),
				render: (setting) => this.renderTileScale(setting, true),
			},
			{
				name: 'Show sections',
				desc: 'Group tiles under note headings. Turn off to show a continuous grid.',
				aliases: ['headings', 'groups'],
				control: { type: 'toggle', key: 'showSections', defaultValue: true },
			},
		];
	}

	private renderTileScale(setting: Setting, mobile: boolean): void {
		const saveScale = (scale: number): Promise<void> => mobile
			? this.host.setMobileTileScale(scale)
			: this.host.setTileScale(scale);
		setting.setClass('section-gallery-tile-scale-setting');
		setting.addSlider((slider) => {
			slider
				.setLimits(MIN_TILE_SIZE_LEVEL, MAX_TILE_SIZE_LEVEL, 1)
				.setValue(tileScaleToLevel(mobile ? this.host.getMobileTileScale() : this.host.getTileScale()))
				.setDisplayFormat(String)
				.setInstant(true)
				.onChange((value) => {
					void saveScale(tileLevelToScale(value)).catch(() => {
						new Notice('Could not save the tile scale. Please try again.');
					});
				});
		}).addExtraButton((button) => {
			button.setIcon('rotate-ccw').setTooltip(mobile ? 'Reset mobile tile scale' : 'Reset tile scale').onClick(() => {
				void saveScale(DEFAULT_TILE_SCALE).then(() => {
					this.update();
				}).catch(() => {
					new Notice('Could not save the tile scale. Please try again.');
				});
			});
		});
	}
}
