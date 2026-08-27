#!/usr/bin/env node
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { run } from './lib/run.mjs';

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function rollbackCommand(env) {
  if (env.MAPSLIBVN_IN_CONTAINER === '1') {
    return {
      cmd: 'node',
      args: ['pipelines/tiles/src/manifest.mjs', 'rollback'],
    };
  }

  return {
    cmd: 'docker',
    args: [
      'compose',
      '--env-file',
      '.env',
      '-f',
      'infra/dev/compose.yml',
      '--profile',
      'pipeline',
      'run',
      '--rm',
      'pipeline',
      'node',
      'scripts/data-rollback.mjs',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { cmd, args } = rollbackCommand(process.env);
  run(cmd, args);
}
