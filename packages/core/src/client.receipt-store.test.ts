import { describe, expect, it, vi } from 'vitest';
import { createReceiptStore } from './client';

/** Giả lập AsyncStorage: API bất đồng bộ, khác localStorage đồng bộ. */
function asyncStorage() {
  const cell = new Map<string, string>();
  return {
    cell,
    getItem: vi.fn(async (k: string) => cell.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      cell.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      cell.delete(k);
    }),
  };
}

const receipt = (id: string) => ({
  id,
  token: `t-${id}`,
  version: '1',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
});

describe('createReceiptStore trên kho khoá-giá trị bất đồng bộ', () => {
  it('giữ nhiều receipt và đọc lại được sau khi app khởi động lại', async () => {
    const storage = asyncStorage();
    const store = createReceiptStore(storage);
    await store.save(receipt('a'));
    await store.save(receipt('b'));

    // Client mới hoàn toàn, chỉ có chung kho — mô phỏng app mở lại.
    const reopened = createReceiptStore(storage);
    expect((await reopened.load()).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('save chờ ghi xong mới trả về, không bỏ rơi promise', async () => {
    const storage = asyncStorage();
    const store = createReceiptStore(storage);
    await store.save(receipt('a'));
    // Ngay sau await, dữ liệu phải đã nằm trong kho.
    expect(storage.setItem).toHaveBeenCalled();
    expect((await createReceiptStore(storage).load()).map((r) => r.id)).toEqual(['a']);
  });

  it('xoá receipt cuối thì dọn hẳn khoá thay vì để lại mảng rỗng', async () => {
    const storage = asyncStorage();
    const store = createReceiptStore(storage);
    await store.save(receipt('a'));
    await store.remove('a');
    expect(await store.load()).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalled();
    expect(storage.cell.size).toBe(0);
  });

  it('tách namespace để hai client không giẫm chân nhau', async () => {
    const storage = asyncStorage();
    await createReceiptStore(storage, 'app-a').save(receipt('a'));
    await createReceiptStore(storage, 'app-b').save(receipt('b'));
    expect((await createReceiptStore(storage, 'app-a').load()).map((r) => r.id)).toEqual(['a']);
    expect((await createReceiptStore(storage, 'app-b').load()).map((r) => r.id)).toEqual(['b']);
  });

  it('dữ liệu hỏng trong kho không làm chết client', async () => {
    const storage = asyncStorage();
    await storage.setItem('mapslibvn:quota:default', 'không phải JSON');
    expect(await createReceiptStore(storage).load()).toEqual([]);
  });
});
