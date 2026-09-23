#!/usr/bin/env node
// Phát hành bốn SDK npm bằng một lệnh. Từ 23/09/2026 npm xác thực publish qua trình duyệt (in link
// `npmjs.com/auth/cli/…`); nếu npm vẫn đòi mã 2FA thì truyền qua biến môi trường
// `NPM_CONFIG_OTP=123456 pnpm sdk:publish` — pnpm đọc nó như config `otp`. KHÔNG thêm cờ `--otp` vào
// script: cờ nằm trong argv nên mã sẽ lọt vào log lệnh và lịch sử shell.
import {
  choLenRegistry,
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

  // Sau khi publish thật: đối chiếu registry. Publish tuần tự core → web → react → react-native, nên
  // một gói đầu thất bại (mã 2FA hết hạn giữa chừng) mà gói sau vẫn lên sẽ để lại trên npm một gói
  // trỏ dependency vào version không tồn tại — đã xảy ra 22/09/2026 với @mapslibvn/react@0.13.0.
  // `run()` chỉ biết mã thoát của từng lệnh, không biết trạng thái cuối trên registry. npm xử lý
  // publish bất đồng bộ (vài phút) nên phải CHỜ, không được kết luận ngay sau lệnh cuối.
  if (!options.dryRun) {
    console.log('[npm-sdk] Chờ registry phục vụ tarball của cả bốn gói (npm xử lý mất vài phút)…');
    const { thieu, khongRo } = await choLenRegistry(
      packages.map(({ name }) => name),
      version,
      {
        onProgress: ({ sanSang, tong, daChoMs }) =>
          console.log(
            `[npm-sdk]   ${sanSang}/${tong} gói cài được sau ${Math.round(daChoMs / 1000)} giây…`,
          ),
      },
    );
    for (const name of khongRo) {
      console.warn(`[npm-sdk] Không hỏi được registry về ${name}@${version} — hãy tự kiểm.`);
    }
    if (thieu.length > 0) {
      throw new Error(
        `${thieu.join(', ')} vẫn CHƯA cài được ở version ${version} sau 15 phút chờ. ` +
          'Các gói phụ thuộc chúng có thể đã lên và đang hỏng (ETARGET khi cài). TRƯỚC KHI publish ' +
          'lại, kiểm từng gói: curl -I https://registry.npmjs.org/@mapslibvn/<gói>/-/<gói>-' +
          `${version}.tgz — nếu 200 là npm chỉ chậm, publish lại sẽ EPUBLISHCONFLICT. Nếu 404 và ` +
          '`npm view @mapslibvn/<gói> versions` không có version này, publish riêng gói đó: ' +
          'cd packages/<gói> && pnpm publish --access public --publish-branch main --no-git-checks',
      );
    }
    if (khongRo.length === 0) {
      console.log(`[npm-sdk] Registry xác nhận cài được đủ ${packages.length} gói ở ${version}.`);
    }
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
