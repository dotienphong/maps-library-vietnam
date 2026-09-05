import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadVerified } from '../src/geocode/admin-old-source.mjs';

const digest = (body) => createHash('sha256').update(body).digest('hex');

describe('downloadVerified', () => {
  it('giữ cache đúng hash và không gọi mạng', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-old-'));
    const target = join(dir, 'old.pbf');
    writeFileSync(target, 'good');
    let calls = 0;
    await expect(
      downloadVerified({
        url: 'https://example.test/old',
        target,
        bytes: 4,
        sha256: digest('good'),
        fetchImpl: async () => {
          calls++;
          return new Response('bad');
        },
      }),
    ).resolves.toBe(false);
    expect(calls).toBe(0);
  });

  it('download hợp lệ thay file cache sai', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-old-'));
    const target = join(dir, 'old.pbf');
    writeFileSync(target, 'bad');
    await expect(
      downloadVerified({
        url: 'https://example.test/old',
        target,
        bytes: 4,
        sha256: digest('good'),
        fetchImpl: async () => new Response('good'),
      }),
    ).resolves.toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('good');
  });

  it('sai checksum dọn part và giữ file cache cũ', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-old-'));
    const target = join(dir, 'old.pbf');
    writeFileSync(target, 'old');
    await expect(
      downloadVerified({
        url: 'https://example.test/old',
        target,
        bytes: 4,
        sha256: digest('good'),
        fetchImpl: async () => new Response('nope'),
      }),
    ).rejects.toThrow(/checksum/);
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(() => readFileSync(`${target}.part`)).toThrow();
  });
});
