import { describe, expect, it } from 'vitest';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const KEY = 'mlv_live_test00000000000000000000';

const get = async (path, headers = { 'X-Api-Key': KEY }) => {
  const response = await fetch(base + path, { headers });
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get('x-mlv-cache'),
  };
};
const distM = (lat1, lng1, lat2, lng2) => {
  const radius = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
};
const enc = encodeURIComponent;

describe('2 fixture nghiệm thu bắt buộc (spec mục 10)', () => {
  it('autocomplete Hoàng Diệu trả ít nhất 3 kết quả và Linh Xuân đứng đầu', async () => {
    const { status, body } = await get(
      `/v1/autocomplete?q=${enc('Trường Tiểu học Hoàng Diệu')}&near=10.77,106.70`,
    );
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    const first = body.items[0];
    expect(first.type).toBe('poi');
    expect(first.name).toBe('Trường Tiểu học Hoàng Diệu');
    expect(distM(first.lat, first.lng, 10.85594, 106.77325)).toBeLessThanOrEqual(50);
  });

  it('geocode 88/9 Nguyễn Lâm trả interpolated trong bán kính 60 m', async () => {
    const { status, body } = await get(`/v1/geocode?q=${enc('88/9 Nguyễn Lâm')}&near=10.76,106.66`);
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const item = body.items[0];
    expect(item.precision).toBe('interpolated');
    expect(item.confidence).toBe(0.6);
    expect(distM(item.lat, item.lng, 10.7647, 106.6631)).toBeLessThanOrEqual(60);
  });
});

describe('thang geocode và các route còn lại', () => {
  it('bước 1 rooftop: 86 Nguyễn Lâm', async () => {
    const { status, body } = await get(`/v1/geocode?q=${enc('86 Nguyễn Lâm')}&near=10.76,106.66`);
    expect(status).toBe(200);
    expect(body.items[0]).toMatchObject({ precision: 'rooftop', confidence: 0.9 });
  });

  it('bước 2 alley: 112/5 Nguyễn Lâm', async () => {
    const { status, body } = await get(
      `/v1/geocode?q=${enc('112/5 Nguyễn Lâm')}&near=10.76,106.66`,
    );
    expect(status).toBe(200);
    expect(body.items[0].precision).toBe('alley');
    expect(distM(body.items[0].lat, body.items[0].lng, 10.7647, 106.663)).toBeLessThanOrEqual(60);
  });

  it('bước 4 street ưu tiên đường Nguyễn Lâm tại HCM theo near', async () => {
    const { status, body } = await get(`/v1/geocode?q=${enc('Nguyễn Lâm')}&near=10.76,106.66`);
    expect(status).toBe(200);
    expect(body.items[0].precision).toBe('street');
    expect(body.items[0].lat).toBeCloseTo(10.7647, 2);
  });

  it('bước 5 admin trả Phường Linh Xuân', async () => {
    const { status, body } = await get(`/v1/geocode?q=${enc('Phường Linh Xuân')}`);
    expect(status).toBe(200);
    expect(body.items[0]).toMatchObject({ precision: 'ward', confidence: 0.2 });
  });

  it('alias phường cũ khóa rooftop trong polygon dù near sát anchor NULL ngoài vùng', async () => {
    const query = enc('86 Nguyễn Lâm, Phường 6, Quận 10, TP.HCM');
    const { status, body } = await get(`/v1/geocode?q=${query}&near=10.9,106.9`);
    expect(status).toBe(200);
    expect(body.items[0]).toMatchObject({
      precision: 'rooftop',
      matched: { ward: 'Phường Diên Hồng', former: { ward: 'Phường 6' } },
    });
    expect(distM(body.items[0].lat, body.items[0].lng, 10.7647, 106.6629)).toBeLessThan(30);
  });

  it.each([
    ['88 Nguyễn Lâm, Phường 6, Quận 10, TP.HCM', 'interpolated'],
    ['112/5 Nguyễn Lâm, Phường 6, Quận 10, TP.HCM', 'alley'],
    ['Nguyễn Lâm, Phường 6, Quận 10, TP.HCM', 'street'],
  ])('alias cũ áp scope cho %s', async (query, precision) => {
    const { status, body } = await get(`/v1/geocode?q=${enc(query)}&near=10.76,106.66`);
    expect(status).toBe(200);
    expect(body.items[0]).toMatchObject({ precision, matched: { former: { ward: 'Phường 6' } } });
    expect(body.items[0].lng).toBeGreaterThan(106.65);
    expect(body.items[0].lng).toBeLessThan(106.68);
  });

  it('quận cũ trả một bbox lịch sử thay vì chọn tùy tiện phường mới', async () => {
    const { status, body } = await get(`/v1/geocode?q=${enc('Quận 10, TP.HCM')}`);
    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      precision: 'district',
      matched: { former: { district: 'Quận 10' } },
      bbox: [106.65, 10.75, 106.68, 10.79],
    });
    expect(body.items[0].display_name).toContain('trước 07/2025');
  });

  it('reverse trả khoảng số nhà, đường, phường và tỉnh', async () => {
    const { status, body } = await get('/v1/reverse?lat=10.7647&lng=106.6631');
    expect(status).toBe(200);
    expect(body.address).toMatchObject({
      approx_housenumber: '≈ 86–90',
      street: 'Nguyễn Lâm',
      ward: 'Phường Diên Hồng',
      province: 'Thành phố Hồ Chí Minh',
    });
  });

  it('autocomplete Highlands có score giảm dần', async () => {
    const { status, body } = await get('/v1/autocomplete?q=highlands&near=10.77,106.70');
    expect(status).toBe(200);
    expect(body.items[0].name).toBe('Highlands Coffee Test');
    const scores = body.items.map((item) => item.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('autocomplete area gom Quận 10 cũ, giữ bbox qua cache và lọc theo types', async () => {
    const path = `/v1/autocomplete?q=${enc('Quận 10')}&types=area&limit=7`;
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0]).toMatchObject({
      type: 'area',
      name: 'Quận 10',
      precision: 'district',
      bbox: [106.65, 10.75, 106.68, 10.79],
    });
    expect(first.body.items[0].secondary.split(', ')).toHaveLength(4);
    expect(first.body.items[0].secondary).toMatch(/, …$/);

    const cached = await get(path);
    expect(cached.cache).toBe('hit');
    expect(cached.body.items[0].bbox).toEqual([106.65, 10.75, 106.68, 10.79]);

    const oldTypes = await get(`/v1/autocomplete?q=${enc('Quận 10')}&types=poi,street`);
    expect(oldTypes.body.items.every((item) => item.type !== 'area')).toBe(true);
  });

  it('autocomplete area trả current theo tên mới và vùng cũ khi phường bị tách', async () => {
    const current = await get(`/v1/autocomplete?q=${enc('Phường Diên Hồng')}&types=area`);
    expect(current.body.items[0]).toMatchObject({
      type: 'area',
      name: 'Phường Diên Hồng',
      precision: 'ward',
    });

    const old = await get(`/v1/autocomplete?q=${enc('Phường 6')}&types=area`);
    expect(old.body.items).toHaveLength(1);
    expect(old.body.items[0]).toMatchObject({
      type: 'area',
      name: 'Phường 6',
      precision: 'ward',
      bbox: [106.65, 10.75, 106.68, 10.79],
    });
  });

  it('search trả shape Place chuẩn', async () => {
    const { status, body } = await get(
      `/v1/search?q=${enc('hoang dieu')}&near=10.86,106.77&radius=50000`,
    );
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(3);
    const place = body.items[0];
    for (const key of [
      'id',
      'name',
      'category',
      'lat',
      'lng',
      'address',
      'quality_score',
      'status',
      'updated_at',
    ]) {
      expect(place).toHaveProperty(key);
    }
    expect(place.category.code).toBe('primary_school');
  });

  it('nearby tìm thấy Highlands trong 200 m', async () => {
    const { status, body } = await get('/v1/nearby?lat=10.772&lng=106.700&radius=200');
    expect(status).toBe(200);
    expect(body.items.some((place) => place.id === '01M3TEST0000000000000CAF01')).toBe(true);
  });

  it('place details trả sources/attribution và id lạ trả 404', async () => {
    const { status, body } = await get('/v1/places/01M3TEST0000000000000SCH01');
    expect(status).toBe(200);
    expect(body.sources).toEqual([{ source: 'osm', source_id: 'm3test-sch1', role: 'primary' }]);
    expect(body.attribution.text).toContain('OpenStreetMap');
    expect((await get('/v1/places/khong-ton-tai')).status).toBe(404);
  });

  it('auth DB thật trả 401 cho key thiếu hoặc không tồn tại', async () => {
    expect((await get('/v1/autocomplete?q=highlands', {})).status).toBe(401);
    const response = await get('/v1/autocomplete?q=highlands', {
      'X-Api-Key': 'mlv_live_khongtontai00000000000000',
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_key');
  });
});

// Sự cố 06/09/2026: Worker mang code Task 5/6 deploy trước migration 0008 nên
// /v1/autocomplete mặc định trả 503 nhiều giờ, trong khi /healthz/db vẫn 200. Chốt hai điều:
// healthz phải công bố phiên bản schema để phát hiện lệch, và nhánh area phải chạy được.
describe('lệch schema giữa Worker và DB', () => {
  it('/healthz/db công bố migration mới nhất đã áp', async () => {
    const { status, body } = await get('/healthz/db');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.schema_migration).toMatch(/^\d{4}_/);
  });

  it('autocomplete mặc định gồm area không được 5xx khi bảng old rỗng', async () => {
    const { status } = await get('/v1/autocomplete?q=quan%2010&limit=5');
    expect(status).toBe(200);
  });
});
