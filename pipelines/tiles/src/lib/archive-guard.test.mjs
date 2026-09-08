import { describe, expect, it } from 'vitest';
import {
  MAX_POI_ARCHIVE_BYTES,
  assertPoiArchiveSize,
  immutableUploadAction,
} from './archive-guard.mjs';

describe('assertPoiArchiveSize', () => {
  it('cho phép đúng 300 MiB', () => {
    expect(() => assertPoiArchiveSize('poi-20260908-run', MAX_POI_ARCHIVE_BYTES)).not.toThrow();
  });

  it('chặn ngay khi vượt 300 MiB một byte', () => {
    expect(() => assertPoiArchiveSize('poi-osm-20260908-run', MAX_POI_ARCHIVE_BYTES + 1)).toThrow(
      /300 MiB/,
    );
  });

  it('không áp giới hạn POI lên basemap', () => {
    expect(() => assertPoiArchiveSize('vn-20260908', MAX_POI_ARCHIVE_BYTES + 1)).not.toThrow();
  });
});

describe('immutableUploadAction', () => {
  const sha = 'a'.repeat(64);

  it('upload object mới', () => {
    expect(
      immutableUploadAction({ archiveExists: false, checksumExists: false, localSha256: sha }),
    ).toBe('upload');
  });

  it('cho phép retry idempotent khi checksum trùng', () => {
    expect(
      immutableUploadAction({
        archiveExists: true,
        checksumExists: true,
        localSha256: sha,
        remoteSha256: sha,
      }),
    ).toBe('reuse');
  });

  it('từ chối ghi đè khi checksum khác', () => {
    expect(() =>
      immutableUploadAction({
        archiveExists: true,
        checksumExists: true,
        localSha256: sha,
        remoteSha256: 'b'.repeat(64),
      }),
    ).toThrow(/bất biến/);
  });

  it('từ chối object cũ không có checksum thay vì đoán', () => {
    expect(() =>
      immutableUploadAction({ archiveExists: true, checksumExists: false, localSha256: sha }),
    ).toThrow(/checksum/);
  });

  it('từ chối trạng thái checksum mồ côi', () => {
    expect(() =>
      immutableUploadAction({
        archiveExists: false,
        checksumExists: true,
        localSha256: sha,
        remoteSha256: sha,
      }),
    ).toThrow(/mồ côi/);
  });
});
