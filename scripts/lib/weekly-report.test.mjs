import { describe, expect, it } from 'vitest';
import {
  analyticsSql,
  maskKey,
  renderHtml,
  renderText,
  summarize,
  weekRange,
} from './weekly-report.mjs';

describe('weekRange', () => {
  it('tuần trước theo giờ VN: thứ Hai 00:00 VN → thứ Hai 00:00 VN, trả UTC', () => {
    // 2026-09-07 là thứ Hai. 08:00 VN = 01:00Z.
    const r = weekRange(new Date('2026-09-07T01:00:00Z'));
    expect(r.from.toISOString()).toBe('2026-08-30T17:00:00.000Z'); // 31/08 00:00 VN
    expect(r.to.toISOString()).toBe('2026-09-06T17:00:00.000Z'); // 07/09 00:00 VN
    expect(r.label).toBe('31/08/2026 → 06/09/2026');
  });

  it('chạy giữa tuần vẫn lấy trọn tuần trước', () => {
    const r = weekRange(new Date('2026-09-09T10:00:00Z')); // thứ Tư
    expect(r.from.toISOString()).toBe('2026-08-30T17:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-06T17:00:00.000Z');
  });

  it('current: true lấy tuần đang chạy, từ thứ Hai 00:00 VN đến hiện tại', () => {
    // 09/09/2026 là thứ Tư; tuần đang chạy bắt đầu thứ Hai 07/09 00:00 VN = 06/09 17:00Z
    const now = new Date('2026-09-09T10:00:00Z');
    const r = weekRange(now, { current: true });
    expect(r.from.toISOString()).toBe('2026-09-06T17:00:00.000Z');
    expect(r.to).toBe(now);
    expect(r.label).toBe('07/09/2026 → 09/09/2026 (tuần đang chạy)');
  });

  it('chạy Chủ nhật (giờ VN) không nhảy sang tuần sau', () => {
    // 2026-09-06 là Chủ nhật; 20:00Z = 03:00 VN thứ Hai 07/09 → tuần trước vẫn là 31/08–06/09
    const r = weekRange(new Date('2026-09-06T20:00:00Z'));
    expect(r.label).toBe('31/08/2026 → 06/09/2026');
  });
});

describe('analyticsSql', () => {
  const q = analyticsSql({
    from: new Date('2026-08-30T17:00:00Z'),
    to: new Date('2026-09-06T17:00:00Z'),
    dataset: 'mapslibvn_api',
  });

  it('lọc theo khoảng thời gian và gộp tenant/key/path', () => {
    expect(q).toContain("timestamp >= toDateTime('2026-08-30 17:00:00')");
    expect(q).toContain("timestamp < toDateTime('2026-09-06 17:00:00')");
    expect(q).toContain('FROM mapslibvn_api');
    expect(q).toContain('GROUP BY tenant_id, api_key, path');
    expect(q.trim().endsWith('FORMAT JSON')).toBe(true);
  });

  it('dùng các hàm Analytics Engine đã kiểm chạy thật', () => {
    // Đã thử trên SQL API 02/09/2026: quantileWeighted chạy, `quantile` trả
    // "unknown function call: QUANTILE" nên không được dùng.
    expect(q).toContain('SUM(_sample_interval) AS requests');
    expect(q).toContain('sumIf(_sample_interval, double1 >= 500) AS errors_5xx');
    expect(q).toContain('sumIf(_sample_interval, double1 = 429) AS quota_429');
    expect(q).toContain('quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms');
    expect(q).not.toMatch(/\bquantile\(/);
  });
});

describe('maskKey', () => {
  it('giữ tiền tố + 4 đầu + 4 cuối', () => {
    expect(maskKey('mlv_live_demo00000000000000000000')).toBe('mlv_live_demo…0000');
    expect(maskKey('anon')).toBe('anon');
    expect(maskKey('')).toBe('(không key)');
  });
});

const rows = [
  {
    tenant_id: 't1',
    api_key: 'mlv_live_demo00000000000000000000',
    path: '/v1/autocomplete',
    requests: 900,
    errors_5xx: 2,
    quota_429: 0,
    p95_ms: 180,
  },
  {
    tenant_id: 't1',
    api_key: 'mlv_live_demo00000000000000000000',
    path: '/v1/places/01M1GMZ90J65C1V4SHB00D5BJ7',
    requests: 100,
    errors_5xx: 0,
    quota_429: 0,
    p95_ms: 90,
  },
  {
    tenant_id: 't2',
    api_key: 'mlv_live_nhungthuAAAAAAAAAAAAAAAA',
    path: '/v1/autocomplete',
    requests: 50,
    errors_5xx: 0,
    quota_429: 0,
    p95_ms: 300,
  },
  {
    tenant_id: '',
    api_key: '',
    path: '/v1/styles/light.json',
    requests: 40,
    errors_5xx: 0,
    quota_429: 0,
    p95_ms: 20,
  },
];
const labels = {
  tenants: { t1: 'MapsLibVN nội bộ', t2: 'Ứng dụng nhúng thử nghiệm (nội bộ)' },
  keys: { mlv_live_demo00000000000000000000: 'demo docs/playground' },
};

describe('summarize', () => {
  it('tổng, theo tenant (tên), theo key (mask + nhãn), top path; gộp /v1/places/:id', () => {
    const s = summarize(rows, labels);
    expect(s.total).toEqual({ requests: 1090, errors_5xx: 2, quota_429: 0 });
    expect(s.tenants[0]).toEqual({
      name: 'MapsLibVN nội bộ',
      requests: 1000,
      errors_5xx: 2,
      quota_429: 0,
      p95_ms: 180,
    });
    expect(s.tenants[1]?.name).toBe('Ứng dụng nhúng thử nghiệm (nội bộ)');
    expect(s.tenants[2]?.name).toBe('(không key)');
    expect(s.keys[0]).toEqual({
      key: 'mlv_live_demo…0000',
      label: 'demo docs/playground',
      tenant: 'MapsLibVN nội bộ',
      requests: 1000,
    });
    expect(s.keys[1]?.label).toBe('');
    expect(s.paths[0]).toEqual({
      path: '/v1/autocomplete',
      requests: 950,
      errors_5xx: 2,
      p95_ms: 300,
    });
    expect(s.paths.find((p) => p.path === '/v1/places/:id')?.requests).toBe(100);
  });

  it('gộp cả route duyệt đóng góp theo id', () => {
    // Thấy trên báo cáo thật 02/09: `/v1/admin/edits/2/approve` tách riêng theo từng id.
    const s = summarize(
      [
        {
          tenant_id: 't1',
          api_key: 'k',
          path: '/v1/admin/edits/2/approve',
          requests: 1,
          errors_5xx: 0,
          quota_429: 0,
          p95_ms: 1,
        },
        {
          tenant_id: 't1',
          api_key: 'k',
          path: '/v1/admin/edits/7/approve',
          requests: 1,
          errors_5xx: 0,
          quota_429: 0,
          p95_ms: 1,
        },
        {
          tenant_id: 't1',
          api_key: 'k',
          path: '/v1/admin/edits/9/reject',
          requests: 1,
          errors_5xx: 0,
          quota_429: 0,
          p95_ms: 1,
        },
        {
          tenant_id: 't1',
          api_key: 'k',
          path: '/v1/admin/edits',
          requests: 5,
          errors_5xx: 0,
          quota_429: 0,
          p95_ms: 1,
        },
      ],
      labels,
    );
    expect(s.paths.find((p) => p.path === '/v1/admin/edits/:id/approve')?.requests).toBe(2);
    expect(s.paths.find((p) => p.path === '/v1/admin/edits/:id/reject')?.requests).toBe(1);
    expect(s.paths.find((p) => p.path === '/v1/admin/edits')?.requests).toBe(5);
  });

  it('cộng đúng khi API trả số dạng chuỗi (UInt64 của Analytics Engine)', () => {
    // Đã xác nhận trên SQL API 02/09/2026: SUM và sumIf trả chuỗi, quantileWeighted trả số.
    const s = summarize(
      [
        {
          tenant_id: 't1',
          api_key: 'k1',
          path: '/v1/autocomplete',
          requests: '715',
          errors_5xx: '0',
          quota_429: '0',
          p95_ms: 78,
        },
        {
          tenant_id: 't1',
          api_key: 'k1',
          path: '/v1/search',
          requests: '18',
          errors_5xx: '18',
          quota_429: '0',
          p95_ms: 5566,
        },
      ],
      labels,
    );
    expect(s.total).toEqual({ requests: 733, errors_5xx: 18, quota_429: 0 });
    expect(s.tenants[0]?.requests).toBe(733);
  });

  it('rỗng khi không có dữ liệu', () => {
    const s = summarize([], labels);
    expect(s.total.requests).toBe(0);
    expect(s.tenants).toEqual([]);
  });

  it('top path giới hạn 15 dòng', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      tenant_id: 't1',
      api_key: 'k',
      path: `/v1/p${i}`,
      requests: i + 1,
      errors_5xx: 0,
      quota_429: 0,
      p95_ms: 1,
    }));
    expect(summarize(many, labels).paths).toHaveLength(15);
  });
});

describe('render', () => {
  const s = summarize(rows, labels);
  const range = { label: '31/08/2026 → 06/09/2026' };

  it('text có tiêu đề, tổng và bảng tenant', () => {
    const t = renderText(s, range);
    expect(t).toContain('MapsLibVN — báo cáo tuần 31/08/2026 → 06/09/2026');
    expect(t).toContain('Tổng request: 1090');
    expect(t).toContain('Ứng dụng nhúng thử nghiệm (nội bộ)');
    expect(t).toContain('mlv_live_demo…0000');
  });

  it('html có 3 bảng và escape ký tự nguy hiểm', () => {
    const h = renderHtml(s, range);
    expect(h.match(/<table/g)?.length).toBe(3);
    expect(h).toContain('&rarr;');
    const evil = renderHtml(
      summarize(
        [
          {
            tenant_id: 'x',
            api_key: 'k',
            path: '/v1/<script>alert(1)</script>',
            requests: 1,
            errors_5xx: 0,
            quota_429: 0,
            p95_ms: 1,
          },
        ],
        { tenants: {}, keys: {} },
      ),
      range,
    );
    expect(evil).not.toContain('<script');
    expect(evil).toContain('&lt;script');
  });

  it('không dữ liệu thì ghi rõ ở cả hai bản', () => {
    const empty = summarize([], labels);
    expect(renderText(empty, range)).toContain('Không có request nào');
    expect(renderHtml(empty, range)).toContain('Không có request nào');
  });
});
