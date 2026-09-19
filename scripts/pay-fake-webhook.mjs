#!/usr/bin/env node
// Ký và bắn một webhook PayOS giả vào API (spec 17). Dùng cho harness và cho kiểm tra tay.
//
//   node scripts/pay-fake-webhook.mjs --order-code 100001 --amount 650000 [--reference FT1]
//        [--code 00] [--base http://127.0.0.1:8799] [--key <checksum>]
//
// Khoá lấy từ --key, rồi PAYOS_CHECKSUM_KEY trong env, rồi FAKE_CHECKSUM của harness. Script TỪ
// CHỐI trỏ vào production: bắn vào đó bằng khoá thật là tự tạo một giao dịch giả trên hệ thống thật.
import { dungWebhook, FAKE_CHECKSUM } from './lib/payos-fake.mjs';

/** @param {string} name @param {string} [macDinh] @returns {string | undefined} */
const arg = (name, macDinh) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : macDinh;
};

const base = (arg('base', 'http://127.0.0.1:8799') ?? '').replace(/\/+$/, '');
if (/ai-solutions\.io\.vn/.test(base)) {
  console.error('Từ chối: script này không bắn vào production.');
  process.exit(2);
}
const orderCode = Number(arg('order-code'));
const amount = Number(arg('amount'));
if (!Number.isInteger(orderCode) || !Number.isInteger(amount)) {
  console.error('Cần --order-code và --amount là số nguyên');
  process.exit(2);
}

const khoa = arg('key') ?? process.env.PAYOS_CHECKSUM_KEY ?? FAKE_CHECKSUM;
const than = dungWebhook(
  {
    orderCode,
    amount,
    reference: arg('reference', `FT${Date.now()}`) ?? '',
    code: arg('code', '00') ?? '00',
  },
  khoa,
);
const res = await fetch(`${base}/v1/pay/payos/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(than),
});
console.log(`${res.status} ${await res.text()}`);
process.exitCode = res.ok ? 0 : 1;
