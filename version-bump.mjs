import { readFileSync, writeFileSync } from 'node:fs';

const targetVersion = process.env.npm_package_version;
if (!/^\d+\.\d+\.\d+$/.test(targetVersion ?? '')) {
	throw new Error('Obsidian releases require an x.y.z version.');
}
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;

manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, '\t')}\n`);

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', `${JSON.stringify(versions, null, '\t')}\n`);
}

// Keep the independently inspectable code/CSS markers in sync with npm version.
for (const [file, pattern, replacement] of [
	['src/mobile-diagnostics.ts', /GALLERY_BUILD_VERSION = '[^']+';/u, `GALLERY_BUILD_VERSION = '${targetVersion}';`],
	['styles.css', /--section-gallery-build-version: [\d.]+;/u, `--section-gallery-build-version: ${targetVersion};`],
]) {
	const source = readFileSync(file, 'utf8');
	if (!pattern.test(source)) throw new Error(`Missing version marker in ${file}`);
	writeFileSync(file, source.replace(pattern, replacement));
}
