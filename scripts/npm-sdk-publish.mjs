#!/usr/bin/env node
// Phát hành bốn SDK npm bằng một lệnh. Tài khoản bật 2FA thì truyền mã qua biến môi trường
// `NPM_CONFIG_OTP=123456 pnpm sdk:publish` — pnpm đọc nó như config `otp`. KHÔNG thêm cờ `--otp` vào
// script: cờ nằm trong argv nên mã sẽ lọt vào log lệnh và lịch sử shell.
import {
  createSdkReleaseCommands,
  daLenRegistry,
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

  // Sau khi publish thật: đối chiếu registry. Publish tuần tự core → web → react → react-native, nên
  // một gói đầu thất bại (mã 2FA hết hạn giữa chừng) mà gói sau vẫn lên sẽ để lại trên npm một gói
  // trỏ dependency vào version không tồn tại — đã xảy ra 22/09/2026 với @mapslibvn/react@0.13.0.
  // `run()` chỉ biết mã thoát của từng lệnh, không biết trạng thái cuối trên registry.
  if (!options.dryRun) {
    const thieu = [];
    for (const { name } of packages) {
      const co = await daLenRegistry(name, version);
      if (co === null) {
        console.warn(`[npm-sdk] Không hỏi được registry về ${name}@${version} — hãy tự kiểm.`);
      } else if (!co) {
        thieu.push(name);
      }
    }
    if (thieu.length > 0) {
      throw new Error(
        `${thieu.join(', ')} CHƯA lên npm ở version ${version} dù lệnh publish đã chạy. ` +
          'Các gói phụ thuộc chúng có thể đã lên và đang hỏng (ETARGET khi cài). ' +
          'Publish riêng từng gói còn thiếu: cd packages/<gói> && ' +
          'NPM_CONFIG_OTP=<mã> pnpm publish --access public --publish-branch main --no-git-checks',
      );
    }
    console.log(`[npm-sdk] Registry xác nhận đủ ${packages.length} gói ở ${version}.`);
  }

  console.log(
    options.dryRun
      ? '[npm-sdk] Dry-run hoàn tất; chưa package nào được publish.'
      : `[npm-sdk] Đã publish toàn bộ SDK version ${version}.`,
  );
} catch (error) {
  console.error(`[npm-sdk] LỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
