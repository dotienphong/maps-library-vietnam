#!/usr/bin/env node
// Đổi khoá S3 của máy chủ sang khoá suy từ CLOUDFLARE_API_TOKEN (quyền R2 Edit toàn tài khoản) và bật
// BACKUP_BUCKET trong infra/server/.env. Audit 09/09/2026: token S3 cũ chỉ có quyền bucket tiles nên
// backup không ghi được vào bucket riêng. Khoá S3 của R2 suy từ API token: ACCESS_KEY_ID = id token
// (GET /user/tokens/verify), SECRET_ACCESS_KEY = sha256(token) hex. Không in secret ra màn hình.
// Sau đó: docker compose … up -d --force-recreate --no-deps backup pipeline
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from './lib/server-env.mjs';

const path = resolve('infra/server/.env');
let text = readFileSync(path, 'utf8');
const env = parseEnv(text);
const token = env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('infra/server/.env thiếu CLOUDFLARE_API_TOKEN');

const verify = /** @type {{ success: boolean, result?: { id: string } }} */ (
  await (
    await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()
);
if (!verify.success || !verify.result) throw new Error('CLOUDFLARE_API_TOKEN không hợp lệ');
const accessKeyId = verify.result.id;
const secret = createHash('sha256').update(token).digest('hex');

if (env.RCLONE_CONFIG_R2_ACCESS_KEY_ID === accessKeyId) {
  console.log('RCLONE_CONFIG_R2_* đã là khoá suy từ API token — giữ nguyên.');
} else {
  text = text.replace(
    /^RCLONE_CONFIG_R2_ACCESS_KEY_ID=.*$/m,
    (line) =>
      `# Khoá S3 suy từ CLOUDFLARE_API_TOKEN (audit 09/09/2026); token S3 cũ giữ dạng comment OLD_ để quay lại nếu cần.\n# OLD_${line}\nRCLONE_CONFIG_R2_ACCESS_KEY_ID=${accessKeyId}`,
  );
  text = text.replace(
    /^RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=.*$/m,
    (line) => `# OLD_${line}\nRCLONE_CONFIG_R2_SECRET_ACCESS_KEY=${secret}`,
  );
  console.log('Đã thay RCLONE_CONFIG_R2_ACCESS_KEY_ID / SECRET_ACCESS_KEY.');
}

if (/^# ?BACKUP_BUCKET=/m.test(text)) {
  text = text.replace(/^# ?BACKUP_BUCKET=.*$/m, 'BACKUP_BUCKET=mapslibvn-backups');
  console.log('Đã bật BACKUP_BUCKET=mapslibvn-backups.');
} else if (!/^BACKUP_BUCKET=/m.test(text)) {
  text += `${text.endsWith('\n') ? '' : '\n'}BACKUP_BUCKET=mapslibvn-backups\n`;
  console.log('Đã thêm BACKUP_BUCKET=mapslibvn-backups.');
}
writeFileSync(path, text);
console.log(
  'Tiếp: docker compose --env-file infra/server/.env -f infra/server/compose.yml up -d --force-recreate --no-deps backup pipeline',
);
