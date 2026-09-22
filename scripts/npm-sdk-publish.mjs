#!/usr/bin/env node
// Phát hành bốn SDK npm bằng một lệnh. Tài khoản bật 2FA thì truyền mã qua biến môi trường
// `NPM_CONFIG_OTP=123456 pnpm sdk:publish` — pnpm đọc nó như config `otp`. KHÔNG thêm cờ `--otp` vào
// script: cờ nằm trong argv nên mã sẽ lọt vào log lệnh và lịch sử shell.
import {
  createSdkReleaseCommands,
  discoverPublicPackageDirs,
  parseSdkPublishArgs,
  readSdkPackages,
  sdkExportsProblems,
  validateSdkCoverage,
  validateSdkPackages,
} from './lib/npm-sdk-release.mjs';
import { run } from './lib/run.mjs';

try {
  const options = parseSdkPublishArgs(process.argv.slice(2));
  validateSdkCoverage(discoverPublicPackageDirs());
  // Thiếu điều kiện `default` là host CommonJS/Jest nạp gói không được — hỏng âm thầm, chỉ người
  // nhúng mới phát hiện. Chặn ngay tại cổng phát hành.
  const exportsProblems = sdkExportsProblems();
  if (exportsProblems.length > 0) {
    throw new Error(`exports không hợp lệ:\n  - ${exportsProblems.join('\n  - ')}`);
  }
  const packages = readSdkPackages();
  const version = validateSdkPackages(packages);
  console.log(
    `[npm-sdk] Kiểm tra release ${version}: ${packages.map(({ name }) => name).join(', ')}`,
  );

  const commands = createSdkReleaseCommands(packages, options);
  for (const { command, args, cwd } of commands) run(command, args, cwd ? { cwd } : undefined);

  console.log(
    options.dryRun
      ? '[npm-sdk] Dry-run hoàn tất; chưa package nào được publish.'
      : `[npm-sdk] Đã publish toàn bộ SDK version ${version}.`,
  );
} catch (error) {
  console.error(`[npm-sdk] LỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
