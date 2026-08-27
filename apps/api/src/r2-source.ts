import type { RangeResponse, Source } from 'pmtiles';

/** Nguồn PMTiles đọc range từ R2 (dùng cho route fallback). */
export class R2Source implements Source {
  constructor(
    private readonly bucket: Pick<R2Bucket, 'get'>,
    private readonly key: string,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`R2: không có ${this.key}`);
    return { data: await obj.arrayBuffer(), etag: obj.httpEtag };
  }
}
