# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## 0.9.2 - 2026-09-21

### Fixed

- Preserve the media center when hiding viewer controls in mobile portrait orientation.
- Fit small mobile viewer images and videos up to their available bounds without cropping or stretching their proportions.
- Remove the seam between consecutive pinned section headings that exposed an ancestor heading during scrolling.

## 0.9.1 - 2026-09-20

### Fixed

- Recognize fast repeated trackpad swipes that start at their peak, without treating a fading momentum tail as another page.
- Remove Obsidian's extra mobile drawer spacing above pinned Gallery headings while preserving the search field and system safe area.
- Keep native video controls accessible immediately after carousel selection instead of hiding the player behind a still while waiting for a decoded frame.
- Fall back to a paused native video thumbnail on iOS when still extraction fails; retain bounded loading and offscreen cleanup without autoplay.

### Changed

- Include playback position, seeking and native-control state in the optional privacy-preserving support report.

## 0.9.0 - 2026-09-20

### Added

- Keep the current section heading pinned while its media scrolls, with one shared row for nested sections instead of a tall heading stack.
- Document scoped CSS snippet customization and provide an optional example.
- Prepare a strict three-file release directory with a repeatable packaging check and a public-source submission checklist.

### Changed

- Rename the public plugin and sidebar to Gallery; preserve the internal section-gallery ID and existing settings.
- Keep mobile diagnostics as an explicit support command, not a regular settings row.

### Fixed

- Prevent a delayed trackpad momentum tail from starting a second page, and preserve uncapped gesture magnitudes when distinguishing a rapid fresh swipe from old momentum.
- Synchronize code and stylesheet diagnostic version markers during version bumps.
- Close diagnostic windows and cancel delayed visibility retries on unload; report failed gallery navigation and layout saves without unhandled rejections.

## 0.8.3 - 2026-09-20

### Added

- Add a native tile-scale setting (60–180%, default 100%) with live updates, reset and serialized persistence.
- Add a local mobile diagnostic report with separate code/manifest/stylesheet versions, display bounds, safe-area inputs and codec/API capabilities. Copying or saving the report is explicit; no media paths or note content are collected.
- Offer Android's native file chooser with sharing when Web Share is unavailable or cannot handle the selected file.

### Fixed

- Expand media into the freed vertical space when viewer controls are hidden while preserving aspect ratio and width-limited image size.
- Respect both WebView and Obsidian system insets on all four sides; keep Android controls clear of status and navigation bars in either orientation.
- Generate bounded image stills for video tiles and the filmstrip instead of displaying inactive Android video elements with a gray play poster. Cancel offscreen decoding and show an explicit unavailable-preview state for decode failures.
- Reserve newly decoded thumbnails until their tiles attach, preventing simultaneous completions from evicting each other's frames.
- Drive page and filmstrip release with one animation clock; preserve flick velocity, cancel reversed or interrupted gestures, and allow a new touch to grab an unfinished transition without jumping.
- Keep unloaded neighbor previews fitted to the available page bounds and reuse captured video stills in swipe previews.

## 0.8.2 - 2026-09-20

### Fixed

- Wait for actual touch release before snapping the filmstrip when Android hands a pointer gesture to native scrolling; recover cleanly from lost capture and interrupted multi-touch.
- Stop video and invalidate pending sharing immediately when the viewer closes, including delayed phone-modal teardown.
- Safely request the first video thumbnail frame on mobile, account for skipped frame callbacks in approximate FPS, and report unavailable FPS on unsupported WebViews.
- Prevent duplicate thumbnail jobs after rapid scrolling, stop decode work after disposal, preserve unknown-header image proportions, and release bitmap/canvas resources on failures.
- Use consistent image/video preload margins in observer and fallback visibility checks to avoid unnecessary decoder churn.
- Ignore stale section events and detached video callbacks; move the existing selection marker with keyboard navigation.
- Prevent delayed startup, sidebar activation, and refresh callbacks from reviving an unloaded plugin instance.
- Keep the landscape filmstrip clear of bottom controls, fit the toolbar on narrow mobile panels, and prevent long breadcrumbs from covering media.

### Performance

- Share one bounded tile-rendering queue across sections, avoid repeated array shifts, and discard collapsed-section work.
- Read thumbnail-priority geometry once per candidate only when a loading slot is free.
- Avoid creating highlight-position arrays when only checking search matches.

## 0.8.1 - 2026-08-11

### Added

- Add an image/video type filter that composes with Gallery search and keeps the resulting media set in the full-window viewer.
- Show video duration on gallery tiles and add duration and frame-rate rows to video information.

### Changed

- Dismiss the mobile keyboard after submitting a search and simplify mobile search and tile selection states.

### Fixed

- Improve fitted video tile layout, remove the viewer video hover tooltip, and refine the desktop information-button treatment.

## 0.8.0 - 2026-08-10

### Added

- Add a native-style Gallery search action with immediate input focus, filename and section filtering, highlighted matches, and restoration of the original collapsed hierarchy when search closes.

## 0.7.8 - 2026-08-10

### Added

- Highlight the most recently viewed media tile per note and use it as the preferred keyboard-entry point for the gallery.

### Changed

- Match mobile viewer controls to Obsidian's native iOS surfaces in both light and dark themes.
- Simplify the desktop viewer header with a centered title, a corner close action, and source navigation kept in the media context menu.

### Fixed

- Keep desktop trackpad page movement aligned one-to-one with the interactive media transition and avoid a full filmstrip geometry scan on the first gesture frame.
- Complete desktop context-menu navigation before closing the viewer, return focus to the actual last-viewed gallery tile, and show only one moving keyboard-focus outline while navigating.
- Remove the mobile background surface behind the viewer breadcrumb and media title.

## 0.7.7 - 2026-08-08

### Changed

- Match the metadata surface to the native Gallery background on light desktop themes and use distinct primary/secondary light surfaces for the open mobile information layout.
- Balance compact-landscape controls and center both the media and metadata content within their available regions.

### Fixed

- Remove metadata panel shadows and smooth its layout transition without mid-animation filmstrip recentering.

## 0.7.6 - 2026-08-08

### Changed

- Refine the compact filmstrip with edge-to-edge inactive thumbnails and continuously morph the outgoing and incoming selections during page swipes.
- Match viewer controls, metadata, and filmstrip section separators to the active light or dark theme.
- Make desktop trackpad paging use the same deliberate release threshold and rapid consecutive cadence as touch paging.

### Fixed

- Restore vertical media centering on phones without letting the filmstrip overlap the current media.
- Hide the phone viewer immediately while Obsidian completes its native modal-close animation.
- Remove Obsidian's unused native modal header so the Gallery viewer content reaches every edge of the mobile viewport.

## 0.7.5 - 2026-08-08

### Changed

- Refine the compact filmstrip so inactive previews use slimmer inner margins while the current preview stays full-height and square inside a wider active slot.
- Match the full-window viewer background to the active Obsidian light or dark theme.
- Use the interactive page transition for desktop trackpad navigation while keeping keyboard navigation immediate.

### Fixed

- Keep the decoded neighboring original visible through a completed page swipe instead of briefly restoring its thumbnail.
- Move the filmstrip continuously with an interactive mobile page swipe and settle both surfaces together.
- Strengthen the phone viewer's full-viewport geometry so core modal safe-area limits cannot leave a top gap.

## 0.7.4 - 2026-08-08

### Changed

- Refine the compact filmstrip with slightly wider inactive previews, tighter spacing, and restored breathing room around the current item.
- Use bounded full-resolution neighbor previews for interactive mobile page swipes while keeping distant originals unloaded.

### Fixed

- Recognize consecutive desktop trackpad gestures sooner without splitting one momentum tail into multiple actions.
- Restore mobile filmstrip inertia while preserving magnetic settling.
- Remove the remaining compact-landscape top gap and prevent a light rotation flash before the viewer geometry settles.

## 0.7.3 - 2026-08-08

### Added

- Add an interactive mobile page swipe that reveals the adjacent photo continuously under the finger before committing or returning to the current item.

### Changed

- Make inactive filmstrip items narrow vertical previews while keeping the current item square, fitting substantially more media on screen.
- Let mobile media use the area behind the safe header and suppress the intermediate full-screen frame during orientation changes.
- Remove the top divider from the first metadata row.

### Fixed

- Allow consecutive desktop stage and filmstrip wheel gestures without requiring pointer movement while retaining one action per physical gesture.

## 0.7.2 - 2026-08-08

### Changed

- Give the current filmstrip item substantially more side breathing room and animate its selection with a quick eased snap.
- Remove the redundant **Information** heading and compact the metadata panel.
- Tighten top-level gallery section spacing while preserving the nested heading hierarchy.
- Raise the mobile viewer header and smooth responsive layout changes during device rotation.

### Fixed

- Make each desktop trackpad gesture produce exactly one state-aware action while still recognizing the next deliberate swipe promptly.

## 0.7.1 - 2026-08-08

### Changed

- Replace the filmstrip's fixed white selection frame with extra breathing room around the current item and a stronger centered snap after slow scrolling, while preserving fast inertial scrubbing.
- Add more inner space around fitted tile media, tighten section rows, use the native sidebar heading color, and enlarge the viewer breadcrumb.
- Refine compact phone landscape controls and media clearances, and extend the floating mobile toolbar fade beyond the gallery edges.

### Fixed

- Limit each main viewer swipe or trackpad gesture to one media step.
- Make a downward gesture dismiss open media information without letting the same gesture's momentum close the viewer.
- Remove hover tooltips from individual viewer filmstrip items while retaining their accessible names.
- Bound fallback thumbnail dimensions on both axes for unusually tall images.

## 0.7.0 - 2026-08-07

### Added

- Show a brief heading breadcrumb when viewer navigation crosses into another note section.

### Changed

- Replace the gallery ratio control with the supplied Lucide-style two-state icon and match native sidebar heading size and weight.
- Make the filmstrip select the item crossing its center immediately while keeping full-resolution media deferred until scrolling settles.
- Reduce the phone filmstrip height and move the information panel to the left side in compact landscape layouts.
- Keep the information action visibly active while its metadata panel is open and center media in the remaining viewer stage.

### Fixed

- Match Obsidian's native mobile drawer background in light and dark themes, and keep the media total above the phone's floating-navigation fade.
- Restore native mobile toolbar spacing and keep Section Gallery controls centered when the Minimal theme changes sidebar toolbar alignment.
- Remove duplicate viewer and toolbar tooltips, including the inherited **Section Gallery media** tooltip over gallery tiles.
- Track native desktop filmstrip gestures from the first trackpad event and coalesce mouse dragging to animation frames for stable continuous scrubbing.
- Ignore late full-resolution loads from an earlier filmstrip gesture so chained scrubbing cannot replace the newest preview with stale media.

## 0.6.0 - 2026-08-07

### Added

- Add a **Focus media gallery** command as a single keyboard entry point for the sidebar.
- Extend arrow-key navigation across section headers and tile grids: **Left** and **Right** collapse, expand, and enter sections, while **Up** and **Down** move between grids and headings.

### Changed

- Enlarge the Photos-style ratio icon and its spacing, and match section-heading text to Obsidian's native sidebar size.
- Use native horizontal touch scrolling for the mobile filmstrip so iOS supplies continuous momentum across repeated flicks while full originals remain deferred until settling.
- Keep the metadata table in a dedicated scroll area above the fixed viewer controls and constrain its desktop content to a readable centered width.
- Copy the original macOS file object from the desktop context menu without rasterizing or converting its format; browser fallback is allowed only for the unchanged source MIME type.
- Remove tile placeholder backgrounds and the desktop viewer's magnifier cursor.

### Fixed

- Keep the mobile media total visible and centered in the right side of the native-style bottom toolbar.
- Route desktop trackpad gestures across the complete viewer, including stationary cursors and the metadata table, and recognize a new gesture before the previous momentum tail fully ends.
- Let downward mouse or trackpad gestures dismiss metadata while preserving normal scrolling inside the table.
- Keep media centered and at a stable size when the viewer interface is hidden.
- Require two mouse clicks within 240 ms and a small pointer radius before double-click zoom activates, so slower clicks only toggle the interface.
- Cancel pending touch-filmstrip state when keyboard or viewer navigation changes the current item.
- Preserve normal desktop filmstrip thumbnail clicks while pointer capture activates only after a real drag begins.

## 0.5.0 - 2026-08-07

### Added

- Add keyboard navigation between gallery tiles with the arrow keys.
- Add viewer keyboard controls: **Up** opens information, **Down** hides it or closes the viewer, while **Left**, **Right**, and **Escape** keep their navigation behavior.
- Add desktop pointer and trackpad gestures for media navigation, information, dismissal, zooming, and panning.
- Add inertial filmstrip scrubbing that continues after a quick touch release while keeping the centered item current.

### Changed

- Place the phone gallery controls above Obsidian's native drawer selector, with the media total centered on the right side.
- Treat both tile-ratio modes as equal actions instead of presenting one as pressed.
- Keep information and Share controls anchored below the metadata table when information is open.
- Reduce the metadata-to-filmstrip gap, increase spacing around section dividers, and lower the viewer header below the macOS title bar.
- Remove visual previous/next controls from the viewer on every platform.

### Fixed

- Remove duplicate plugin-generated media tooltips while retaining accessible labels and native tooltips.
- Prevent touch hover and restored focus from leaving the first section or viewer buttons highlighted after closing the viewer.
- Keep hidden viewer controls out of keyboard navigation and re-clamp zoomed images after interface transitions.
- Prioritize filmstrip previews nearest the center, keep chained flicks on lightweight previews, and limit center lookup during inertia to cached positions.
- Preserve a usable media stage with the information panel open in compact landscape windows and honor reduced-motion preferences.

## 0.4.0 - 2026-08-07

### Added

- Add a desktop **Reveal in Finder** action, with native file-manager labels on Windows and Linux.

### Changed

- Match the native Outline header with one centered inline action row on desktop and mobile, without a floating mobile toolbar.
- Remove the active note title from the gallery header and show the total as a bare number after the controls.
- Move the complete filmstrip as one continuous lightweight track under a fixed center frame; the media nearest the center becomes current while preview bytes stay limited to the viewport.
- Center the first and last filmstrip items, correct the touch drag direction, and make section boundaries more prominent.
- Open the operating system share sheet from one explicit tap without a preparation notice or second tap.
- Let a downward swipe dismiss the information panel, remove its source-note field, and hide visual previous/next arrows on mobile.
- Let taps anywhere on the unobstructed media stage show or hide the viewer interface.

### Fixed

- Make desktop filmstrip thumbnail clicks reliably replace the main media.
- Remove the redundant **Gallery controls** parent tooltip while retaining each action's own tooltip.
- Hide Obsidian's mobile sidebar toggles and raised modal close control while the full-window viewer is open.

## 0.3.0 - 2026-08-06

### Added

- Add swipe-down viewer dismissal and swipe-up access to a media information panel.
- Add vault path, source note, file size, dimensions, type, and modified-time metadata.
- Add image pinch-to-zoom up to 5× with panning.
- Add section separators and fast drag-to-scrub navigation to the viewer filmstrip.
- Add native-style desktop context menus for copying media or paths and opening media or source locations.

### Changed

- Keep every gallery tile square in both modes; the alternate mode now fits the complete image or video inside its tile.
- Replace separate collapse-all and expand-all buttons with one state-aware Outline-style control.
- Use native Obsidian clickable-icon hit areas and center the toolbar below the summary on desktop or at the bottom on mobile.
- Replace the ratio icon with a persistent Photos-style frame and directional arrows.
- Prepare Share files only after an explicit tap and use bounded filmstrip previews while scrubbing.

### Fixed

- Refresh thumbnail visibility after the mobile drawer is revealed so initially expanded sections no longer appear empty.
- Keep thumbnail loading viewport-limited when a drawer is hidden or has zero size.
- Remove Obsidian's duplicate modal close control while retaining one correctly positioned viewer close button.
- Keep viewer navigation aligned to the displayed media and reset zoom when changing items.
- Reset zoom when the information panel or viewport changes, and clear stale Share preparation state after navigation.

## 0.2.0 - 2026-08-06

### Added

- Add collapsible H1–H6 heading hierarchy with nested section counts.
- Add collapse-all and expand-all toolbar controls.
- Add square and original-aspect justified gallery layouts.
- Add full heading breadcrumbs and a nearby-media filmstrip to the viewer.
- Add tap-to-hide viewer controls.
- Add native file sharing when the platform supports the Web Share API.

### Changed

- Generate small viewport-limited image thumbnails instead of decoding full-resolution originals in the gallery.
- Limit thumbnail work and cache size more aggressively on mobile.
- Avoid creating media tiles for collapsed sections.
- Align viewer navigation controls to the displayed media bounds.
- Place the source-navigation action opposite a single close button in the viewer header.

### Fixed

- Prevent the gallery from retaining off-screen image and video sources.
- Override Obsidian's default button height so square tiles remain square.
- Remove the duplicate viewer close button.
- Keep aspect layout responsive as thumbnail dimensions arrive.
- Preserve image-tap interface toggling when pointer capture is active.
- Bound both thumbnail dimensions for extremely tall or wide source images.
- Restore viewer controls automatically when hidden-image navigation reaches a video.

## 0.1.0 - 2026-08-06

- Add the section-aware right-sidebar gallery.
- Add local image and video support.
- Add the full-window viewer, keyboard navigation, touch swipes, and source navigation.
- Add viewport-based media loading and batched tile rendering.
