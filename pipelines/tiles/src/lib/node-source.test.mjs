import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeFileSource } from './node-source.mjs';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('NodeFileSource', () => {
  it('đọc đúng byte range và giữ key của nguồn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mapslibvn-node-source-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'fixture.bin');
    await writeFile(path, Buffer.from('abcdefgh'));
    const handle = await open(path, 'r');
    try {
      const source = new NodeFileSource(handle, path);
      const result = await source.getBytes(2, 3);
      expect(source.getKey()).toBe(path);
      expect(Buffer.from(result.data).toString()).toBe('cde');
    } finally {
      await handle.close();
    }
  });
});
