// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { dangKyTaiLaiKhiThieuChunk } from './chunk-reload';

function dungBoKhung(lanTruoc: string | null = null) {
  const store = new Map<string, string>();
  if (lanTruoc !== null) store.set('admin-tai-lai-vi-chunk', lanTruoc);
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const reload = vi.fn();
  const target = new EventTarget() as unknown as Window;
  return { storage, reload, target, store };
}

const banChunkLoi = (target: Window) =>
  target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

describe('dangKyTaiLaiKhiThieuChunk', () => {
  it('chunk nạp lỗi lần đầu → tải lại trang', () => {
    const { storage, reload, target } = dungBoKhung();
    dangKyTaiLaiKhiThieuChunk(target, { storage, reload, now: () => 1_000_000 });
    banChunkLoi(target);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('vừa tải lại xong mà lỗi tiếp → KHÔNG lặp vô hạn', () => {
    const { storage, reload, target } = dungBoKhung('1000000');
    dangKyTaiLaiKhiThieuChunk(target, { storage, reload, now: () => 1_005_000 });
    banChunkLoi(target);
    expect(reload).not.toHaveBeenCalled();
  });

  it('lỗi lại sau 30 giây → được tải lại lần nữa', () => {
    const { storage, reload, target } = dungBoKhung('1000000');
    dangKyTaiLaiKhiThieuChunk(target, { storage, reload, now: () => 1_040_000 });
    banChunkLoi(target);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('sessionStorage bị chặn vẫn tải lại được', () => {
    const reload = vi.fn();
    const target = new EventTarget() as unknown as Window;
    const storage = {
      getItem: () => {
        throw new Error('bị chặn');
      },
      setItem: () => {
        throw new Error('bị chặn');
      },
    };
    dangKyTaiLaiKhiThieuChunk(target, { storage, reload, now: () => 1 });
    banChunkLoi(target);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('ghi lại mốc thời gian để lần sau biết vừa tải lại', () => {
    const { storage, reload, target, store } = dungBoKhung();
    dangKyTaiLaiKhiThieuChunk(target, { storage, reload, now: () => 123_456 });
    banChunkLoi(target);
    expect(store.get('admin-tai-lai-vi-chunk')).toBe('123456');
  });
});
