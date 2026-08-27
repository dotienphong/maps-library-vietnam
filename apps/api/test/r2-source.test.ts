import { describe, expect, it } from 'vitest';
import { R2Source } from '../src/r2-source';

const fakeBucket = (bytes: Uint8Array) => ({
  async get(_key: string, opts?: { range?: { offset: number; length: number } }) {
    const { offset, length } = opts?.range ?? { offset: 0, length: bytes.length };
    const slice = bytes.slice(offset, offset + length);
    return {
      arrayBuffer: async () =>
        slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
      httpEtag: '"e"',
    } as unknown as R2ObjectBody;
  },
});

describe('R2Source', () => {
  it('đọc đúng đoạn byte theo offset/length', async () => {
    const src = new R2Source(
      fakeBucket(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])) as unknown as Pick<R2Bucket, 'get'>,
      'k',
    );
    const r = await src.getBytes(2, 3);
    expect([...new Uint8Array(r.data)]).toEqual([2, 3, 4]);
    expect(r.etag).toBe('"e"');
  });
  it('ném lỗi khi object không tồn tại', async () => {
    const src = new R2Source({ get: async () => null } as unknown as R2Bucket, 'missing');
    await expect(src.getBytes(0, 1)).rejects.toThrow(/không có missing/);
  });
});
