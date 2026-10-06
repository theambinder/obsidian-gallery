import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// A deliberate allowlist: never ship source, dependencies, settings, reports,
// build caches, test fixtures or personal vault content in plugin assets.
export const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid release version.');
const packageMetadata = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== packageMetadata.version) throw new Error('Build versions do not match.');
const code = await readFile('main.js', 'utf8');
const css = await readFile('styles.css', 'utf8');
if (code.includes('sourceMappingURL=') || /\/Users\/|\/private\/|codex-clipboard/u.test(code + css)) {
	throw new Error('Release assets contain a development map or local path.');
}
if (!code.includes(manifest.version) || !css.includes(`--section-gallery-build-version: ${manifest.version};`)) {
	throw new Error('Rebuild before preparing this release.');
}
const destination = join('dist', manifest.version);
await mkdir(destination, { recursive: true });
const extra = (await readdir(destination)).filter(file => !RELEASE_FILES.includes(file));
if (extra.length) throw new Error(`Unexpected files in release directory: ${extra.join(', ')}`);
for (const file of RELEASE_FILES) {
	const bytes = await readFile(file);
	if (!bytes.length) throw new Error(`Empty release asset: ${file}`);
	await copyFile(file, join(destination, file));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const info = await stat(join(destination, file));
	console.log(`${file}\t${info.size} bytes\t${sha256}`);
}
console.log(`Ready: ${destination} (exactly ${RELEASE_FILES.length} assets)`);
