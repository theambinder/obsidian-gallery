import { Notice, PluginSettingTab, type App, type Plugin, type SettingDefinitionItem } from 'obsidian';
import {
	DEFAULT_TILE_SCALE,
	MAX_TILE_SCALE,
	MIN_TILE_SCALE,
	TILE_SCALE_STEP,
} from './settings';

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
				desc: 'Larger tiles show fewer items at the same sidebar width. Changes apply immediately; 100% is the original size.',
				aliases: ['size', 'zoom', 'thumbnails'],
				render: (setting) => {
					setting.setClass('section-gallery-tile-scale-setting');
					setting.addSlider((slider) => {
						slider
							.setLimits(MIN_TILE_SCALE, MAX_TILE_SCALE, TILE_SCALE_STEP)
							.setValue(this.host.getTileScale())
							.setDisplayFormat((value) => `${value}%`)
							.setInstant(true)
							.onChange((value) => {
								void this.host.setTileScale(value).catch(() => {
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
