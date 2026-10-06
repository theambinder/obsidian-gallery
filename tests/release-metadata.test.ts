import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { VIEW_NAME } from '../src/constants';

interface Manifest {
	id: string;
	name: string;
	description: string;
	author: string;
	isDesktopOnly: boolean;
	minAppVersion: string;
	version: string;
}

void test('public manifest meets basic Obsidian submission requirements', () => {
	const manifest = readJson<Manifest>('manifest.json');
	assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/u);
	assert.equal(manifest.id.includes('obsidian'), false);
	assert.equal(manifest.id.endsWith('plugin'), false);
	assert.equal(manifest.name, VIEW_NAME);
	assert.equal(/obsidian|plugin/iu.test(manifest.name), false);
	assert.match(manifest.name, /^[A-Za-z0-9 ()+-]+$/u);
	assert.ok(manifest.author.trim().length > 0);
	assert.ok(manifest.description.length > 0 && manifest.description.length <= 250);
	assert.ok(manifest.description.endsWith('.'));
	assert.equal(manifest.isDesktopOnly, false);
	assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
	assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/u);
	assert.ok(readFileSync('LICENSE', 'utf8').startsWith('MIT License'));
});

interface PackageMetadata {
	version: string;
}

interface PackageLock extends PackageMetadata {
	packages: {
		'': PackageMetadata;
	};
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

void test('keeps release metadata synchronized', () => {
	const manifest = readJson<Manifest>('manifest.json');
	const packageMetadata = readJson<PackageMetadata>('package.json');
	const packageLock = readJson<PackageLock>('package-lock.json');
	const versions = readJson<Record<string, string>>('versions.json');
	const changelog = readFileSync('CHANGELOG.md', 'utf8');
	const diagnostics = readFileSync('src/mobile-diagnostics.ts', 'utf8');
	const stylesheet = readFileSync('styles.css', 'utf8');

	assert.equal(packageMetadata.version, manifest.version);
	assert.equal(packageLock.version, manifest.version);
	assert.equal(packageLock.packages[''].version, manifest.version);
	assert.equal(versions[manifest.version], manifest.minAppVersion);
	assert.ok(diagnostics.includes(`GALLERY_BUILD_VERSION = '${manifest.version}'`));
	assert.ok(stylesheet.includes(`--section-gallery-build-version: ${manifest.version};`));
	assert.match(changelog, new RegExp(`^## ${manifest.version}\\b`, 'mu'));
});
