import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { QuotaObject } from '../src/billing/quota-object';
import type { EntitlementCommand, JournalEntry, SnapshotPage } from '../src/billing/types';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
const objectFor = (name: string) => env.QUOTA.get(env.QUOTA.idFromName(name));

const base = (tenant: string, expectedRevision = 0) => ({
  operationId: crypto.randomUUID(),
  tenantId: tenant,
  actor: 'billing-backup@test.invalid',
  reason: 'billing backup test',
  expectedRevision,
});

const paid = (
  tenant: string,
  overrides: Partial<Extract<EntitlementCommand, { kind: 'grantPeriod' }>> = {},
): Extract<EntitlementCommand, { kind: 'grantPeriod' }> => ({
  ...base(tenant),
  kind: 'grantPeriod',
  periodId: crypto.randomUUID(),
  tier: 'starter',
  startsAt: day(-1),
  endsAt: day(29),
  paymentReference: `pay-${crypto.randomUUID()}`,
  lineItemId: 'line-1',
  ...overrides,
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** reserve → prepare → ack: một lượt tính tiền trọn vẹn, giống hệt middleware thương mại. */
async function charge(object: DurableObjectStub<QuotaObject>, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    const requestId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const reservation = await object.reserve(requestId, 'places');
    expect(reservation.allowed).toBe(true);
    await object.prepare(requestId, await sha256Hex(token));
    await object.ack(requestId, token);
  }
}

interface Snapshot {
  manifest: Awaited<ReturnType<QuotaObject['beginSnapshot']>>;
  pages: SnapshotPage[];
}

async function exportSnapshot(object: DurableObjectStub<QuotaObject>): Promise<Snapshot> {
  const manifest = await object.beginSnapshot(crypto.randomUUID(), 'operator@test.invalid');
  const pages: SnapshotPage[] = [];
  for (let index = 0; index < manifest.pages; index += 1) {
    pages.push(await object.readSnapshotPage(manifest.snapshotId, index));
  }
  return { manifest, pages };
}

/** Đuôi journal sau một mốc: đây mới là phần chứa các khoản tính SAU khi snapshot đóng băng. */
async function readTail(
  object: DurableObjectStub<QuotaObject>,
  afterSequence: number,
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  let after = afterSequence;
  for (;;) {
    const page = await object.readJournal(after, 100);
    if (page.entries.length === 0) return entries;
    entries.push(...page.entries);
    after = page.nextSequence;
  }
}

async function restoreInto(
  target: DurableObjectStub<QuotaObject>,
  snapshot: Snapshot,
  tail: JournalEntry[],
): Promise<void> {
  await target.setMaintenance(crypto.randomUUID(), 'operator@test.invalid', 'drill', true);
  for (const page of snapshot.pages) {
    await target.restoreSnapshotPage(crypto.randomUUID(), snapshot.manifest.snapshotId, page);
  }
  if (tail.length > 0) await target.restoreJournal(crypto.randomUUID(), tail);
}

/**
 * Bắt lỗi NGAY TRONG object. Để lỗi bay qua ranh giới RPC làm vitest-pool-workers hỏng isolated
 * storage và báo "Failed to pop isolated storage stack frame" thay vì lỗi thật — một kiểu đỏ giả
 * che mất nguyên nhân.
 */
async function failure(
  object: DurableObjectStub<QuotaObject>,
  call: (instance: QuotaObject) => Promise<unknown>,
): Promise<string> {
  return runInDurableObject(object, async (instance: QuotaObject) => {
    try {
      await call(instance);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

describe('QuotaObject backup and reconciliation', () => {
  it('refuses to advance the checkpoint when the exported bytes do not match', async () => {
    const tenant = crypto.randomUUID();
    const object = objectFor(tenant);
    await object.applyCommand(paid(tenant));
    await charge(object, 2);

    const { manifest, pages } = await exportSnapshot(object);
    expect(manifest.pages).toBeGreaterThan(0);
    // Checksum phải tính lại được từ đúng chuỗi byte đã tải về, không phải từ object đã parse:
    // parse rồi stringify có thể đổi byte mà không đổi ý nghĩa.
    expect(await sha256Hex(pages[0]?.records ?? '')).toBe(pages[0]?.checksum);

    expect(
      await failure(object, (instance) =>
        instance.advanceCheckpoint(crypto.randomUUID(), manifest.snapshotId, `0${'f'.repeat(63)}`),
      ),
    ).toBe('checksum_mismatch');
    const receipt = await object.advanceCheckpoint(
      crypto.randomUUID(),
      manifest.snapshotId,
      manifest.checksum,
    );
    expect(receipt.sequence).toBe(manifest.sequence);
  });

  it('restores snapshot plus journal tail to the later count, never back to the snapshot', async () => {
    const tenant = crypto.randomUUID();
    const source = objectFor(tenant);
    await source.applyCommand(paid(tenant));
    await charge(source, 10);
    expect((await source.readUsage()).places.used).toBe(10);

    const snapshot = await exportSnapshot(source);
    await source.advanceCheckpoint(
      crypto.randomUUID(),
      snapshot.manifest.snapshotId,
      snapshot.manifest.checksum,
    );
    // Ba lượt tính SAU checkpoint: chỉ nằm trong đuôi journal, không nằm trong snapshot.
    await charge(source, 3);
    const tail = await readTail(source, snapshot.manifest.sequence);
    expect(tail).toHaveLength(3);

    const target = objectFor(`restore:${tenant}`);
    await restoreInto(target, snapshot, tail);
    expect((await target.readUsage()).places.used).toBe(13);

    // Chạy lại đúng đuôi đó không được cộng thêm lần hai.
    await target.restoreJournal(crypto.randomUUID(), tail);
    expect((await target.readUsage()).places.used).toBe(13);
  });

  it('replays a credit grant without handing out the units twice', async () => {
    const tenant = crypto.randomUUID();
    const source = objectFor(tenant);
    const grant = paid(tenant);
    await source.applyCommand(grant);
    await source.applyCommand({
      ...base(tenant, 1),
      kind: 'addCredits',
      periodId: grant.periodId,
      group: 'places',
      packs: 1,
      paymentReference: `pay-${crypto.randomUUID()}`,
      lineItemId: 'credit-1',
    });
    expect((await source.readUsage()).places.credits).toBe(1_000);

    const snapshot = await exportSnapshot(source);
    // Đuôi từ 0 chứa CẢ hai lệnh đã nằm sẵn trong snapshot: phát lại phải nhận ra và bỏ qua.
    const overlapping = await readTail(source, 0);
    expect(overlapping.length).toBeGreaterThanOrEqual(2);

    const target = objectFor(`restore-credit:${tenant}`);
    await restoreInto(target, snapshot, []);
    expect((await target.readUsage()).places.credits).toBe(1_000);
    const receipt = await target.restoreJournal(crypto.randomUUID(), overlapping);
    expect(receipt.applied).toBe(0);
    expect((await target.readUsage()).places.credits).toBe(1_000);
  });

  it('refuses a stale snapshot instead of resetting a ledger that moved on', async () => {
    const tenant = crypto.randomUUID();
    const source = objectFor(tenant);
    await source.applyCommand(paid(tenant));
    await charge(source, 10);
    const old = await exportSnapshot(source);
    await charge(source, 3);
    expect((await source.readUsage()).places.used).toBe(13);

    await source.setMaintenance(crypto.randomUUID(), 'operator@test.invalid', 'drill', true);
    expect(
      await failure(source, (instance) =>
        instance.restoreSnapshotPage(
          crypto.randomUUID(),
          old.manifest.snapshotId,
          old.pages[0] as SnapshotPage,
        ),
      ),
    ).toBe('snapshot_stale');
    expect((await source.readUsage()).places.used).toBe(13);
  });

  it('refuses to restore while the ledger is open or still seeing traffic', async () => {
    const tenant = crypto.randomUUID();
    const source = objectFor(tenant);
    await source.applyCommand(paid(tenant));
    await charge(source, 1);
    const snapshot = await exportSnapshot(source);
    const page = snapshot.pages[0] as SnapshotPage;

    const target = objectFor(`restore-busy:${tenant}`);
    expect(
      await failure(target, (instance) =>
        instance.restoreSnapshotPage(crypto.randomUUID(), snapshot.manifest.snapshotId, page),
      ),
    ).toBe('not_in_maintenance');

    await target.setMaintenance(crypto.randomUUID(), 'operator@test.invalid', 'drill', true);
    // Bảo trì chặn cấp lượt mới, nên không có request nào chen vào giữa lúc ghi đè sổ.
    expect(await target.reserve(crypto.randomUUID(), 'places')).toMatchObject({
      allowed: false,
      reason: 'maintenance',
    });

    // Cùng bản sao lưu đó, nạp lên object VỪA phục vụ xong: cổng khoảng lặng phải chặn.
    await source.setMaintenance(crypto.randomUUID(), 'operator@test.invalid', 'drill', true);
    expect(
      await failure(source, (instance) =>
        instance.restoreSnapshotPage(crypto.randomUUID(), snapshot.manifest.snapshotId, page),
      ),
    ).toBe('traffic_active');
  });

  it('stops a journal replay with a hole instead of guessing the missing usage', async () => {
    const tenant = crypto.randomUUID();
    const source = objectFor(tenant);
    await source.applyCommand(paid(tenant));
    await charge(source, 4);
    const snapshot = await exportSnapshot(source);
    await source.advanceCheckpoint(
      crypto.randomUUID(),
      snapshot.manifest.snapshotId,
      snapshot.manifest.checksum,
    );
    await charge(source, 3);
    const tail = await readTail(source, snapshot.manifest.sequence);
    expect(tail).toHaveLength(3);

    const target = objectFor(`restore-gap:${tenant}`);
    await target.setMaintenance(crypto.randomUUID(), 'operator@test.invalid', 'drill', true);
    for (const page of snapshot.pages) {
      await target.restoreSnapshotPage(crypto.randomUUID(), snapshot.manifest.snapshotId, page);
    }
    const holed = [tail[0] as JournalEntry, tail[2] as JournalEntry];
    expect(
      await failure(target, (instance) => instance.restoreJournal(crypto.randomUUID(), holed)),
    ).toBe('journal_gap');
    // Fail closed: không áp một nửa rồi báo xong.
    expect((await target.readUsage()).places.used).toBe(4);
  });

  it('keeps API key hashes, queries and coordinates out of the exported ledger', async () => {
    const tenant = crypto.randomUUID();
    const object = objectFor(tenant);
    await object.applyCommand(paid(tenant));
    const keyHash = await sha256Hex('key-that-must-not-leak');
    const requestId = crypto.randomUUID();
    await object.reserve(requestId, 'places', keyHash);
    await object.prepare(requestId, await sha256Hex('token'));

    const snapshot = await exportSnapshot(object);
    const tail = await readTail(object, 0);
    const dump = [...snapshot.pages.map((page) => page.records), JSON.stringify(tail)].join('\n');
    expect(dump).not.toContain(keyHash);
    expect(dump).not.toMatch(/"key_hash"|"keyHash"/);
    expect(dump).not.toMatch(/\bq=|"query"|"lat"|"lon"|"near"/);
  });
});
