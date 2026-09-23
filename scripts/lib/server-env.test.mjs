import { describe, expect, it } from 'vitest';
import {
  canhBaoSharedBuffers,
  generatePassword,
  parseEnv,
  pullPlan,
  renderServerEnv,
  sharedBuffersFor,
} from './server-env.mjs';

describe('generatePassword', () => {
  it('32 ký tự base62, hai lần khác nhau', () => {
    const a = generatePassword(32);
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(generatePassword(32)).not.toBe(a);
  });
});

describe('canhBaoSharedBuffers', () => {
  it('vượt 30 % RAM máy hiện tại → trả cảnh báo nêu cả hai số', () => {
    // Sự cố 22/09/2026: .env sinh trên MacBook 16 GB cho PG_SHARED_BUFFERS=4096MB rồi mang sang máy
    // chủ 3,7 GB. Postgres xin 4 GB trên máy 3,7 GB → swap 81 %, mọi dịch vụ chậm, khó truy nguyên.
    const canhBao = canhBaoSharedBuffers('4096MB', 3.7 * 2 ** 30);
    expect(canhBao).toMatch(/4096MB/);
    expect(canhBao).toMatch(/3[.,]7 GB|3788|3789|3790/);
    expect(canhBao).toMatch(/swap/i);
  });

  it('trong mức an toàn → null', () => {
    expect(canhBaoSharedBuffers('512MB', 3.7 * 2 ** 30)).toBeNull();
    expect(canhBaoSharedBuffers('4096MB', 16 * 2 ** 30)).toBeNull();
  });

  it('giá trị không đọc được → null, không chặn khởi động vì một chuỗi lạ', () => {
    expect(canhBaoSharedBuffers('', 3.7 * 2 ** 30)).toBeNull();
    expect(canhBaoSharedBuffers('nhieu', 3.7 * 2 ** 30)).toBeNull();
    expect(canhBaoSharedBuffers('512MB', 0)).toBeNull();
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
      backupPassphrase: 'B'.repeat(48),
    });
    const env = parseEnv(text);
    expect(env.BACKUP_PASSPHRASE).toBe('B'.repeat(48));
    expect(env.BACKUP_BUCKET).toBe('mapslibvn-backups');
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

describe('pullPlan', () => {
  it('image pipeline dựng tại máy (tag :local) thì chỉ pull dịch vụ công khai', () => {
    expect(pullPlan('mapslibvn/pipeline:local')).toEqual({
      services: ['postgres', 'cloudflared', 'valhalla', 'vroom'],
      skipPipeline: true,
    });
  });

  it('image trên registry thì pull tất cả (mảng rỗng = mọi dịch vụ)', () => {
    expect(pullPlan('ghcr.io/dotienphong/mapslibvn-pipeline:latest')).toEqual({
      services: [],
      skipPipeline: false,
    });
  });

  it('thiếu biến hoặc chuỗi rỗng thì vẫn pull tất cả', () => {
    expect(pullPlan('')).toEqual({ services: [], skipPipeline: false });
    expect(pullPlan(undefined)).toEqual({ services: [], skipPipeline: false });
  });
});
