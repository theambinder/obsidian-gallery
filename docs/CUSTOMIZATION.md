# CSS customization

Gallery uses normal DOM and scoped CSS classes, not a closed shadow root. Obsidian's built-in [CSS snippets](https://obsidian.md/help/snippets) can change its appearance on desktop and mobile. Install a snippet through **Settings → Appearance → CSS snippets**. Snippets are user-controlled and are not enabled automatically by Gallery.

## Supported appearance hooks

Use `body .section-gallery-view` to scope grid changes, and `.section-gallery-lightbox-container` / `.modal.section-gallery-lightbox` for the viewer. These public hook names are preserved for compatibility despite the shorter Gallery display name.

| Variable | Default | Scope / purpose |
| --- | --- | --- |
| `--section-gallery-gap` | `2px` | Space between grid tiles |
| `--section-gallery-radius` | `5px` | Tile corner radius |
| `--section-gallery-fit-inset` | `3px`, capped at 10% of the tile | Inner border for fitted images |
| `--section-gallery-tile-min` | Desktop `56px`, mobile `72px` | Base tile size before the user's scale setting |
| `--section-gallery-sticky-background` | Theme surface | Opaque pinned-heading background |

At 100% scale, the desktop baseline fits four columns in the standard test-vault sidebar with 261px of usable grid width. The grid remains adaptive: a custom narrow sidebar with 188px fits three columns, and wider panes fit more rather than forcing a four-column layout.

```css
/* Grid only; leaves other Obsidian panes untouched. */
body .section-gallery-view {
  --section-gallery-gap: 4px;
  --section-gallery-radius: 8px;
  --section-gallery-fit-inset: 5px;
}
```

Prefer the **Tile scale** setting for overall thumbnail size. Its 20 numbered levels represent fixed scales regardless of panel width, including larger sizes beyond the previous internal 500% limit. Reset restores level 8, the original 100% sizing. The grid still fills the panel width; changing that width changes the number of columns, not the selected scale number. Neighboring levels can produce the same columns at a given width. The runtime scale CSS variable is managed by the plugin. Internal swipe offsets, filmstrip widths, safe-area variables and transforms are calculated by the viewer and are not a stable customization API. Overriding them can break touch layout or system-bar clearance.

To display one continuous media grid without section headings, disable **Settings → Gallery → Show sections**. This changes grouping rather than styling; search by section heading and section labels in the viewer remain available.

To opt out of pinned headings without affecting other panes:

```css
body .section-gallery-view .section-gallery-section-header {
  position: static;
}
```

The pinned heading must keep an opaque, theme-compatible background to prevent overlapping labels. Use an equally specific mobile selector if customizing that background on phones:

```css
body.is-mobile .section-gallery-view {
  --section-gallery-sticky-background: var(--background-primary);
}
```

An optional ready-to-copy example is [examples/gallery-customization.css](../examples/gallery-customization.css). Disable the snippet to revert instantly. Do not edit the installed plugin stylesheet; the next update replaces it. Styling customization cannot change search, indexing or gesture logic.
