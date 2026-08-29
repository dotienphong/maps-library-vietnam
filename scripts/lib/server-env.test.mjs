import { describe, expect, it } from 'vitest';
import { generatePassword, parseEnv, renderServerEnv, sharedBuffersFor } from './server-env.mjs';

describe('generatePassword', () => {
  it('32 ký tự base62, hai lần khác nhau', () => {
    const a = generatePassword(32);
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(generatePassword(32)).not.toBe(a);
  });
});

describe('sharedBuffersFor', () => {
  it('25% RAM, làm tròn xuống 256MB, tối thiểu 512MB, tối đa 8GB', () => {
    expect(sharedBuffersFor(8 * 2 ** 30)).toBe('2048MB');
    expect(sharedBuffersFor(16 * 2 ** 30)).toBe('4096MB');
    expect(sharedBuffersFor(1 * 2 ** 30)).toBe('512MB');
    expect(sharedBuffersFor(64 * 2 ** 30)).toBe('8192MB');
  });
});

describe('renderServerEnv / parseEnv', () => {
  it('render đủ khoá và đọc lại được', () => {
    const text = renderServerEnv({
      superPassword: 'S',
      apiPassword: 'A',
      pipelinePassword: 'P',
      sharedBuffers: '2048MB',
      tunnelToken: '',
      pipelineImage: 'ghcr.io/dotienphong/mapslibvn-pipeline:latest',
    });
    const env = parseEnv(text);
    expect(env.POSTGRES_SUPER_PASSWORD).toBe('S');
    expect(env.API_PASSWORD).toBe('A');
    expect(env.PIPELINE_PASSWORD).toBe('P');
    expect(env.PG_SHARED_BUFFERS).toBe('2048MB');
    expect(env.TUNNEL_TOKEN).toBe('');
    expect(env.PIPELINE_IMAGE).toBe('ghcr.io/dotienphong/mapslibvn-pipeline:latest');
    expect(env.RCLONE_CONFIG_R2_NO_CHECK_BUCKET).toBe('true');
    expect(env.HF_TOKEN).toBe('');
    expect(text).toContain('# Bí mật máy chủ');
  });

  it('parseEnv bỏ comment, dòng trống, dấu nháy', () => {
    expect(parseEnv('# c\nA=1\n\nB="x y"\nC=\'z\'\n')).toEqual({ A: '1', B: 'x y', C: 'z' });
  });
});
