import { describe, expect, it } from 'vitest';
import {
  KEY_ENV_NAME,
  contentType,
  exampleUrl,
  openCommand,
  resolveKey,
  safeFile,
} from './example-serve.mjs';

describe('contentType', () => {
  it('đoán theo đuôi file, mặc định là nhị phân', () => {
    expect(contentType('/index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('/a/b.css')).toBe('text/css; charset=utf-8');
    expect(contentType('/x.PNG')).toBe('image/png');
    expect(contentType('/khong-duoi')).toBe('application/octet-stream');
  });
});

describe('safeFile', () => {
  it('gốc trả index.html, bỏ query và hash', () => {
    expect(safeFile('/')).toBe('index.html');
    expect(safeFile('/?key=mlv_live_x')).toBe('index.html');
    expect(safeFile('/style.css?v=2#top')).toBe('style.css');
  });

  it('chặn thoát thư mục', () => {
    expect(safeFile('/../.env')).toBeNull();
    expect(safeFile('/a/../../etc/passwd')).toBeNull();
    expect(safeFile('/%2e%2e/.env')).toBeNull();
    expect(safeFile('/a\\b')).toBeNull();
  });
});

describe('resolveKey', () => {
  const good = `mlv_live_${'a'.repeat(24)}`;

  it('mặc định lấy KEY_EXAMPLE_EMBED trong .env, không cần gõ --key', () => {
    expect(KEY_ENV_NAME).toBe('KEY_EXAMPLE_EMBED');
    expect(resolveKey([], { KEY_EXAMPLE_EMBED: good })).toBe(good);
  });

  it('--key ghi đè biến môi trường', () => {
    expect(resolveKey(['--key', good], {})).toBe(good);
    expect(resolveKey(['--key', good], { KEY_EXAMPLE_EMBED: 'khac' })).toBe(good);
  });

  it('báo lỗi rõ khi thiếu hoặc sai định dạng', () => {
    expect(() => resolveKey([], {})).toThrow(/KEY_EXAMPLE_EMBED/);
    expect(() => resolveKey(['--key', 'abc'], {})).toThrow(/định dạng/);
  });
});

describe('exampleUrl', () => {
  it('ghép cổng và khoá', () => {
    expect(exampleUrl(5500, 'mlv_live_x')).toBe('http://localhost:5500/?key=mlv_live_x');
  });
});

describe('openCommand', () => {
  it('đúng lệnh cho từng hệ điều hành', () => {
    expect(openCommand('darwin')).toEqual({ cmd: 'open', args: [] });
    expect(openCommand('win32')).toEqual({ cmd: 'cmd', args: ['/c', 'start', ''] });
    expect(openCommand('linux')).toEqual({ cmd: 'xdg-open', args: [] });
  });
});
