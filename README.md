# Gallery

Browse images and videos from your active note in a searchable sidebar and a full-window viewer. Gallery works on desktop, iOS, and Android.

## Features

- Browse local images and videos from the active note.
- Search filenames and section headings, highlight matches, and filter images or videos. Search and filters also apply to the viewer.
- Browse collapsible, nested sections with media counts and a pinned heading that keeps your place while scrolling.
- Adjust tile size from 60–180% and switch between cropped thumbnails and whole images.
- Open media in a full-window viewer with swipe navigation, arrow keys, and a thumbnail strip.
- Zoom images, move around an enlarged image, and hide or show the viewer controls.
- View file information, including video duration and frame rate when available.
- Return to the original embed, share supported files, and use desktop context menus to copy or open media.
- Navigate section headings and media tiles with the keyboard, with support for light and dark themes.

## Performance

Gallery loads media from the active note rather than scanning the whole vault. Thumbnails load as they become visible, and videos never autoplay in the grid. The viewer prepares neighboring images for smooth navigation. Gallery has no runtime dependencies.

## Supported media

Gallery supports local files embedded in a note using Obsidian's wiki embeds or Markdown embeds.

Images: AVIF, BMP, GIF, HEIC, HEIF, JPEG, JPG, JXL, PNG, SVG, and WebP.

Videos: M4V, MOV, MP4, OGV, and WebM.

Display and playback still depend on the codecs supported by Obsidian on the current operating system.

Remote URLs, media paths in properties, raw HTML media, and media inside embedded notes are not supported.

## Use Gallery

1. Open a Markdown note that contains image or video embeds.
2. Select the images icon in the ribbon, or run **Gallery: Open media** from the command palette.
3. Use the toolbar to search filenames and headings, filter images or videos, collapse or expand all sections, and change how images fit inside tiles.
4. Select a heading to collapse only that heading and everything nested inside it.
5. For keyboard navigation, run **Gallery: Focus media** or assign it a keyboard shortcut. Use `Up` and `Down` to move through headings and grids. On a heading, use `Right` to expand or enter it and `Left` to collapse it or return to its parent. Press `Enter` on a tile to open it.
6. Select a tile to open the full-window viewer.
7. In the viewer, select an image or the empty area around it to hide or show the controls.
8. Swipe up, press `Up`, or select the information button to view the vault path, file size, dimensions, type, and modification time. Swipe down or press `Down` to hide the information panel. Another downward action closes the viewer.
9. Drag or flick the thumbnail strip to move quickly through nearby media. The item nearest the center becomes active and snaps into place when scrolling stops.
10. Where supported, select the share button to open the operating system's sharing options for the active file.
11. Open **Settings → Gallery → Tile scale** to adjust thumbnail size. At the same panel width, a larger scale shows fewer tiles; no fixed column count is stored.

### Desktop

Use `Left` and `Right`, or swipe horizontally on a trackpad, to switch media. To zoom an image, pinch on a trackpad, hold `Ctrl` while scrolling, or double-click. Drag an enlarged image to move around it.

Right-click media to copy the original file or its vault path, show it in the system file manager, or open it. Select **Go to source in note** to return to the embed in the note.

### Mobile

Gallery opens in the right sidebar, with its controls above Obsidian's view selector. Swipe horizontally in the viewer to switch media. Pinch an image to zoom, then drag it to move around it.

Media fills the available viewing area without cropping or stretching, including small images. In portrait orientation, hiding the controls frees space without shifting the image down. In compact landscape mode, file information opens in a scrollable panel on the left.

Select the locate button to return to the embed in the note. The share button appears when the device supports a sharing option. On Android, the system chooser may also offer apps that can open or edit the file.

## Privacy and permissions

- No network requests.
- No telemetry or analytics.
- No accounts, payments, or advertisements.
- No access outside the Obsidian vault.
- No writes to notes or attachments.
- Settings are saved locally. A diagnostic JSON file is created only when you select **Save report to vault**; it contains versions, device capabilities and geometry, never filenames, vault paths, URLs or note content. Nothing is uploaded automatically.
- Clipboard content is never read. Explicit copy actions write the selected media, its path, or a support report. On macOS, exact-file copy uses a desktop-only API and checks that the format it just wrote is present; unsupported image formats are never silently converted to PNG.
- Sharing sends only the currently selected local media file to a destination explicitly chosen by the user in the operating system's share sheet. Nothing is shared automatically.

## Customization and troubleshooting

Standard Obsidian CSS snippets can customize Gallery. See [CSS customization](docs/CUSTOMIZATION.md) for scoped selectors and an optional example; no extra plugin is required. Do not edit the installed `styles.css`, because updates replace it.

For support, run **Gallery: Show mobile diagnostics**. The report is optional and local, and the command does not send anything. See [troubleshooting](docs/TROUBLESHOOTING.md).

Playback and sharing depend on the installed Obsidian app, operating system, and device. A file that works on one device may not work on another. If a video preview or sharing option is unavailable, follow the troubleshooting guide above.

## Version history

Every user-visible change is recorded in [CHANGELOG.md](CHANGELOG.md). Work that has not been released yet stays under **Unreleased**; published versions receive their own dated section.

## Install Gallery manually

Copy these release files into `<vault>/.obsidian/plugins/gallery/`:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian, then enable **Gallery** under **Settings → Community plugins**.

## Development

Requirements: Node.js 20 or later and npm.

```bash
npm ci
npm run dev
```

Quality checks:

```bash
npm run check
```

The check runs unit tests, TypeScript validation, a production build, and the official Obsidian ESLint rules.

Use a dedicated test vault for UI testing. Do not enable development builds in a vault that contains important data.

### Technical details

Gallery reads Obsidian's metadata cache for the active note. Tiles render in small batches. Image and video thumbnails are cached, with limits on simultaneous decoding and cancellation when media moves offscreen. The viewer keeps at most the two adjacent original images ready for page transitions.

When Web Share is available, Gallery reads a file for sharing only after the user selects the share button. Otherwise, Android sharing can use Obsidian's native adapter to pass the original vault-relative path without copying the file into JavaScript memory. The adapter is not a public typed API and may change; Gallery checks that it is available before showing the button.

On iOS, a paused native video thumbnail is used as a fallback if the system cannot produce a cached still. It does not autoplay and is unloaded offscreen. Codec support still depends on the device.

Video frame rate is estimated from displayed frames rather than read from the file container. Unavailable WebView APIs are reported explicitly. Mobile system UI and native sharing require testing on physical devices; browser tests cannot verify every device.

## Release

Run `npm run release:prepare` to verify and assemble exactly three installation assets under `dist/<version>/`. Source, tests, dependencies, personal settings and reports are excluded. Keep the source in a separate development checkout outside your vault, and copy only these three files into a test vault.

See [release preparation](docs/RELEASING.md) for the public-source checklist, GitHub release and Obsidian Community submission. The plugin must be reviewed by the directory before appearing in its installation catalog.

## License

[MIT](LICENSE)
