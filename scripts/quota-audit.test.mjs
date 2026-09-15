import { describe, expect, it } from 'vitest';
import {
  BUNDLE_KIND,
  accessHeaders,
  backupObjectName,
  buildReport,
  collectBundle,
  parseArgs,
  runExport,
  runRestore,
  verifyBundle,
} from './quota-audit.mjs';

/** @param {string} value */
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const KEY_HASH = 'a'.repeat(64);

/**
 * Dựng một bản sao lưu hợp lệ y như Durable Object sinh ra: byte nào băm ra byte đó.
 * @param {{pages?: {table:string, data:Record<string, unknown>}[][] | null,
 *   journal?: ReturnType<typeof entry>[], sequence?: number}} [options]
 */
async function makeBundle({ pages: pageRecords = null, journal = [], sequence = 7 } = {}) {
  const groups = pageRecords ?? [
    [
      { table: 'entitlement', data: { id: 1, status: 'active', tier: 'starter', revision: 3 } },
      { table: 'counter', data: { source_id: 'p1', group_name: 'places', used: 10, reserved: 0 } },
    ],
    [{ table: 'revoked_key', data: { key_hash: KEY_HASH, reason: 'lộ khoá' } }],
  ];
  const texts = groups.map((records) => JSON.stringify(records));
  const checksums = await Promise.all(texts.map(sha256Hex));
  const records = groups.reduce((total, group) => total + group.length, 0);
  const snapshotId = 'snap-1';
  const manifest = {
    snapshotId,
    tenantId: 'tenant-1',
    schemaVersion: 1,
    sequence,
    pages: texts.length,
    records,
    checksum: await sha256Hex(
      JSON.stringify({
        schemaVersion: 1,
        tenantId: 'tenant-1',
        sequence,
        records,
        pages: checksums,
      }),
    ),
    takenAt: '2026-09-15T10:00:00.000Z',
  };
  return {
    kind: BUNDLE_KIND,
    schemaVersion: 1,
    tenantId: 'tenant-1',
    takenAt: manifest.takenAt,
    manifest,
    pages: texts.map((text, index) => ({
      snapshotId,
      index,
      pages: texts.length,
      sequence,
      records: text,
      checksum: checksums[index] ?? '',
    })),
    journal,
  };
}

/** @param {number} seq */
const entry = (seq) => ({
  seq,
  kind: 'commit',
  ref: `req-${seq}`,
  payload: JSON.stringify({ group: 'places', sourceKind: 'period', sourceId: 'p1', dayKey: '' }),
  createdAt: '2026-09-15T10:00:01.000Z',
});

describe('verifyBundle', () => {
  it('chấp nhận bản sao lưu nguyên vẹn kèm đuôi journal liền mạch', async () => {
    const bundle = await makeBundle({ journal: [entry(8), entry(9)] });
    expect(await verifyBundle(bundle)).toEqual([]);
  });

  it('từ chối khi byte của một trang bị sửa', async () => {
    const bundle = await makeBundle();
    const page = bundle.pages[1];
    if (!page) throw new Error('fixture thiếu trang');
    page.records = page.records.replace('lộ khoá', 'lo khoa');
    expect(await verifyBundle(bundle)).toContain('trang 1 sai checksum');
  });

  it('từ chối khi checksum tổng không phủ hết các trang', async () => {
    const bundle = await makeBundle();
    // Trang tự nó vẫn khớp checksum của chính nó, nhưng manifest thì không còn phủ nó nữa.
    const swapped = await makeBundle({
      pages: [[{ table: 'entitlement', data: { id: 1, status: 'suspended' } }]],
    });
    const replacement = swapped.pages[0];
    if (!replacement) throw new Error('fixture thiếu trang');
    bundle.pages[0] = { ...replacement, index: 0, pages: bundle.pages.length };
    expect(await verifyBundle(bundle)).toContain('checksum tổng không khớp các trang');
  });

  it('từ chối đuôi journal thủng thay vì coi khoản thiếu bằng 0', async () => {
    const bundle = await makeBundle({ journal: [entry(8), entry(10)] });
    expect(await verifyBundle(bundle)).toContain('đuôi journal thủng tại 9 (nhận 10)');
  });

  it('từ chối đuôi journal không bắt đầu ngay sau snapshot', async () => {
    const bundle = await makeBundle({ journal: [entry(12)] });
    expect(await verifyBundle(bundle)).toContain('đuôi journal thủng tại 8 (nhận 12)');
  });
});

describe('buildReport', () => {
  it('chỉ đưa ra số đếm, không mang băm khoá/truy vấn/toạ độ theo', async () => {
    const bundle = await makeBundle({ journal: [entry(8)] });
    const report = buildReport(bundle, {
      status: 'active',
      tier: 'starter',
      periodId: 'p1',
      endsAt: '2026-10-15T00:00:00.000Z',
      maintenance: false,
      places: { limit: 30_000, used: 10, reserved: 0, credits: 0, available: 29_990 },
      directions: { limit: 3_000, used: 0, reserved: 0, credits: 0, available: 3_000 },
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toMatch(/key_hash|keyHash|"query"|"lat"|"lon"|\bq=/);
    expect(report.tables).toEqual({ entitlement: 1, counter: 1, revoked_key: 1 });
    expect(report.journal).toMatchObject({ entries: 1, byKind: { commit: 1 }, from: 8, to: 8 });
    expect(report.usage?.places?.used).toBe(10);
  });
});

describe('runExport', () => {
  /** Máy chủ giả: trả snapshot thật (checksum thật) và ghi lại thứ tự lời gọi. */
  /** @param {{journalPages?: ReturnType<typeof entry>[][]}} [options] */
  async function fakeServer({ journalPages = [[]] } = {}) {
    const bundle = await makeBundle();
    /** @type {string[]} */
    const calls = [];
    let journalIndex = 0;
    /** @param {string} path @param {any} [init] */
    const call = async (path, init) => {
      calls.push(`${init?.method ?? 'GET'} ${path.split('?')[0]}`);
      if (path.endsWith('/backup/snapshot') && init?.method === 'POST') return bundle.manifest;
      if (path.includes('/backup/snapshot/')) {
        return bundle.pages[Number(path.split('/').at(-1))] ?? null;
      }
      if (path.includes('/backup/journal')) {
        /** @type {ReturnType<typeof entry>[]} */
        const entries = journalPages[journalIndex] ?? [];
        journalIndex += 1;
        return {
          entries,
          nextSequence: entries.at(-1)?.seq ?? bundle.manifest.sequence,
          pending: 0,
        };
      }
      if (path.endsWith('/backup/checkpoint')) return { sequence: bundle.manifest.sequence };
      if (path.endsWith('/usage')) return { status: 'active', tier: 'starter' };
      throw new Error(`đường dẫn lạ: ${path}`);
    };
    return { bundle, call, calls };
  }

  it('chỉ chốt checkpoint SAU khi bản sao lưu đã ghi bền vững', async () => {
    const { call, calls } = await fakeServer();
    const result = await runExport({
      call,
      tenantId: 'tenant-1',
      persist: async () => {
        calls.push('PERSIST');
        return 'r2:bucket/quota.json.enc';
      },
    });
    expect(calls.indexOf('PERSIST')).toBeLessThan(
      calls.indexOf('POST /v1/admin/billing/tenant-1/backup/checkpoint'),
    );
    expect(result.location).toBe('r2:bucket/quota.json.enc');
  });

  it('không chốt checkpoint khi chưa ghi được ra nơi bền vững', async () => {
    const { call, calls } = await fakeServer();
    await expect(
      runExport({
        call,
        tenantId: 'tenant-1',
        persist: async () => {
          throw new Error('R2 từ chối');
        },
      }),
    ).rejects.toThrow('R2 từ chối');
    expect(calls).not.toContain('POST /v1/admin/billing/tenant-1/backup/checkpoint');
  });

  it('gom hết đuôi journal qua nhiều trang cursor trước khi kiểm', async () => {
    const { call } = await fakeServer({ journalPages: [[entry(8), entry(9)], [entry(10)], []] });
    const bundle = await collectBundle({ call, tenantId: 'tenant-1' });
    expect(bundle.journal.map((/** @type {{seq:number}} */ item) => item.seq)).toEqual([8, 9, 10]);
    expect(await verifyBundle(bundle)).toEqual([]);
  });
});

describe('runRestore', () => {
  it('bật bảo trì trước, rồi nạp trang, rồi mới phát lại journal', async () => {
    const bundle = await makeBundle({ journal: [entry(8), entry(9)] });
    /** @type {string[]} */
    const calls = [];
    /** @type {any[]} */
    const bodies = [];
    /** @param {string} path @param {any} [init] */
    const call = async (path, init) => {
      calls.push(path.replace('/v1/admin/billing/tenant-1', ''));
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path.endsWith('/usage')) return { status: 'active', maintenance: true };
      return { ok: true };
    };
    await runRestore({ call, tenantId: 'tenant-1', bundle });
    expect(calls).toEqual([
      '/backup/maintenance',
      '/backup/restore',
      '/backup/restore',
      '/backup/restore',
      '/usage',
    ]);
    expect(bodies[0]).toMatchObject({ enabled: true });
    expect(bodies[1]).toHaveProperty('page.index', 0);
    expect(bodies[3]?.entries.map((/** @type {{seq:number}} */ item) => item.seq)).toEqual([8, 9]);
  });

  it('từ chối nạp một bản sao lưu đã hỏng', async () => {
    const bundle = await makeBundle();
    const first = bundle.pages[0];
    if (!first) throw new Error('fixture thiếu trang');
    first.checksum = 'f'.repeat(64);
    await expect(
      runRestore({ call: async () => ({}), tenantId: 'tenant-1', bundle }),
    ).rejects.toThrow('Bản sao lưu không hợp lệ');
  });
});

describe('parseArgs và tên object', () => {
  it('đọc cờ có giá trị và cờ cờ-không-giá-trị', () => {
    expect(parseArgs(['export', '--tenant', 't1', '--no-upload'])).toEqual({
      command: 'export',
      flags: { tenant: 't1', 'no-upload': true },
    });
  });

  it('đặt tên object theo giờ VN, mỗi tenant một thư mục riêng', () => {
    expect(backupObjectName('t1', new Date('2026-09-15T20:00:00Z'))).toBe(
      'quota-audit/t1/quota-20260916-0300.json.enc',
    );
  });
});

describe('accessHeaders', () => {
  it('gửi JWT người dùng, vì Worker bắt buộc có claim email', () => {
    expect(accessHeaders({ BILLING_ACCESS_JWT: 'jwt-nguoi-dung' })).toEqual({
      'Cf-Access-Jwt-Assertion': 'jwt-nguoi-dung',
    });
  });

  it('gửi kèm service token khi có, nhưng không coi nó là đủ', () => {
    expect(
      accessHeaders({
        BILLING_ACCESS_JWT: 'jwt',
        BILLING_ACCESS_CLIENT_ID: 'id',
        BILLING_ACCESS_CLIENT_SECRET: 'secret',
      }),
    ).toMatchObject({ 'Cf-Access-Jwt-Assertion': 'jwt', 'CF-Access-Client-Id': 'id' });
    // Chỉ có service token là chết ở Worker (invalid_access_jwt), nên phải dừng ngay tại CLI.
    expect(() =>
      accessHeaders({ BILLING_ACCESS_CLIENT_ID: 'id', BILLING_ACCESS_CLIENT_SECRET: 'secret' }),
    ).toThrow('BILLING_ACCESS_JWT');
  });
});
