#!/usr/bin/env node
// Mở trang nhúng thử độc lập bằng một lệnh (nghiệm thu M5, spec 13 hàng M5):
//   pnpm example:embed --key mlv_live_…
//   pnpm example:embed                  (lấy khoá từ MAPSLIBVN_DEMO_KEY trong .env)
// Phục vụ examples/embed-web trên http://localhost:5500 rồi mở trình duyệt kèm ?key=…
// Khoá KHÔNG nằm trong repo: truyền qua tham số hoặc biến môi trường. Ctrl+C để dừng.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import 'dotenv/config';
import {
  EXAMPLE_DIR,
  EXAMPLE_PORT,
  contentType,
  exampleUrl,
  openCommand,
  resolveKey,
  safeFile,
} from './lib/example-serve.mjs';

const key = resolveKey(process.argv.slice(2), process.env);
const root = resolve(EXAMPLE_DIR);
if (!existsSync(join(root, 'index.html'))) {
  throw new Error(`Không thấy ${EXAMPLE_DIR}/index.html — chạy từ gốc repo`);
}

const server = createServer((req, res) => {
  const rel = safeFile(req.url ?? '/');
  const file = rel ? join(root, rel) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});

server.listen(EXAMPLE_PORT, '127.0.0.1', () => {
  const url = exampleUrl(EXAMPLE_PORT, key);
  console.log(`▶ Trang thử: ${url}`);
  console.log(`  Khoá phải có origin http://localhost:${EXAMPLE_PORT} trong allowed_origins.`);
  console.log('  Ctrl+C để dừng.');
  const { cmd, args } = openCommand(process.platform);
  const child = spawn(cmd, [...args, url], { stdio: 'ignore', detached: true });
  child.on('error', () => console.log('  (không mở được trình duyệt — hãy mở URL trên bằng tay)'));
  child.unref();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
