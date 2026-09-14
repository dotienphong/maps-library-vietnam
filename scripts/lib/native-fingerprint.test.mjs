import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fingerprintStatePath,
  nativeDriftDecision,
  nativeDriftMessage,
  readStoredFingerprint,
  writeStoredFingerprint,
} from './native-fingerprint.mjs';

/**
 * `npx expo run:<platform>` KHÔNG tự đồng bộ `ios/`/`android/` với `app.json` khi hai thư mục đã
 * tồn tại — đọc thẳng mã nguồn `@expo/cli` (`ensureNativeProjectAsync`): còn thư mục là bỏ qua
 * prebuild, dùng nguyên bản cũ. `staleBundleDirs`/`uninstallCommand` chỉ đảm bảo JS luôn mới; cấu
 * hình native (quyền, plugin, native dependency) có thể lệch âm thầm nếu ai đó sửa `app.json` mà
 * quên `npx expo prebuild --clean` — README ghi bước này nhưng chỉ dựa vào trí nhớ, không có lưới
 * an toàn nào. Module này thêm lưới an toàn: so hash `@expo/fingerprint` (chính cơ chế Expo dùng
 * cho EAS Build local cache) của lần build gần nhất với hiện tại, chặn nếu lệch hoặc chưa từng ghi.
 */
describe('fingerprintStatePath', () => {
  it('mỗi platform một file riêng, nằm trong appDir', () => {
    expect(fingerprintStatePath('/app', 'ios')).toBe('/app/.native-fingerprint.ios.json');
    expect(fingerprintStatePath('/app', 'android')).toBe('/app/.native-fingerprint.android.json');
  });
});

describe('đọc/ghi fingerprint đã lưu', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mlv-fp-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('chưa có file → null', () => {
    expect(readStoredFingerprint(join(dir, 'x.json'))).toBeNull();
  });

  it('ghi rồi đọc lại đúng hash', () => {
    const p = join(dir, 'x.json');
    writeStoredFingerprint(p, 'abc123');
    expect(readStoredFingerprint(p)).toBe('abc123');
  });

  it('file hỏng (không phải JSON hợp lệ) → null, không ném', () => {
    const p = join(dir, 'x.json');
    writeStoredFingerprint(p, 'abc123');
    // Giả lập file bị ghi dở/hỏng.
    writeFileSync(p, '{not json');
    expect(readStoredFingerprint(p)).toBeNull();
  });
});

describe('nativeDriftDecision — quyết định thuần, không I/O', () => {
  it('thư mục native chưa tồn tại → không chặn (ensureNativeProjectAsync sẽ tự prebuild)', () => {
    expect(
      nativeDriftDecision({ nativeDirExists: false, storedHash: null, currentHash: 'x' }),
    ).toEqual({ block: false });
    expect(
      nativeDriftDecision({ nativeDirExists: false, storedHash: 'x', currentHash: 'y' }),
    ).toEqual({ block: false });
  });

  it('thư mục tồn tại, hash khớp lần build gần nhất → không chặn', () => {
    expect(
      nativeDriftDecision({ nativeDirExists: true, storedHash: 'abc', currentHash: 'abc' }),
    ).toEqual({ block: false });
  });

  it('thư mục tồn tại, hash lệch → chặn, nêu lý do "đổi cấu hình"', () => {
    const d = nativeDriftDecision({ nativeDirExists: true, storedHash: 'abc', currentHash: 'def' });
    expect(d.block).toBe(true);
    expect(d.reason).toMatch(/đổi|thay đổi/i);
  });

  it('thư mục tồn tại, CHƯA TỪNG ghi fingerprint → chặn (không đoán, không tự tin nhầm)', () => {
    const d = nativeDriftDecision({ nativeDirExists: true, storedHash: null, currentHash: 'def' });
    expect(d.block).toBe(true);
    expect(d.reason).toMatch(/chưa từng|chưa có/i);
  });
});

describe('nativeDriftMessage — thông điệp phải nêu đúng lệnh khắc phục', () => {
  it('nêu tên platform và đúng lệnh prebuild --clean', () => {
    const msg = nativeDriftMessage('ios', 'cấu hình đã đổi kể từ lần build gần nhất');
    expect(msg).toContain('ios');
    expect(msg).toContain('npx expo prebuild --clean');
    expect(msg).toContain('cấu hình đã đổi kể từ lần build gần nhất');
  });
});
