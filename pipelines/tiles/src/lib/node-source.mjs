import { open } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';

/** Nguồn PMTiles đọc range từ FileHandle cục bộ. */
export class NodeFileSource {
  /**
   * @param {import('node:fs/promises').FileHandle} fileHandle
   * @param {string} key
   */
  constructor(fileHandle, key) {
    this.fileHandle = fileHandle;
    this.key = key;
  }

  getKey() {
    return this.key;
  }

  /** @param {number} offset @param {number} length @param {AbortSignal} [signal] */
  async getBytes(offset, length, signal) {
    signal?.throwIfAborted();
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await this.fileHandle.read(buffer, 0, length, offset);
    const data = new Uint8Array(bytesRead);
    data.set(buffer.subarray(0, bytesRead));
    return { data: data.buffer };
  }
}

/** @param {string} path */
export async function openPmtiles(path) {
  const fileHandle = await open(path, 'r');
  return {
    pmtiles: new PMTiles(new NodeFileSource(fileHandle, path)),
    close: () => fileHandle.close(),
  };
}
