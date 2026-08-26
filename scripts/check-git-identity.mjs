#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { checkGitIdentity } from './lib/git-identity.mjs';

/** @param {string[]} args */
function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const argv = process.argv.slice(2);
const remoteFlag = argv.indexOf('--remote-url');
const remoteUrl =
  remoteFlag >= 0 ? (argv[remoteFlag + 1] ?? '') : git(['remote', 'get-url', 'origin']);
const email = git(['config', 'user.email']);

const { errors, warnings } = checkGitIdentity({ remoteUrl, email });
for (const warning of warnings) console.warn(`[git-identity] CẢNH BÁO: ${warning}`);
for (const error of errors) console.error(`[git-identity] LỖI: ${error}`);
if (errors.length > 0) process.exit(1);
console.log('[git-identity] OK — remote và author thuộc account cá nhân dotienphong');
