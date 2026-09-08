export const MAX_POI_ARCHIVE_BYTES = 300 * 2 ** 20;

/** @param {string} release @param {number} bytes */
export function assertPoiArchiveSize(release, bytes) {
  if (release.startsWith('poi-') && bytes > MAX_POI_ARCHIVE_BYTES) {
    throw new Error(
      `${release}.pmtiles vượt gate cứng 300 MiB: ${(bytes / 2 ** 20).toFixed(1)} MiB`,
    );
  }
}

/**
 * @param {{ archiveExists: boolean, checksumExists: boolean, localSha256: string, remoteSha256?: string }} state
 * @returns {'upload' | 'reuse'}
 */
export function immutableUploadAction(state) {
  if (!state.archiveExists && state.checksumExists) {
    throw new Error('Checksum mồ côi trên R2; từ chối publish');
  }
  if (!state.archiveExists) return 'upload';
  if (!state.checksumExists) {
    throw new Error('Archive đã tồn tại nhưng không có checksum; từ chối ghi đè');
  }
  if (state.remoteSha256?.trim() !== state.localSha256) {
    throw new Error('Release là bất biến: archive trên R2 có checksum khác');
  }
  return 'reuse';
}
