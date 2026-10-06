# Release preparation

## Two different deliverables

The **public GitHub repository** contains readable source, tests, build configuration, lockfile, documentation, `LICENSE`, `manifest.json` and `versions.json`. Do not commit `node_modules`, generated `main.js`, `dist`, personal `data.json`, device reports or local audit artifacts. `.gitignore` covers these; check `git status` before every commit.

The **GitHub release assets** contain only `main.js`, `manifest.json`, `styles.css`. `npm run release:prepare` runs tests, type checking, the minified production build and lint, then creates `dist/<version>/` from an explicit allowlist. It rejects source maps, local machine paths and unexpected extra files. No runtime package installation or self-updater is included.

## Before the first public release

- Confirm the MIT author/license and public name. Gallery's plugin ID is `gallery` from version 0.9.3 onward. Development installations using `section-gallery` require the one-time migration documented in the README. Check name/ID availability again immediately before submission; a public-directory lookup does not reserve an ID.
- Review the README capabilities and limitations. Include one or two screenshots made with your own or freely licensed sample media, not private notes or unlicensed film screenshots.
- Complete a short real-device pass: macOS trackpad, Windows/Linux keyboard, iPhone portrait/landscape, Android navigation insets/video/share; default theme, light and dark. Browser tests do not certify native OS integration.
- Check `minAppVersion` against the APIs used. Current minimum is1.13.4; declarative settings require1.13.0 or newer. Desktop Electron helpers are dynamically loaded only in desktop branches; the plugin does not require them on mobile.
- Android's native share/open bridge is feature-detected but not a public typed API. Recheck it after major Obsidian mobile updates and disclose this conditional behavior.
- Prepare a support channel. This template uses GitHub Issues and private security advisories; enable private vulnerability reporting in the repository's settings.

## Prepare versioned files

For a later release, write its changelog entry, then use `npm version patch` or `npm version minor`. The version hook updates manifest, compatibility mapping and independent code/CSS diagnostic markers. Tags have no `v` prefix (`.npmrc`). Keep the changelog entry ready so the metadata regression test passes.

```sh
npm ci
npm run release:prepare
```

Review exactly three generated assets. Preserve the previous release for rollback; never replace an already-published tag's bytes to deliver a different version.

## Publish and submit

1. Create a public GitHub repository and push the reviewed source on its default branch. The repository URL must be one you own or are authorized to maintain.
2. Tag the release with exactly the manifest version, such as `0.9.3`, without a `v`. The supplied GitHub Actions workflow builds and creates a **draft** release; check it and publish it. Alternatively upload the three assets yourself. A ZIP alone is insufficient: attach each asset separately.
3. Sign in at [Obsidian Community](https://community.obsidian.md), link your GitHub account, and submit the repository through **Plugins → New plugin**.
4. Resolve the directory's scanner/review feedback. A local audit does not guarantee directory approval. Any changed code needs a new version/release.

The directory reads the manifest from the default branch and installs assets from the matching release. These steps follow the [current submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin) and [account setup guide](https://docs.obsidian.md/community-directory/set-up-and-claim), checked September20,2026. Recheck them when publishing; old tutorials using a pull request to `community-plugins.json` may no longer describe the current process.

Relevant policy references: [developer policies](https://docs.obsidian.md/community-directory/developer-policies), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [manifest schema](https://docs.obsidian.md/Reference/Manifest), [plugin checklist](https://docs.obsidian.md/oo/plugin).
