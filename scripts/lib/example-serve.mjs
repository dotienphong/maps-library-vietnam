// Hàm thuần cho `pnpm example:embed` (scripts/example-embed.mjs).
export const EXAMPLE_PORT = 5500;
export const EXAMPLE_DIR = 'examples/embed-web';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** @param {string} pathname */
export function contentType(pathname) {
  const dot = pathname.lastIndexOf('.');
  const ext = dot === -1 ? '' : pathname.slice(dot).toLowerCase();
  return TYPES[/** @type {keyof typeof TYPES} */ (ext)] ?? 'application/octet-stream';
}

/**
 * Chỉ cho phép đọc file bên trong thư mục ví dụ; chặn `..` và đường dẫn tuyệt đối.
 * @param {string} url đường dẫn từ request, ví dụ `/` hoặc `/style.css`
 * @returns {string | null} tên file tương đối, hoặc null nếu không hợp lệ
 */
export function safeFile(url) {
  const pathname = (url.split('?')[0] ?? '/').split('#')[0] ?? '/';
  const clean = decodeURIComponent(pathname);
  if (clean.includes('\0') || clean.includes('..') || clean.includes('\\')) return null;
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  if (rel === '' || rel.startsWith('/')) return null;
  return rel;
}

/**
 * Khoá lấy từ `--key`, rồi tới biến môi trường. Không đọc từ file trong repo.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function resolveKey(argv, env) {
  const i = argv.indexOf('--key');
  const fromArg = i >= 0 ? argv[i + 1] : undefined;
  const key = fromArg ?? env.MAPSLIBVN_DEMO_KEY ?? '';
  if (!key) {
    throw new Error(
      'Thiếu khoá. Dùng: pnpm example:embed --key mlv_live_… (hoặc đặt MAPSLIBVN_DEMO_KEY trong .env)',
    );
  }
  if (!/^mlv_live_[0-9A-Za-z]{24}$/.test(key)) {
    throw new Error(`Khoá không đúng định dạng mlv_live_ + 24 ký tự: ${key.slice(0, 13)}…`);
  }
  return key;
}

/** @param {number} port @param {string} key */
export function exampleUrl(port, key) {
  return `http://localhost:${port}/?key=${encodeURIComponent(key)}`;
}

/** Lệnh mở trình duyệt theo hệ điều hành (Windows dùng `start` qua cmd). @param {string} platform */
export function openCommand(platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', ''] };
  return { cmd: 'xdg-open', args: [] };
}
