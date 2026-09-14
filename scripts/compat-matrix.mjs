#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crossSpawn from 'cross-spawn';
import {
  RN_MATRIX,
  appPackageJson,
  classifyFailure,
  comboId,
  formatMatrixTable,
} from './lib/compat-matrix.mjs';

const WORK_DIR = 'work/compat';
const TARBALL = 'examples/embed-rn/vendor/mapslibvn-react-native.tgz';

/**
 * Chạy lệnh, gom stdout + stderr, không ném lỗi — ô hỏng là dữ liệu, không phải sự cố.
 * @param {string} cmd @param {string[]} args @param {string} cwd
 */
function tryRun(cmd, args, cwd) {
  const r = crossSpawn.sync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

async function main() {
  const withBuild = process.argv.includes('--build');
  mkdirSync(WORK_DIR, { recursive: true });

  /** @type {{ combo: import('./lib/compat-matrix.mjs').Combo, ok: boolean, failure: string | null }[]} */
  const results = [];

  for (const combo of RN_MATRIX) {
    const id = comboId(combo);
    const dir = join(WORK_DIR, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'vendor'), { recursive: true });

    // Tarball copy vào từng ô: npm không theo được đường dẫn tương đối ra ngoài thư mục app.
    crossSpawn.sync('cp', [TARBALL, join(dir, 'vendor', 'mapslibvn-react-native.tgz')]);
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(appPackageJson(combo, 'vendor/mapslibvn-react-native.tgz'), null, 2)}\n`,
      'utf8',
    );

    console.log(`\n=== ${id} ===`);
    // --legacy-peer-deps: một số ô cố ý nằm dưới sàn peer mà chính @maplibre/maplibre-react-native
    // khai báo — không có cờ này, npm chặn NGAY tại bước cài, không bao giờ tới được bước build để
    // trả lời câu hỏi thật (mã của @mapslibvn/react-native có chạy được không).
    const install = tryRun(
      'npm',
      ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'],
      dir,
    );
    if (!install.ok) {
      const kind = classifyFailure(install.output);
      console.log(`  cài: HỎNG (${kind})`);
      console.log(install.output.split('\n').slice(-15).join('\n'));
      results.push({ combo, ok: false, failure: kind });
      continue;
    }
    console.log('  cài: ĐẠT');

    if (!withBuild) {
      results.push({ combo, ok: true, failure: null });
      continue;
    }

    const build = tryRun('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], dir);
    const verdict = build.ok;
    const buildKind = verdict ? null : classifyFailure(build.output);
    console.log(`  dựng: ${verdict ? 'ĐẠT' : `HỎNG (${buildKind})`}`);
    if (!verdict) console.log(build.output.split('\n').slice(-15).join('\n'));
    results.push({ combo, ok: verdict, failure: buildKind });
    // Ô dựng xong chiếm hàng trăm MB; dọn ngay.
    rmSync(join(dir, 'android'), { recursive: true, force: true });
  }

  const md = formatMatrixTable(results);
  console.log(`\n${md}`);

  if (process.argv.includes('--write')) {
    mkdirSync('docs/evidence/perf', { recursive: true });
    const path = 'docs/evidence/perf/2026-09-14-compat-matrix.md';
    writeFileSync(path, `# Ma trận tương thích RN — 14/09/2026\n\n${md}\n`, 'utf8');
    console.log(`\nĐã ghi ${path}`);
  }

  const broken = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - broken}/${results.length} ô ĐẠT`);
}

await main();
