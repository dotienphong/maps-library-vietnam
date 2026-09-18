import { describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

// Hạ tầng này nối Postgres bằng role CHỦ SỞ HỮU (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB`
// lấy thẳng từ .env), không phải role `api`. Ranh giới quyền của `api` được canh ở chỗ khác:
// `PERMISSIONS_SQL` trong scripts/lib/db-permissions.mjs (`GRANT SELECT ON tenant, api_key TO api`
// là dòng mà truy vấn nhãn tenant của /v1/admin/metrics dựa vào). Đừng khẳng định `db.user` ở đây:
// nó sẽ nói dối về thứ bài test này thật sự chứng minh.
describe('GET /v1/admin/health — DB thật qua Hyperdrive local', () => {
  it('đọc được DB và mốc migration qua đường đi thật, không phải mock', async () => {
    const response = await adminFetch('/v1/admin/health');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.db.ok).toBe(true);
    // Tầng unit trỏ Hyperdrive vào cổng đóng nên nhánh này chỉ chạy được ở đây.
    expect(body.db.schema_migration).toMatch(/^\d{4}/);
    expect(body.db.version).toMatch(/^PostgreSQL/);
    expect(body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('phép đo định tuyến luôn trả lời được, sống hay chết cũng nói rõ', async () => {
    // CỐ Ý không khẳng định routing.ok là true hay false: máy dev có thể đang chạy Valhalla trong
    // Docker mà cũng có thể không (MAPSLIBVN_RESTART=no trên MacBook). Khẳng định một giá trị cố
    // định ở đây là dựng sẵn một bài test đỏ ngẫu nhiên. Cái phải đúng trong cả hai trường hợp là:
    // payload vẫn sống, và phép đo hỏng thì nói được vì sao.
    const body = await (await adminFetch('/v1/admin/health')).json();
    expect(typeof body.routing.ok).toBe('boolean');
    expect(typeof body.routing.ms).toBe('number');
    if (body.routing.ok) expect(body.routing.distance_km).toBeGreaterThan(0);
    else expect(typeof body.routing.error).toBe('string');
    // Và dù định tuyến thế nào thì DB vẫn phải đọc được — đó là điểm của việc bọc lỗi riêng.
    expect(body.db.ok).toBe(true);
  });
});

describe('GET /v1/admin/metrics — DB thật qua Hyperdrive local', () => {
  it('chưa có CF_ANALYTICS_TOKEN → 503 analytics_not_configured, không phải 500', async () => {
    const response = await adminFetch('/v1/admin/metrics?window=1h');
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('analytics_not_configured');
  });

  it('window lạ → 400 invalid_request', async () => {
    const response = await adminFetch('/v1/admin/metrics?window=30d');
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
  });
});
