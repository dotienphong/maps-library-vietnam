#!/usr/bin/env node
import {
  createSdkReleaseCommands,
  discoverPublicPackageDirs,
  parseSdkPublishArgs,
  readSdkPackages,
  validateSdkCoverage,
  validateSdkPackages,
} from './lib/npm-sdk-release.mjs';
import { run } from './lib/run.mjs';

try {
  const options = parseSdkPublishArgs(process.argv.slice(2));
  validateSdkCoverage(discoverPublicPackageDirs());
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
