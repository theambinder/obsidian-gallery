# CSS customization

Gallery uses normal DOM and scoped CSS classes, not a closed shadow root. Obsidian's built-in [CSS snippets](https://obsidian.md/help/snippets) can change its appearance on desktop and mobile. Install a snippet through **Settings → Appearance → CSS snippets**. Snippets are user-controlled and are not enabled automatically by Gallery.

## Supported appearance hooks

Use `body .section-gallery-view` to scope grid changes, and `.section-gallery-lightbox-container` / `.modal.section-gallery-lightbox` for the viewer. These public hook names are preserved for compatibility despite the shorter Gallery display name.

| Variable | Default | Scope / purpose |
| --- | --- | --- |
| `--section-gallery-gap` | `2px` | Space between grid tiles |
| `--section-gallery-radius` | `5px` | Tile corner radius |
| `--section-gallery-fit-inset` | `3px` | Inner border for fitted images |
| `--section-gallery-tile-min` | `72px` | Base tile size before the user's scale setting |
| `--section-gallery-sticky-background` | Theme surface | Opaque pinned-heading background |

```css
/* Grid only; leaves other Obsidian panes untouched. */
body .section-gallery-view {
  --section-gallery-gap: 4px;
  --section-gallery-radius: 8px;
  --section-gallery-fit-inset: 5px;
}
```

Prefer the **Tile scale** setting for overall thumbnail size; its runtime CSS variable is managed by the plugin. Internal swipe offsets, filmstrip widths, safe-area variables and transforms are calculated by the viewer and are not a stable customization API. Overriding them can break touch layout or system-bar clearance.

To opt out of pinned headings without affecting other panes:

```css
body .section-gallery-view .section-gallery-section-header {
  position: static;
}
```

The pinned header must keep an opaque theme-compatible surface to prevent overlapping labels. Use an equally specific mobile selector if customizing that surface on phones:

```css
body.is-mobile .section-gallery-view {
  --section-gallery-sticky-background: var(--background-primary);
}
```

An optional ready-to-copy example is [examples/gallery-customization.css](../examples/gallery-customization.css). Disable the snippet to revert instantly. Do not edit the installed plugin stylesheet; the next update replaces it. Styling customization cannot change search, indexing or gesture logic.
