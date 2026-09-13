import { beforeAll, describe, expect, it } from 'vitest';

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

  // Postgres THẬT là tầng duy nhất bắt được lỗi này: `postgres/cf` trong Workers nối mảng JS thành
  // "osm,fsq" nên bind mảng rồi cast `::text[]` sẽ ném `malformed array literal`. Unit
  // test dùng fakeSql nên không thấy gì.
  it('sources= chạy thật trên 4 route, không ném malformed array literal', async () => {
    for (const path of [
      `/v1/search?q=${enc('Highlands')}&sources=osm`,
      `/v1/search?q=${enc('Highlands')}&sources=all`,
      `/v1/search?q=${enc('Highlands')}&sources=fsq`,
      '/v1/nearby?lat=10.77&lng=106.70&radius=500&sources=osm',
      '/v1/reverse?lat=10.77&lng=106.70&sources=osm,fsq',
      `/v1/autocomplete?q=${enc('Highlands')}&near=10.77,106.70&sources=osm`,
    ]) {
      const { status, body } = await get(path);
      expect(status, `${path} → ${JSON.stringify(body)}`).toBe(200);
    }
  });

  it('sources=overture (nguồn đã gỡ) → 400 invalid_request trên 4 route', async () => {
    for (const path of [
      `/v1/search?q=${enc('Highlands')}&sources=overture`,
      '/v1/nearby?lat=10.77&lng=106.70&radius=500&sources=overture',
      '/v1/reverse?lat=10.77&lng=106.70&sources=osm,overture',
      `/v1/autocomplete?q=${enc('Highlands')}&near=10.77,106.70&sources=overture`,
    ]) {
      const { status, body } = await get(path);
      expect(status, `${path} → ${JSON.stringify(body)}`).toBe(400);
      expect(body.error.code).toBe('invalid_request');
    }
  });

  // Mỗi cụm có hai hàng fsq: "Foursquare Near" đứng gần điểm hỏi reverse nhất (thay hàng Overture cũ).
  const PROFILE_SOURCES = { all: ['osm', 'fsq'], osm: ['osm'], fsq: ['fsq'] };
  const sourceIds = {
    osm: ['R5SOURCEOSM000000000000001'],
    fsq: ['R5SOURCEFSQNEAR00000000001', 'R5SOURCEFSQ000000000000001'],
    user: ['R5SOURCEUSER00000000000001'],
  };
  const ids = (response) => new Set(response.body.items.map((item) => item.id));
  const expectProfile = (actual, included, excluded) => {
    for (const id of included) expect(actual.has(id), `thiếu ${id}`).toBe(true);
    for (const id of excluded) expect(actual.has(id), `thừa ${id}`).toBe(false);
  };
  const expectedIdsFor = (profile, fixture = sourceIds) => {
    const selected = PROFILE_SOURCES[profile];
    const included = [...selected, 'user'].flatMap((source) => fixture[source]);
    const excluded = PROFILE_SOURCES.all
      .filter((source) => !selected.includes(source))
      .flatMap((source) => fixture[source]);
    return { included, excluded };
  };

  it.each([
    ['search', `/v1/search?q=${enc('r5 profile alpha')}&limit=50`],
    ['nearby', '/v1/nearby?lat=11&lng=107&radius=100'],
  ])('%s lọc đúng ID theo đủ ba profile và luôn giữ user', async (_route, path) => {
    for (const profile of ['all', 'osm', 'fsq']) {
      const actual = ids(await get(`${path}&sources=${profile}`));
      const expected = expectedIdsFor(profile);
      expectProfile(actual, expected.included, expected.excluded);
    }
  });

  it('reverse chọn lại nearest_poi sau khi lọc nguồn, user vẫn đủ điều kiện', async () => {
    const [fsqNear] = sourceIds.fsq;
    const [osmId] = sourceIds.osm;
    const all = await get('/v1/reverse?lat=11&lng=107&sources=all');
    const osm = await get('/v1/reverse?lat=11&lng=107&sources=osm');
    const fsq = await get('/v1/reverse?lat=11&lng=107&sources=fsq');
    expect(all.body.nearest_poi.id).toBe(fsqNear);
    // Hàng gần nhất là fsq → lọc osm phải chọn lại, không được lọc sau LIMIT 1.
    expect(osm.body.nearest_poi.id).toBe(osmId);
    expect(fsq.body.nearest_poi.id).toBe(fsqNear);
  });

  it.each([
    ['alpha', 'osm', 'all'],
    ['beta', 'all', 'fsq'],
  ])('autocomplete cache tách profile theo chiều %s: %s → %s', async (query, first, second) => {
    const firstIds = ids(
      await get(`/v1/autocomplete?q=r5%20profile%20${query}&types=poi&limit=10&sources=${first}`),
    );
    const secondIds = ids(
      await get(`/v1/autocomplete?q=r5%20profile%20${query}&types=poi&limit=10&sources=${second}`),
    );
    const suffix = query === 'alpha' ? '1' : '2';
    const expected = {
      osm: [`R5SOURCEOSM00000000000000${suffix}`],
      fsq: [`R5SOURCEFSQNEAR0000000000${suffix}`, `R5SOURCEFSQ00000000000000${suffix}`],
      user: [`R5SOURCEUSER0000000000000${suffix}`],
    };
    for (const [profile, actual] of [
      [first, firstIds],
      [second, secondIds],
    ]) {
      const expectation = expectedIdsFor(profile, expected);
      expectProfile(actual, expectation.included, expectation.excluded);
    }
  });

  it.each([
    [
      'alias địa danh',
      'r5 alias qui nhon',
      'R5SOURCEUSERALIAS0000001',
      'R5SOURCEFSQALIAS0000000001',
    ],
    ['tsvector', 'r5 token branch', 'R5SOURCEUSERTOKEN0000001', 'R5SOURCEFSQTOKEN0000000001'],
    ['viKey', 'r5 can bien', 'R5SOURCEUSERKEY000000001', 'R5SOURCEFSQKEY000000000001'],
    [
      'Telex fallback',
      'thuw vieenj quoocs gia',
      'R5SOURCEUSERTELEX0000001',
      'R5SOURCEFSQTELEX0000000001',
    ],
  ])('autocomplete nhánh %s lọc nguồn nhưng giữ user', async (_branch, query, user, commercial) => {
    const osm = ids(await get(`/v1/autocomplete?q=${enc(query)}&types=poi&limit=10&sources=osm`));
    const all = ids(await get(`/v1/autocomplete?q=${enc(query)}&types=poi&limit=10&sources=all`));
    expectProfile(osm, [user], [commercial]);
    expectProfile(all, [user, commercial], []);
  });

  it('sources không lọc các nhánh street, address và area của autocomplete', async () => {
    const street = await get(`/v1/autocomplete?q=${enc('Nguyễn Lâm')}&types=street&sources=osm`);
    const address = await get(
      `/v1/autocomplete?q=${enc('86 Nguyễn Lâm')}&types=address&sources=fsq`,
    );
    const area = await get(`/v1/autocomplete?q=${enc('Quận 10')}&types=area&sources=osm`);
    expect(street.body.items.some((item) => item.type === 'street')).toBe(true);
    expect(address.body.items.some((item) => item.type === 'address')).toBe(true);
    expect(area.body.items.some((item) => item.type === 'area')).toBe(true);
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

describe('hạng mục 3 — trước backfill: cột dẫn xuất NULL không gây 5xx (spec 8)', () => {
  it('autocomplete/search 200; dòng NULL vẫn tìm được ở bậc 1 qua nhánh qAlias', async () => {
    const a = await get(`/v1/autocomplete?q=${enc('qui nhon')}&types=poi`);
    expect(a.status).toBe(200);
    expect(a.body.items.some((i) => i.id === 't3-poi-null')).toBe(true);
    const s = await get(`/v1/search?q=${enc('qui nhon')}`);
    expect(s.status).toBe(200);
    expect(s.body.items.some((i) => i.id === 't3-poi-null')).toBe(true);
  });

  it('bậc 2 + 3 chạy thật trên Postgres khi cột NULL ở phần lớn dòng: 200 và rỗng đúng nghĩa', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('zzq wwx')}&types=poi,street`);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });

  it('bậc 3 — cơ chế: "chan bien" (bậc 1/2 rỗng) ra t3-poi-key qua name_key đặt tay', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('chan bien')}&types=poi`);
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.id)).toContain('t3-poi-key');
  });

  it('bậc 2 — cơ chế: "hai bac nghia" (đảo thứ tự, bậc 1 rỗng) ra đường qua name_tsv đặt tay', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('hai bac nghia')}&types=street`);
    expect(r.status).toBe(200);
    expect(r.body.items.some((i) => i.name === 'Đường Vô Nghĩa Bậc Hai')).toBe(true);
  });
});

describe('hạng mục 3 — sau backfill (chỉ điền dòng NULL, giữ dòng đặt tay)', () => {
  beforeAll(async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['scripts/backfill-search-keys.mjs'], {
      stdio: 'inherit',
      env: process.env,
    });
  });

  it('tên cũ của đường: "cong ly" trả Nam Kỳ Khởi Nghĩa với matched_alt "Công Lý"', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('cong ly')}&types=street`);
    expect(r.status).toBe(200);
    const hit = r.body.items.find((i) => i.name === 'Nam Kỳ Khởi Nghĩa');
    expect(hit?.matched_alt).toBe('Công Lý');
  });

  it('geocode "Công Lý" qua tên thay thế của đường trả precision street', async () => {
    const r = await get(`/v1/geocode?q=${enc('Công Lý')}&near=10.78,106.69`);
    expect(r.status).toBe(200);
    expect(r.body.items[0]?.precision).toBe('street');
  });

  it('/v1/search tìm được POI mà CHỈ tên thay thế khớp (nhánh name_alt_norm của route search)', async () => {
    // name_norm của dòng này là 'zzzk vvvq' nên không nhánh nào của bậc 1 khớp 'cho cu sai gon';
    // ra được kết quả tức là nhánh name_alt_norm đang chạy thật.
    const r = await get(`/v1/search?q=${enc('cho cu sai gon')}`);
    expect(r.status).toBe(200);
    expect(r.body.items.some((i) => i.id === 't3-poi-alt')).toBe(true);
  });

  it('autocomplete trả matched_alt cho POI khớp qua tên thay thế', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('cho cu sai gon')}&types=poi`);
    expect(r.status).toBe(200);
    const hit = r.body.items.find((i) => i.id === 't3-poi-alt');
    expect(hit?.matched_alt).toBe('Chợ Cũ Sài Gòn');
  });

  it('dòng NULL đã được điền đúng searchKeys; dòng đặt tay giữ nguyên', async () => {
    const { default: postgres } = await import('postgres');
    const { searchKeys } = await import('@mapslibvn/core');
    const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
    try {
      const [n] = await sql`SELECT name_norm, name_key FROM poi WHERE id = 't3-poi-null'`;
      expect(n.name_key).toBe(searchKeys(n.name_norm, null).nameKey);
      const [k] = await sql`SELECT name_key FROM poi WHERE id = 't3-poi-key'`;
      expect(k.name_key).toBe('canbien');
    } finally {
      await sql.end();
    }
  });
});
