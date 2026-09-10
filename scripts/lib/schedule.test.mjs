import { describe, expect, it } from 'vitest';
import { nextJob, nextRun, waitUntil } from './schedule.mjs';

describe('nextRun (giờ VN, UTC+7)', () => {
  it('hằng ngày 03:00 VN: từ 26/08 01:00 VN → 26/08 03:00 VN', () => {
    const now = new Date('2026-08-25T18:00:00Z'); // 26/08 01:00 VN
    expect(nextRun(now, { hour: 3, minute: 0 }).toISOString()).toBe('2026-08-25T20:00:00.000Z');
  });
  it('hằng ngày 03:00 VN: từ 26/08 03:00:01 VN → 27/08 03:00 VN', () => {
    const now = new Date('2026-08-25T20:00:01Z');
    expect(nextRun(now, { hour: 3, minute: 0 }).toISOString()).toBe('2026-08-26T20:00:00.000Z');
  });
  it('thứ Hai 02:00 VN: từ thứ Tư 26/08/2026 → thứ Hai 31/08 02:00 VN = 30/08 19:00Z', () => {
    const now = new Date('2026-08-26T05:00:00Z');
    expect(nextRun(now, { hour: 2, minute: 0, weekday: 1 }).toISOString()).toBe(
      '2026-08-30T19:00:00.000Z',
    );
  });
  it('đúng thời điểm chạy → lần kế tiếp là tuần sau', () => {
    const now = new Date('2026-08-30T19:00:00Z');
    expect(nextRun(now, { hour: 2, minute: 0, weekday: 1 }).toISOString()).toBe(
      '2026-09-06T19:00:00.000Z',
    );
  });
});

describe('nextJob', () => {
  const jobs = [
    { name: 'data:update', schedule: { hour: 2, minute: 0, weekday: 1 } },
    { name: 'report:weekly', schedule: { hour: 8, minute: 0, weekday: 1 } },
  ];

  it('chọn job sớm nhất kế tiếp', () => {
    // Thứ Hai 07/09 03:00 VN = 06/09 20:00Z → data:update 02:00 đã qua, report 08:00 gần nhất
    const { job, at } = nextJob(new Date('2026-09-06T20:00:00Z'), jobs);
    expect(job.name).toBe('report:weekly');
    expect(at.toISOString()).toBe('2026-09-07T01:00:00.000Z');
  });

  it('sau 08:00 thứ Hai thì job kế tiếp là data:update tuần sau', () => {
    const { job, at } = nextJob(new Date('2026-09-07T02:00:00Z'), jobs);
    expect(job.name).toBe('data:update');
    expect(at.toISOString()).toBe('2026-09-13T19:00:00.000Z');
  });

  it('ném lỗi khi danh sách job rỗng', () => {
    expect(() => nextJob(new Date(), [])).toThrow(/job/);
  });
});

describe('waitUntil — chờ theo giờ thật, không tin một setTimeout dài (máy chủ Mac ngủ đêm 09→10/09)', () => {
  /** Đồng hồ giả: sleep tua đúng số ms và ghi lại các lần gọi. @param {number} start */
  const clock = (start) => {
    let now = start;
    /** @type {number[]} */
    const calls = [];
    return {
      now: () => now,
      calls,
      /** @param {number} ms */
      sleep: async (ms) => {
        now += ms;
        calls.push(ms);
      },
      /** @param {number} ms */
      jump: (ms) => {
        now += ms;
      },
    };
  };

  it('ngủ từng bước ≤ stepMs cho tới khi tới mốc, không ngủ quá mốc', async () => {
    const c = clock(0);
    await waitUntil(new Date(150_000), { now: c.now, sleep: c.sleep, stepMs: 60_000 });
    expect(c.calls).toEqual([60_000, 60_000, 30_000]);
    expect(c.now()).toBe(150_000);
  });

  it('đồng hồ nhảy vọt (máy vừa thức) → lần kiểm kế tiếp thấy đã quá mốc và trả về ngay', async () => {
    const c = clock(0);
    let jumped = false;
    /** @param {number} ms */
    const sleep = async (ms) => {
      await c.sleep(ms);
      if (!jumped) {
        jumped = true;
        c.jump(8 * 3600_000); // máy ngủ 8 giờ trong lúc "sleep"
      }
    };
    await waitUntil(new Date(3 * 3600_000), { now: c.now, sleep, stepMs: 60_000 });
    expect(c.calls.length).toBe(1); // một bước ngủ, không chờ hết 3 giờ
  });

  it('mốc đã qua → không ngủ', async () => {
    const c = clock(5_000);
    await waitUntil(new Date(1_000), { now: c.now, sleep: c.sleep });
    expect(c.calls).toEqual([]);
  });
});
