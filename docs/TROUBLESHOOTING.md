# Troubleshooting

## Update appears installed but the interface has not changed

The displayed plugin version comes from `manifest.json`; the code and stylesheet can still be older when a sync service has only transferred part of an update. Replace or sync **all three files together**: `main.js`, `manifest.json`, `styles.css`. Then disable/re-enable Gallery or restart Obsidian.

Run **Gallery: Show mobile diagnostics**. `buildVersion`, `manifestVersion`, and `stylesheetVersion` should match your release. A missing stylesheet marker is reported as `null`.

## Send a useful bug report

1. Reproduce the issue, including rotation or open metadata if relevant.
2. Close the viewer. Its last geometry is preserved in memory.
3. Run **Gallery: Show mobile diagnostics**, then select **Copy report** or **Save report to vault**.
4. Include reproduction steps, device/OS/Obsidian version, theme, and a short screen recording. On Android, note whether navigation uses gestures or three buttons.

The command is intentionally absent from regular settings: most users never need it. Reports contain device capabilities, dimensions, system insets and versions, but no filenames, media URLs, vault paths or note content. Nothing is sent automatically. Review anything you attach to a public issue; use a synthetic note rather than private files.

For advanced debugging, follow [Obsidian's mobile development guide](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development): Android WebViews can be inspected through desktop Chrome USB debugging; supported iOS WebViews through Safari on a Mac. The built-in report is usually sufficient to start.

## Video preview is unavailable

Gallery asks the system decoder for one small still without playing the video. Unsupported codecs, unavailable files, decode failures or a stalled load can prevent the preview. A filename extension does not identify all codec/profile details. Try a small known-working H.264 MP4, then compare with the problematic file. FPS is an estimate from played frames, not a file-container parser.

On iOS, Gallery can fall back to a paused native video thumbnail when still extraction fails. This cannot add codec support or bypass the host's media restrictions. Compare playback of the same file in the note and in Gallery. If it still fails, include a support report captured after opening the video and a small non-private sample when possible; the report includes decoder state, playback position and native-control availability, not media paths or contents.

## Android share button

Web Share is used where file sharing is supported. Otherwise, Gallery can use Obsidian's Android adapter to open the system chooser, including share targets. This native bridge is capability-checked because it is not a public typed API. Its presence and available destinations depend on the installed app/device.

## Before reporting gesture or layout issues

Temporarily disable CSS snippets and use the default theme. Test both orientations, image proportions, a cancelled half-swipe, quick repeated swipes, carousel inertia, pinch and closing a playing video. Never reset or remove your `data.json` as a first troubleshooting step.
