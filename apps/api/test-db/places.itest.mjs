import { describe, expect, it } from 'vitest';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const KEY = 'mlv_live_test00000000000000000000';

const get = async (path, headers = { 'X-Api-Key': KEY }) => {
  const response = await fetch(base + path, { headers });
  return { status: response.status, body: await response.json() };
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
