import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SDK_PACKAGE_DIRS } from './npm-sdk-release.mjs';

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

describe('npm release contract', () => {
  it('mọi gói SDK public đều có README trong tarball', () => {
    for (const dir of SDK_PACKAGE_DIRS) {
      const manifest = readJson(`${dir}/package.json`);
      expect(existsSync(`${dir}/README.md`), `${dir}/README.md`).toBe(true);
      expect(manifest.files, `${dir}/package.json files`).toContain('README.md');
    }
  });

  it('SDK trình duyệt không chấp nhận MapLibre GL JS có lỗ hổng GHSA-jrc7-96c5-q579', () => {
    const web = readJson('packages/web/package.json');
    const react = readJson('packages/react/package.json');

    expect(web.peerDependencies['maplibre-gl']).toBe('^6.4.1');
    expect(react.peerDependencies['maplibre-gl']).toBe('^6.4.1');
    expect(web.devDependencies['maplibre-gl']).toBe('^6.8.0');
    expect(react.devDependencies['maplibre-gl']).toBe('^6.8.0');
  });
});
