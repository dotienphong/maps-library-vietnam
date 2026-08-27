#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
// Tải tài nguyên mở về đúng chỗ. Base style + sprite được commit; fonts bị gitignore.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OSM_LIBERTY = 'https://raw.githubusercontent.com/maputnik/osm-liberty/gh-pages';
const DARK_MATTER = 'https://raw.githubusercontent.com/openmaptiles/dark-matter-gl-style/master';
const FONTS_ZIP = 'https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip';
const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];

/** @param {string} url @param {string} dest @param {{ optional?: boolean }} [options] */
async function download(url, dest, { optional = false } = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    if (optional) {
      console.warn('⚠ bỏ qua', url, `HTTP ${response.status}`);
      return;
    }
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  console.log('✓', dest.replace(`${root}/`, ''));
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} thất bại (exit ${result.status})`);
  return result;
}

/** @param {string} parent @param {string} name */
function findDirectory(parent, name) {
  const result = spawnSync('find', [parent, '-type', 'd', '-name', name, '-print', '-quit'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Không tìm được thư mục font "${name}"`);
  return result.stdout.trim();
}

const only = process.argv[2];

if (!only || only === 'styles') {
  await download(`${OSM_LIBERTY}/style.json`, resolve(root, 'src/base/osm-liberty.json'));
  await download(`${OSM_LIBERTY}/LICENSE.md`, resolve(root, 'src/base/LICENSE.osm-liberty'), {
    optional: true,
  });
  await download(`${DARK_MATTER}/style.json`, resolve(root, 'src/base/dark-matter.json'));
  await download(`${DARK_MATTER}/LICENSE.md`, resolve(root, 'src/base/LICENSE.dark-matter'), {
    optional: true,
  });
  for (const file of [
    'osm-liberty.json',
    'osm-liberty.png',
    'osm-liberty@2x.json',
    'osm-liberty@2x.png',
  ]) {
    await download(`${OSM_LIBERTY}/sprites/${file}`, resolve(root, 'assets/sprites', file));
  }
  writeFileSync(
    resolve(root, 'src/base/SOURCES.md'),
    `# Nguồn base style (vendor ngày ${new Date().toISOString().slice(0, 10)})

- osm-liberty.json + sprites: ${OSM_LIBERTY} (BSD-3-Clause, xem LICENSE.osm-liberty)
- dark-matter.json: ${DARK_MATTER} (code BSD-3-Clause, thiết kế CC-BY 4.0, xem LICENSE.dark-matter)
- fonts: ${FONTS_ZIP} — Noto Sans (SIL OFL 1.1), chỉ lấy 3 stack: ${FONT_STACKS.join(', ')}

Cập nhật lại: pnpm --filter @mapslibvn/style vendor
`,
  );
}

if (!only || only === 'fonts') {
  const fontsDir = resolve(root, 'assets/fonts');
  if (FONT_STACKS.every((stack) => existsSync(resolve(fontsDir, stack, '0-255.pbf')))) {
    console.log('✓ fonts đã có');
  } else {
    const zip = resolve(root, 'assets/fonts.zip');
    const tempDir = resolve(root, 'assets/fonts-tmp');
    await download(FONTS_ZIP, zip);
    mkdirSync(fontsDir, { recursive: true });
    rmSync(tempDir, { recursive: true, force: true });
    run('unzip', ['-q', '-o', zip, '-d', tempDir]);
    for (const stack of FONT_STACKS) {
      const found = findDirectory(tempDir, stack);
      if (!found) throw new Error(`Không thấy stack "${stack}" trong zip`);
      const destination = resolve(fontsDir, stack);
      rmSync(destination, { recursive: true, force: true });
      renameSync(found, destination);
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(zip, { force: true });
    console.log('✓ fonts:', FONT_STACKS.join(', '));
  }
}
