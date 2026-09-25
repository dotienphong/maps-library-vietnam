import { describe, expect, it } from 'vitest';
import {
  backupBucket,
  backupName,
  dumpCommand,
  encryptCommand,
  encryptedName,
  localTempName,
  plainName,
  RETRY_HOURS_VN,
  requireBackupPassphrase,
  retentionPlan,
  staleTemps,
  uploadArgs,
} from './backup-plan.mjs';

describe('backupName', () => {
  it('tên theo giờ VN', () => {
    expect(backupName(new Date('2026-08-25T20:00:00Z'))).toBe('mapslibvn-20260826-0300.dump.zst');
  });
});

describe('retentionPlan', () => {
  const daily = Array.from(
    { length: 10 },
    (_, i) => `mapslibvn-202608${String(10 + i).padStart(2, '0')}-0300.dump.zst`,
  );
  it('giữ 7 bản ngày mới nhất, xoá phần còn lại', () => {
    const plan = retentionPlan({ daily, weekly: [] }, { keepDaily: 7, keepWeekly: 4 });
    expect(plan.deleteDaily).toEqual(daily.slice(0, 3));
    expect(plan.deleteWeekly).toEqual([]);
  });
  it('weekly giữ 4', () => {
    const weekly = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w) => `mapslibvn-2026${w}.dump.zst`);
    const plan = retentionPlan({ daily: [], weekly }, { keepDaily: 7, keepWeekly: 4 });
    expect(plan.deleteWeekly).toEqual(weekly.slice(0, 2));
  });
  it('tên sắp theo chuỗi nên bản mới nhất ở cuối', () => {
    const plan = retentionPlan(
      { daily: ['b', 'a', 'c'], weekly: [] },
      { keepDaily: 2, keepWeekly: 1 },
    );
    expect(plan.deleteDaily).toEqual(['a']);
  });
});

describe('encryptCommand (dùng lại cho bản sao lưu sổ quota)', () => {
  it('dùng ĐÚNG bộ tham số của dump hằng ngày, không tự chọn tham số yếu hơn', () => {
    const cmd = encryptCommand('/tmp/quota.json', '/tmp/quota.json.enc');
    expect(cmd).toContain(
      'openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE',
    );
    expect(cmd).toContain('-in "/tmp/quota.json"');
    expect(cmd).toContain('-out "/tmp/quota.json.enc"');
  });
});

describe('dumpCommand (mã hoá trước khi upload, audit 09/09/2026)', () => {
  it('nối pg_dump | zstd | openssl enc AES-256 PBKDF2, đọc passphrase từ biến môi trường', () => {
    const cmd = dumpCommand('/app/work/x.dump.zst.enc');
    expect(cmd).toContain('pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL"');
    expect(cmd).toContain('zstd -T0 -3 -q');
    expect(cmd).toContain(
      'openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE',
    );
    expect(cmd).toContain('-out "/app/work/x.dump.zst.enc"');
  });
});

describe('encryptedName / plainName', () => {
  it('tên file mã hoá thêm .enc; bỏ .enc để lấy tên .dump.zst', () => {
    expect(encryptedName('mapslibvn-20260909-0300.dump.zst')).toBe(
      'mapslibvn-20260909-0300.dump.zst.enc',
    );
    expect(plainName('mapslibvn-20260909-0300.dump.zst.enc')).toBe(
      'mapslibvn-20260909-0300.dump.zst',
    );
    expect(plainName('mapslibvn-20260909-0300.dump.zst')).toBe('mapslibvn-20260909-0300.dump.zst');
  });
});

describe('requireBackupPassphrase', () => {
  it('thiếu hoặc quá ngắn thì ném lỗi — không bao giờ upload dump không mã hoá', () => {
    expect(() => requireBackupPassphrase({})).toThrow(/BACKUP_PASSPHRASE/);
    expect(() => requireBackupPassphrase({ BACKUP_PASSPHRASE: 'short' })).toThrow(/32/);
    expect(requireBackupPassphrase({ BACKUP_PASSPHRASE: 'x'.repeat(32) })).toBe('x'.repeat(32));
  });
});

describe('backupBucket', () => {
  it('ưu tiên BACKUP_BUCKET; thiếu thì dùng R2_BUCKET nhưng báo là dùng chung', () => {
    expect(
      backupBucket({ BACKUP_BUCKET: 'mapslibvn-backups', R2_BUCKET: 'mapslibvn-tiles' }),
    ).toEqual({ bucket: 'mapslibvn-backups', shared: false });
    expect(backupBucket({ R2_BUCKET: 'mapslibvn-tiles' })).toEqual({
      bucket: 'mapslibvn-tiles',
      shared: true,
    });
  });
});

describe('localTempName', () => {
  it('file tạm trên đĩa mang pid để hai lần chạy trùng phút không ghi/xoá lẫn nhau', () => {
    expect(localTempName('mapslibvn-20260909-2201.dump.zst.enc', 4242)).toBe(
      'mapslibvn-20260909-2201.dump.zst.enc.4242.tmp',
    );
  });
});

describe('uploadArgs (sự cố 25/09/2026: upload chiếm hết đường mạng của tunnel)', () => {
  const args = uploadArgs('/app/work/a.tmp', 'r2:b/backups/daily/a.enc', {});
  const flag = (/** @type {string} */ name) => args[args.indexOf(name) + 1];

  it('copyto đúng nguồn và đích', () => {
    expect(args.slice(0, 3)).toEqual(['copyto', '/app/work/a.tmp', 'r2:b/backups/daily/a.enc']);
  });
  it('giới hạn băng thông và chỉ một luồng để luôn chừa đường cho cloudflared', () => {
    expect(flag('--bwlimit')).toBe('4M');
    expect(flag('--multi-thread-streams')).toBe('1');
    expect(flag('--s3-upload-concurrency')).toBe('1');
  });
  it('bỏ cuộc sau 30 phút (cắt cứng) thay vì giữ mạng nghẽn hàng giờ', () => {
    expect(flag('--max-duration')).toBe('30m');
    expect(flag('--cutoff-mode')).toBe('hard');
    expect(flag('--retries')).toBe('1');
  });
  it('BACKUP_BWLIMIT ghi đè giới hạn mặc định', () => {
    const a = uploadArgs('f', 'd', { BACKUP_BWLIMIT: '512k' });
    expect(a[a.indexOf('--bwlimit') + 1]).toBe('512k');
  });
});

describe('staleTemps', () => {
  it('chỉ trả file .tmp khác file đang dùng — file tạm của các lần hỏng trước không được kẹt mãi', () => {
    expect(
      staleTemps(['x-0919.enc.1.tmp', 'x-0925.enc.1.tmp', 'ghi-chu.txt'], 'x-0925.enc.1.tmp'),
    ).toEqual(['x-0919.enc.1.tmp']);
  });
});

describe('RETRY_HOURS_VN', () => {
  it('thử lại ban ngày, trước lượt 03:00 kế tiếp', () => {
    expect(RETRY_HOURS_VN).toEqual([10, 15]);
  });
});
