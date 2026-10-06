import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const prepareScript = resolve('scripts/prepare-release.mjs');
const bumpScript = resolve('version-bump.mjs');
const version = '0.9.0';

function withFixture(run: (directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), 'gallery-release-test-'));
	try {
		mkdirSync(join(directory, 'src'));
		writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ id: 'gallery', name: 'Gallery', version, minAppVersion: '1.13.4', fundingUrl: 'https://buymeacoffee.com/ambinder' }));
		writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }));
		writeFileSync(join(directory, 'versions.json'), JSON.stringify({ '0.8.3': '1.13.4', [version]: '1.13.4' }));
		writeFileSync(join(directory, 'main.js'), `const GALLERY_BUILD_VERSION = '${version}';`);
		writeFileSync(join(directory, 'styles.css'), `.probe { --section-gallery-build-version: ${version}; }`);
		writeFileSync(join(directory, 'src/mobile-diagnostics.ts'), `export const GALLERY_BUILD_VERSION = '${version}';`);
		run(directory);
	} finally {
		// Only remove the exact fixture path returned by mkdtemp, never a vault.
		rmSync(directory, { recursive: true, force: true });
	}
}

function prepare(directory: string) {
	return spawnSync(process.execPath, [prepareScript], { cwd: directory, encoding: 'utf8' });
}

void test('release packaging copies only the three distributable assets, never settings, sources or maps', () => {
	withFixture(directory => {
		writeFileSync(join(directory, 'data.json'), '{"personalPreference":"secret"}');
		writeFileSync(join(directory, 'main.js.map'), '{"source":"private"}');
		writeFileSync(join(directory, 'AUDIT.md'), 'Private report');
		mkdirSync(join(directory, 'node_modules'));
		writeFileSync(join(directory, 'node_modules/private-cache.txt'), 'Private dependency cache');
		const result = prepare(directory);
		assert.equal(result.status, 0, result.stderr);
		const destination = join(directory, 'dist', version);
		assert.deepEqual(readdirSync(destination).sort(), ['main.js', 'manifest.json', 'styles.css']);
		for (const file of readdirSync(destination)) {
			assert.deepEqual(readFileSync(join(destination, file)), readFileSync(join(directory, file)));
		}
		assert.match(result.stdout, /Ready: dist\/0\.9\.0 \(exactly 3 assets\)/u);
		assert.match(result.stdout, /main\.js\t\d+ bytes\t[a-f0-9]{64}/u);
	});
});

void test('release packaging rejects stale stylesheet markers before creating distributable assets', () => {
	withFixture(directory => {
		writeFileSync(join(directory, 'styles.css'), '.probe { --section-gallery-build-version: 0.8.3; }');
		const result = prepare(directory);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Rebuild before preparing this release/u);
		assert.equal(existsSync(join(directory, 'dist')), false);
	});
});

void test('release packaging rejects development paths and source-map references in runtime assets', () => {
	for (const leak of ['/Users/example/private-vault', '/private/tmp/build-cache', 'codex-clipboard-private.jpg', 'sourceMappingURL=main.js.map']) {
		withFixture(directory => {
			writeFileSync(join(directory, 'main.js'), `const version = '${version}'; // ${leak}`);
			const result = prepare(directory);
			assert.notEqual(result.status, 0, leak);
			assert.match(result.stderr, /development map or local path/u);
			assert.equal(existsSync(join(directory, 'dist')), false);
		});
	}
});

void test('release packaging refuses an unexpected existing dist file without deleting or overwriting it', () => {
	withFixture(directory => {
		const destination = join(directory, 'dist', version);
		mkdirSync(destination, { recursive: true });
		writeFileSync(join(destination, 'data.json'), 'keep this user file');
		writeFileSync(join(destination, 'main.js'), 'keep existing bundle');
		const result = prepare(directory);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Unexpected files in release directory: data\.json/u);
		assert.equal(readFileSync(join(destination, 'data.json'), 'utf8'), 'keep this user file');
		assert.equal(readFileSync(join(destination, 'main.js'), 'utf8'), 'keep existing bundle');
	});
});

void test('version bump synchronizes runtime and stylesheet markers, retaining compatibility history', () => {
	withFixture(directory => {
		const result = spawnSync(process.execPath, [bumpScript], {
			cwd: directory, encoding: 'utf8', env: { ...process.env, npm_package_version: '0.9.1' },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(join(directory, 'manifest.json'), 'utf8'), /"version": "0\.9\.1"/u);
		assert.match(readFileSync(join(directory, 'src/mobile-diagnostics.ts'), 'utf8'), /GALLERY_BUILD_VERSION = '0\.9\.1';/u);
		assert.match(readFileSync(join(directory, 'styles.css'), 'utf8'), /--section-gallery-build-version: 0\.9\.1;/u);
		assert.deepEqual(JSON.parse(readFileSync(join(directory, 'versions.json'), 'utf8')), { '0.8.3': '1.13.4', '0.9.0': '1.13.4', '0.9.1': '1.13.4' });
	});
});

void test('version bump retains the public plugin identity and funding link', () => {
	withFixture(directory => {
		const result = spawnSync(process.execPath, [bumpScript], {
			cwd: directory, encoding: 'utf8', env: { ...process.env, npm_package_version: '0.9.3' },
		});
		assert.equal(result.status, 0, result.stderr);
		const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as { id: string; fundingUrl: string; version: string };
		assert.equal(manifest.id, 'gallery');
		assert.equal(manifest.fundingUrl, 'https://buymeacoffee.com/ambinder');
		assert.equal(manifest.version, '0.9.3');
	});
});

void test('version bump rejects prerelease or malformed versions without modifying the fixture', () => {
	for (const candidate of ['0.9.1-beta.1', '0.9', '../../0.9.1', '']) {
		withFixture(directory => {
			const before = readFileSync(join(directory, 'manifest.json'), 'utf8');
			const result = spawnSync(process.execPath, [bumpScript], {
				cwd: directory, encoding: 'utf8', env: { ...process.env, npm_package_version: candidate },
			});
			assert.notEqual(result.status, 0, candidate);
			assert.match(result.stderr, /Obsidian releases require an x\.y\.z version/u);
			assert.equal(readFileSync(join(directory, 'manifest.json'), 'utf8'), before);
			assert.match(readFileSync(join(directory, 'styles.css'), 'utf8'), /--section-gallery-build-version: 0\.9\.0;/u);
		});
	}
});
