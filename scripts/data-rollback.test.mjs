import { describe, expect, it } from 'vitest';
import { rollbackCommand } from './data-rollback.mjs';

describe('rollbackCommand', () => {
  it('ngoài container chạy lại qua pipeline image', () => {
    expect(rollbackCommand({})).toEqual({
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
    });
  });

  it('trong container gọi manifest rollback', () => {
    expect(rollbackCommand({ MAPSLIBVN_IN_CONTAINER: '1' })).toEqual({
      cmd: 'node',
      args: ['pipelines/tiles/src/manifest.mjs', 'rollback'],
    });
  });
});
