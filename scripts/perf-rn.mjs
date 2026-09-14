#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { BUNDLE_ID } from './lib/example-rn.mjs';
import {
  formatEvidence,
  gestureCommands,
  hasErrorEvent,
  navCommitsPerFix,
  parseGfxinfo,
  parsePerfLines,
  summarize,
} from './lib/perf-rn.mjs';
import { capture, run, sleep } from './lib/run.mjs';

const ROUNDS = 10;

/**
 * Kích thước màn hình từ `adb shell wm size`. Khi máy đang đặt override (`adb shell wm size
 * WxH`), lệnh in CẢ `Physical size:` lẫn `Override size:` — phải ưu tiên Override (kích thước
 * đang hiển thị thật) chứ không lấy match đầu tiên, nếu không toạ độ cử chỉ sẽ tính theo kích
 * thước sai và có thể vuốt ra ngoài màn hình thật mà không báo lỗi gì.
 */
function screenSize() {
  const out = capture('adb', ['shell', 'wm', 'size']);
  const override = out.match(/Override size:\s*(\d+)x(\d+)/);
  const physical = out.match(/Physical size:\s*(\d+)x(\d+)/);
  const m = override ?? physical;
  if (!m) throw new Error('Không đọc được kích thước màn hình từ `adb shell wm size`');
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Nhãn thiết bị để ghi vào evidence — không có thì evidence vô nghĩa. */
function deviceLabel() {
  const serial = capture('adb', ['get-serialno']);
  const model = capture('adb', ['shell', 'getprop', 'ro.product.model']);
  const release = capture('adb', ['shell', 'getprop', 'ro.build.version.release']);
  return `${serial} · ${model} · Android ${release}`;
}

/** @param {Record<string, unknown>[]} events */
function errorMessage(events) {
  const err = events.find((e) => e.kind === 'error');
  return typeof err?.message === 'string' ? err.message : '(không rõ)';
}

/** Mở lại app từ đầu và đợi dòng map_ready, trả số ms; null nếu quá hạn HOẶC có lỗi thật. */
async function oneRound() {
  run('adb', ['shell', 'am', 'force-stop', BUNDLE_ID]);
  run('adb', ['logcat', '-c']);
  run('adb', ['shell', 'monkey', '-p', BUNDLE_ID, '-c', 'android.intent.category.LAUNCHER', '1'], {
    stdio: 'ignore',
  });
  for (let waited = 0; waited < 30_000; waited += 500) {
    await sleep(500);
    const events = parsePerfLines(capture('adb', ['logcat', '-d']));
    // Thoát sớm khi lỗi thật (khoá/mạng…) — đừng chờ hết 30s rồi mới báo, và đừng lẫn với
    // "chưa đo được" (timeout bình thường).
    if (hasErrorEvent(events)) {
      console.error(`  lỗi: ${errorMessage(events)}`);
      return null;
    }
    const ready = events.find((e) => e.kind === 'map_ready');
    if (ready && typeof ready.ms === 'number') return ready.ms;
  }
  return null;
}

async function main() {
  if (process.argv.includes('--ios')) {
    console.error(
      'iOS không có công cụ tương đương `dumpsys gfxinfo`.\n' +
        'Đo iOS bằng quan sát trên máy thật (bản Release) và ghi tay vào evidence.',
    );
    process.exit(2);
  }
  if (capture('adb', ['get-state']) !== 'device') {
    console.error('Không thấy thiết bị Android. Mở emulator hoặc cắm máy rồi chạy lại.');
    process.exit(1);
  }

  const device = deviceLabel();
  console.log(`Đo trên ${device}`);

  /** @type {number[]} */
  const readyMs = [];
  for (let i = 0; i < ROUNDS; i++) {
    const ms = await oneRound();
    if (ms !== null) readyMs.push(ms);
    console.log(
      `  lượt ${i + 1}/${ROUNDS}: ${ms === null ? 'quá hạn/lỗi (xem ở trên)' : `${ms} ms`}`,
    );
  }

  // Lượt cuối để app sống. Bắn cử chỉ NGAY, trong khoảng NAV_DELAY_MS của perf-screen, để số
  // frame giật phản ánh kéo bản đồ thuần chứ không lẫn với camera tự bám lúc dẫn đường.
  run('adb', ['shell', 'dumpsys', 'gfxinfo', BUNDLE_ID, 'reset'], { stdio: 'ignore' });
  const { width, height } = screenSize();
  for (const args of gestureCommands(width, height)) {
    run('adb', args, { stdio: 'ignore' });
    await sleep(300);
  }
  const gfxRaw = capture('adb', ['shell', 'dumpsys', 'gfxinfo', BUNDLE_ID]);
  const gfx = parseGfxinfo(gfxRaw);
  // null có 2 nghĩa: không có output (app không chạy — đã biết) hoặc có output nhưng parse thất
  // bại (định dạng Android đã đổi). Phân biệt ở đây vì đây là chỗ duy nhất có cả 2 mảnh thông tin.
  if (gfx === null && gfxRaw.trim()) {
    console.warn('  cảnh báo: gfxinfo có output nhưng không parse được — định dạng Android đổi?');
  }

  // Rồi mới tới pha dẫn đường giả lập của lượt cuối; chờ tối đa 3 phút cho nó tới nơi, nhưng
  // thoát ngay nếu thấy lỗi thật — không chờ hết hạn mức cho một khoá đã chết.
  console.log('Chờ pha dẫn đường giả lập…');
  /** @type {number | null} */
  let commitsPerFix = null;
  let navFailed = false;
  for (let waited = 0; waited < 180_000; waited += 2000) {
    await sleep(2000);
    const events = parsePerfLines(capture('adb', ['logcat', '-d']));
    if (hasErrorEvent(events)) {
      console.log(`  lỗi trong pha dẫn đường: ${errorMessage(events)} — dừng sớm`);
      navFailed = true;
      break;
    }
    commitsPerFix = navCommitsPerFix(events);
    if (commitsPerFix !== null) break;
  }
  if (commitsPerFix === null && !navFailed)
    console.log('  không thấy nav_done — ô này ghi dấu gạch');

  const md = formatEvidence({
    device,
    build: process.argv.includes('--release') ? 'Release' : 'Debug',
    mapReady: summarize(readyMs),
    gfx,
    commitsPerFix,
  });
  console.log(`\n${md}`);

  if (process.argv.includes('--write')) {
    mkdirSync('docs/evidence/perf', { recursive: true });
    const path = 'docs/evidence/perf/2026-09-14-baseline-rn.md';
    writeFileSync(path, `# Baseline hiệu năng RN — 14/09/2026\n\n${md}\n`, 'utf8');
    console.log(`\nĐã ghi ${path}`);
  }
}

await main();
