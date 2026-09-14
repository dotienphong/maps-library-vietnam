// Hàm thuần cho `pnpm perf:rn` (scripts/perf-rn.mjs). Không spawn, không đọc file.

/** Phải khớp PREFIX trong examples/embed-rn/perf-screen.tsx. */
export const PERF_PREFIX = 'MLVPERF ';

/**
 * Lọc các dòng có tiền tố và parse phần JSON đứng sau. Dòng hỏng bị bỏ, không ném lỗi —
 * logcat cắt dòng dài là chuyện thường.
 * @param {string} text
 * @returns {Record<string, unknown>[]}
 */
export function parsePerfLines(text) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(PERF_PREFIX);
    if (at === -1) continue;
    try {
      out.push(JSON.parse(line.slice(at + PERF_PREFIX.length)));
    } catch {
      // bỏ qua
    }
  }
  return out;
}

/**
 * p50/p95 theo cách `perf-autocomplete.mjs` đang dùng: sắp tăng dần rồi lấy phần tử theo chỉ số.
 * @param {number[]} values
 * @returns {{ n: number, p50: number | null, p95: number | null }}
 */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, p50: null, p95: null };
  /** @param {number} p */
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { n: sorted.length, p50: pct(50) ?? null, p95: pct(95) ?? null };
}

/**
 * Đọc `adb shell dumpsys gfxinfo <pkg>`. Hai dòng cần là "Total frames rendered" và "Janky frames".
 * @param {string} text
 * @returns {{ total: number, janky: number, jankyPct: number } | null}
 */
export function parseGfxinfo(text) {
  const total = text.match(/Total frames rendered:\s*(\d+)/);
  const janky = text.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/);
  if (!total || !janky) return null;
  return {
    total: Number(total[1]),
    janky: Number(janky[1]),
    jankyPct: Number(janky[2]),
  };
}

/**
 * Kịch bản cử chỉ cố định: hai lần kéo ngang, một lần kéo dọc, một lần chụm zoom giả bằng kéo
 * chậm. Toạ độ suy từ kích thước màn hình để chạy được trên mọi thiết bị.
 * @param {number} width
 * @param {number} height
 * @returns {string[][]} mỗi phần tử là argv cho `adb`
 */
export function gestureCommands(width, height) {
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const dx = Math.round(width / 4);
  const dy = Math.round(height / 6);
  const swipe = (/** @type {number[]} */ a) => ['shell', 'input', 'swipe', ...a.map(String)];
  return [
    swipe([cx + dx, cy, cx - dx, cy, 400]),
    swipe([cx - dx, cy, cx + dx, cy, 400]),
    swipe([cx, cy + dy, cx, cy - dy, 400]),
    swipe([cx, cy - dy, cx, cy + dy, 400]),
  ];
}

/**
 * Số commit React của cây map trên mỗi fix GPS, đọc từ sự kiện `nav_done` mà perf-screen phát ra
 * lúc phiên giả lập tới nơi (hoặc dừng sớm). null khi: không có `nav_done`; 0 fix (chia cho 0);
 * hoặc `profiler === false` — nghĩa là bản Release, nơi `Profiler.onRender` của React không chạy
 * (đã xác nhận: chuỗi "onRender" không tồn tại trong bundle ReactFabric-prod.js), nên `commits`
 * luôn là 0 một cách vô nghĩa, không phải số thật. Thiếu hẳn trường `profiler` (log cũ trước khi
 * trường này tồn tại) được coi như `true` để không phá vỡ dữ liệu cũ.
 * @param {Record<string, unknown>[]} events
 * @returns {number | null}
 */
export function navCommitsPerFix(events) {
  const done = events.find((e) => e.kind === 'nav_done');
  if (!done) return null;
  if (done.profiler === false) return null;
  const { fixes, commits } = done;
  if (typeof fixes !== 'number' || typeof commits !== 'number' || fixes === 0) return null;
  return Math.round((commits / fixes) * 100) / 100;
}

/**
 * true nếu có bất kỳ sự kiện `error` nào (ví dụ khoá API hết hạn, mất mạng) — dùng để CLI báo lỗi
 * rõ ràng thay vì để evidence hiện dấu gạch giống hệt "chưa đo được", hai tình huống hoàn toàn
 * khác nhau (một cái cần sửa khoá/mạng, một cái chỉ là chưa chạy xong).
 * @param {Record<string, unknown>[]} events
 * @returns {boolean}
 */
export function hasErrorEvent(events) {
  return events.some((e) => e.kind === 'error');
}

/** @param {number | null} n @param {string} [unit] */
const num = (n, unit = '') => (n === null ? '—' : `${n}${unit}`);

/**
 * Bảng evidence. Phần iOS và phần máy thật luôn có mặt, đánh dấu CHỜ PHONG — không bịa số.
 * @param {{
 *   device: string,
 *   build: string,
 *   mapReady: { n: number, p50: number | null, p95: number | null },
 *   gfx: { total: number, janky: number, jankyPct: number } | null,
 *   commitsPerFix: number | null,
 * }} r
 */
export function formatEvidence(r) {
  return [
    `**Nơi đo:** ${r.device} · bản dựng ${r.build}`,
    '',
    '| Số đo | Giá trị |',
    '|---|---|',
    `| Thời gian mở màn hình bản đồ (p50) | ${num(r.mapReady.p50, ' ms')} |`,
    `| Thời gian mở màn hình bản đồ (p95) | ${num(r.mapReady.p95, ' ms')} |`,
    `| Số lần đo | ${r.mapReady.n} |`,
    `| Tổng frame khi kéo/zoom | ${r.gfx ? r.gfx.total : '—'} |`,
    `| Frame giật | ${r.gfx ? `${r.gfx.janky} (${r.gfx.jankyPct} %)` : '—'} |`,
    `| Commit React mỗi fix GPS | ${num(r.commitsPerFix)} |`,
    '',
    '| Hạng mục cần máy thật | Trạng thái |',
    '|---|---|',
    '| FPS Android trên Mi 9 (Release) | CHỜ PHONG |',
    '| Quan sát iOS trên iPhone 14 Plus (Release) | CHỜ PHONG |',
  ].join('\n');
}
