# Gallery

Browse the images and videos in your active note, grouped by its heading hierarchy. Gallery provides a searchable sidebar and a full-window viewer on desktop, iOS and Android.

## Features

- Local images and videos from the active Markdown note.
- Collapsible H1–H6 sections, including nested sections and per-section media counts.
- A pinned current-section heading while browsing long sections; nested headings share one compact row.
- Native-style search across section titles and media filenames, with filtered and highlighted results.
- A native image/video type filter that combines with search and carries the visible result set into the full-window viewer.
- One adaptive control to collapse or expand the complete heading tree.
- A square grid with either edge-to-edge crops or whole-image fitting inside each tile.
- Live tile-scale settings from 60–180%, independent of sidebar width, with a reset to 100%.
- One keyboard entry command with arrow navigation across section headers and media tiles.
- Full-window image and video viewer.
- Previous and next navigation with arrow keys, horizontal pointer or trackpad gestures, or fast filmstrip scrubbing.
- Tap the image or its unobstructed surrounding stage to hide or show the viewer interface.
- Mobile media fills the available viewing area while preserving its proportions, including small originals. In portrait orientation, hiding controls frees space around the existing media center instead of shifting it down.
- Pinch-to-zoom and pan for images on touch devices, plus trackpad pinch, Ctrl-wheel, double-click, and panning on desktop.
- Full heading breadcrumb, filename, counter, section-aware filmstrip, and a metadata panel in the viewer. Video information includes duration and frame rate when available. Crossing a section briefly shows its breadcrumb over the media.
- One-click return to the exact embed location in the note.
- Native file sharing when the operating system exposes a compatible share sheet.
- Android native share/open chooser when the WebView does not expose Web Share.
- Native-style desktop context menus for copying the original media file or its vault path, revealing it in the system file manager, and opening either source location.
- Desktop and mobile support.
- Light and dark theme support using Obsidian CSS variables.
- Local mobile diagnostics for verifying installed files, system insets and media capabilities.

## Performance

Gallery reads Obsidian's metadata cache for the active note; it does not scan the vault for media. Tiles render in bounded batches. Images and video stills use small cached thumbnails, with limited decoder concurrency and offscreen cancellation. Videos never autoplay in the grid. The viewer keeps at most the two adjacent image originals ready for page transitions. A Web Share file read happens only after an explicit click; Android's native fallback passes the original vault-relative path without copying the file into JavaScript memory.

On iOS, a paused native video thumbnail is used as a fallback if the system cannot produce a cached still. It does not autoplay and is unloaded offscreen; codec support still depends on the device.

The plugin has no runtime dependencies.

## Supported media

The first release supports explicit local embeds that Obsidian can resolve from the vault, including Wiki embeds and Markdown embeds.

Images: AVIF, BMP, GIF, HEIC, HEIF, JPEG, JPG, JXL, PNG, SVG, and WebP.

Videos: M4V, MOV, MP4, OGV, and WebM.

Display and playback still depend on the codecs supported by Obsidian on the current operating system.

Remote URLs, media paths in frontmatter, raw HTML media, and media inside transcluded notes are outside the initial scope.

## Usage

1. Open a Markdown note that contains image or video embeds.
2. Select the images icon in the ribbon, or run **Gallery: Open media** from the command palette.
3. Use the toolbar search and media-type filter actions to narrow the gallery, collapse or expand all sections, and switch between filling or fitting media inside square tiles.
4. Select a heading to collapse only that heading and everything nested inside it.
5. For keyboard navigation, run **Gallery: Focus media** or assign it a hotkey. Use **Up/Down** to move through headings and grids; on a heading use **Right** to expand or enter it and **Left** to collapse it or return to its parent. Press **Enter** on a tile to open it.
6. Select a tile to open the full-window viewer.
7. In the viewer, tap an image to hide or restore the interface. On mobile, use the locate button to return to that embed in the note; on desktop, choose **Go to source in note** from the media context menu.
8. Swipe up, press **Up**, or select the information button to inspect the vault path, file size, dimensions, type, and modification time. Swipe or press **Down** to hide it; another downward action closes the viewer.
9. Drag or flick the filmstrip to scrub quickly through nearby media. The item nearest the center becomes current and snaps into place when scrolling settles. Pinch an image to zoom, then drag it to pan; on desktop use a trackpad pinch, Ctrl-wheel, or a quick double-click.
10. Where supported, select the share button once to open the operating system's share sheet for the current file. On Android without Web Share, the native chooser includes open/edit/share targets.
11. Open **Settings → Gallery → Tile scale** to adjust thumbnail size. At the same panel width, a larger scale shows fewer tiles; no fixed column count is stored.

On mobile, the gallery opens in the right drawer and places its controls and media total above Obsidian's native view selector, matching Outline. Swipe horizontally in the viewer to move between items; the filmstrip uses the operating system's native touch momentum. In compact landscape mode, media information opens as a scrollable panel on the left. On desktop, right-click media for exact-file copy, reveal, and navigation actions; mouse and trackpad gestures work across the full-window viewer and its information panel.

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

Android sharing uses a feature-detected native Obsidian adapter fallback when Web Share is unavailable. That adapter is not a public typed API and may change; the button is available only when a supported path exists. File format support, native system gestures and share targets depend on the host/device. Browser automation cannot certify every physical device.

## Version history

Every user-visible change is recorded in [CHANGELOG.md](CHANGELOG.md). Work that has not been released yet stays under **Unreleased**; published versions receive their own dated section.

## Manual installation

Copy these release files into `<vault>/.obsidian/plugins/section-gallery/`:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian, then enable **Gallery** under **Settings → Community plugins**. The internal folder and ID remain `section-gallery` for compatibility with earlier installations.

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

Video frame rate is an estimate from presented frames, not a container-level FPS measurement; unavailable WebView APIs are reported explicitly. Mobile system UI and native sharing still require a real-device smoke test.

Use a dedicated test vault for UI testing. Do not enable development builds in a vault that contains important data.

## Release

Run `npm run release:prepare` to verify and assemble exactly three installation assets under `dist/<version>/`. Source, tests, dependencies, personal settings and reports are excluded. Keep the source in a separate development checkout outside your vault, and copy only these three files into a test vault.

See [release preparation](docs/RELEASING.md) for the public-source checklist, GitHub release and Obsidian Community submission. The plugin must be reviewed by the directory before appearing in its installation catalog.

## License

[MIT](LICENSE)
