import { Notice, PluginSettingTab, type App, type Plugin, type SettingDefinitionItem } from 'obsidian';
import { DEFAULT_TILE_SCALE } from './settings';
import { MIN_TILE_SIZE_LEVEL, MAX_TILE_SIZE_LEVEL, tileLevelToScale, tileScaleToLevel } from './gallery-tile-size';

interface GallerySettingsHost {
	getTileScale(): number;
	setTileScale(value: number): Promise<void>;
	getShowSections(): boolean;
	setShowSections(value: boolean): Promise<void>;
}

export class GallerySettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly host: GallerySettingsHost) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		return key === 'showSections' ? this.host.getShowSections() : undefined;
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		return key === 'showSections' && typeof value === 'boolean'
			? this.host.setShowSections(value)
			: Promise.resolve();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Tile scale',
				desc: 'Choose a fixed size from 1 to 20. Larger sizes show fewer tiles. Resizing the panel does not change this setting.',
				aliases: ['size', 'zoom', 'thumbnails'],
				render: (setting) => {
					setting.setClass('section-gallery-tile-scale-setting');
					setting.addSlider((slider) => {
						slider
							.setLimits(MIN_TILE_SIZE_LEVEL, MAX_TILE_SIZE_LEVEL, 1)
							.setValue(tileScaleToLevel(this.host.getTileScale()))
							.setDisplayFormat(String)
							.setInstant(true)
							.onChange((value) => {
								void this.host.setTileScale(tileLevelToScale(value)).catch(() => {
									new Notice('Could not save the tile scale. Please try again.');
								});
							});
					}).addExtraButton((button) => {
						button.setIcon('rotate-ccw').setTooltip('Reset tile scale').onClick(() => {
							void this.host.setTileScale(DEFAULT_TILE_SCALE).then(() => {
								this.update();
							}).catch(() => {
								new Notice('Could not save the tile scale. Please try again.');
							});
						});
					});
				},
			},
			{
				name: 'Show sections',
				desc: 'Group tiles under note headings. Turn off to show a continuous grid.',
				aliases: ['headings', 'groups'],
				control: { type: 'toggle', key: 'showSections', defaultValue: true },
			},
		];
	}
}
