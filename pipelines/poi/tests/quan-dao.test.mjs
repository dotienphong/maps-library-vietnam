import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUAN_DAO_OSM } from '../src/lib/env.mjs';
import {
  CJK,
  chinhSach,
  docDao,
  docTaGiu,
  dongQuanDao,
  khoangCachM,
  laTenViet,
  vungCua,
  vungQuanDao,
} from '../src/lib/quan-dao.mjs';

/** Bộ dữ liệu duyệt thu nhỏ cho test chính sách (dữ liệu thật: data/quan-dao-dao.csv, quan-dao-ta-giu.json). */
const ctx = {
  dao: new Map([
    ['r7434587', { ten: 'Đảo Phú Lâm', tenKhac: '', nuocGiu: 'CN' }],
    ['w332539799', { ten: 'Đảo Song Tử Đông', tenKhac: '', nuocGiu: 'PH' }],
    ['r7910282', { ten: 'Đảo Trường Sa', tenKhac: 'Đảo Trường Sa Lớn', nuocGiu: 'VN' }],
  ]),
  taGiu: [{ ten: 'Song Tử Tây', lon: 114.331, lat: 11.428, banKinhM: 1500 }],
};

describe('vungCua — vùng hai quần đảo (PHONG chốt 26/09/2026)', () => {
  it.each([
    ['Song Tử Tây', 114.331, 11.429, 'truong_sa'],
    ['Trường Sa Lớn', 111.92, 8.645, 'truong_sa'],
    ['An Bang', 112.921, 7.892, 'truong_sa'],
    ['Hoa Lau (nước khác giữ, vẫn là Trường Sa)', 113.821, 7.375, 'truong_sa'],
    ['Vành Khăn', 115.539, 9.916, 'truong_sa'],
    ['Phú Lâm', 112.341, 16.834, 'hoang_sa'],
    ['Tri Tôn', 111.203, 15.785, 'hoang_sa'],
    ['Linh Côn', 112.73, 16.667, 'hoang_sa'],
  ])('%s nằm trong vùng', (_ten, lon, lat, vung) => {
    expect(vungCua(lon, lat)).toBe(vung);
  });

  // Đa giác Trường Sa khoét đất Sabah/Palawan: dùng thẳng bbox của patch tiles thì reverse geocode
  // và poi-admin sẽ gắn "Đặc khu Trường Sa, Khánh Hòa" cho đất Malaysia/Philippines.
  it.each([
    ['Kudat (Sabah)', 116.85, 6.88],
    ['Kota Belud (Sabah)', 116.43, 6.35],
    ['Banggi (Sabah)', 117.1, 7.25],
    ['Balabac (Palawan)', 117.05, 7.98],
    ['Quezon (Palawan)', 117.99, 9.23],
    ['Sanya (Hải Nam)', 109.5, 18.25],
    ['Lý Sơn (đảo ven bờ, không thuộc hai quần đảo)', 109.12, 15.38],
    ['Hà Nội', 105.85, 21.03],
  ])('%s nằm ngoài', (_ten, lon, lat) => {
    expect(vungCua(lon, lat)).toBeNull();
  });

  it('mỗi vùng mang tên đặc khu và tỉnh để dựng admin_area', () => {
    expect(vungQuanDao().map((v) => [v.region, v.ten, v.tinh])).toEqual([
      ['hoang_sa', 'Đặc khu Hoàng Sa', 'Đà Nẵng'],
      ['truong_sa', 'Đặc khu Trường Sa', 'Khánh Hòa'],
    ]);
  });
});

describe('laTenViet — tên tiếng Việt, không chữ Hán, không tên Latin nước ngoài', () => {
  it.each(['Đảo Song Tử Tây', 'Hải đăng Đá Lát', 'Chùa Trường Sa Lớn', 'Đá Chữ Thập'])(
    '%s là tên Việt',
    (ten) => {
      expect(laTenViet(ten)).toBe(true);
    },
  );

  it.each([
    'Parola Lighthouse',
    'Pag-asa Island',
    // Không dấu thì không phân biệt được với tên Latin nước ngoài → không nhận, trừ khi có name:vi.
    'An Bang',
    '永兴岛',
    'Đảo 永兴',
    '',
  ])('%s không phải tên Việt', (ten) => {
    expect(laTenViet(ten)).toBe(false);
  });
});

describe('chinhSach — nhận/loại đối tượng OSM trong hai quần đảo', () => {
  /** @param {string} key @param {number} lon @param {number} lat @param {Record<string, string>} tags */
  const f = (key, lon, lat, tags) => ({ osmType: key[0], osmId: key.slice(1), lon, lat, tags });

  it('đảo có trong danh sách duyệt: nhận, tên Việt ghi đè, bỏ mọi tên khác (chữ Hán, phiên âm, tiếng Anh)', () => {
    const out = chinhSach(
      f('r7434587', 112.341, 16.834, {
        place: 'island',
        name: '永兴岛',
        'name:vi': 'Đảo Vĩnh Hưng',
        'name:en': 'Woody Island',
        'name:zh': '永兴岛',
        alt_name: 'Yongxing Dao',
      }),
      ctx,
    );
    expect(out?.tags).toEqual({ place: 'island', name: 'Đảo Phú Lâm', 'name:vi': 'Đảo Phú Lâm' });
  });

  it('tên khác trong danh sách duyệt đi vào alt_name để tìm được', () => {
    const out = chinhSach(
      f('r7910282', 111.92, 8.645, { place: 'island', name: 'Đảo Trường Sa' }),
      ctx,
    );
    expect(out?.tags.alt_name).toBe('Đảo Trường Sa Lớn');
  });

  it('đảo nước khác giữ có trong danh sách: chỉ tên Việt ("Parola Island" → "Đảo Song Tử Đông")', () => {
    const out = chinhSach(
      f('w332539799', 114.355, 11.453, {
        place: 'islet',
        name: 'Parola Island',
        note: 'administered by the Philippines',
      }),
      ctx,
    );
    expect(out?.tags.name).toBe('Đảo Song Tử Đông');
  });

  it('chỉ giữ tag pipeline dùng — note/is_in/operator/inscription có thể mang tên hoặc chủ thể nước ngoài', () => {
    const out = chinhSach(
      f('w332539799', 114.355, 11.453, {
        place: 'islet',
        name: 'Parola Island',
        note: 'administered by the Philippines',
        'is_in:country': 'Philippines',
        operator: 'Philippine Coast Guard',
        inscription: '中华人民共和国',
      }),
      ctx,
    );
    expect(out?.tags).toEqual({
      place: 'islet',
      name: 'Đảo Song Tử Đông',
      'name:vi': 'Đảo Song Tử Đông',
    });
  });

  it('đảo trong danh sách duyệt mang tag căn cứ của nước chiếm giữ: vẫn nhận TÊN ĐẢO, bỏ tag quân sự', () => {
    // Đá Xu Bi (w537200587) và Đá Công Đo (w512656633) gắn landuse=military/military=base — luật quân sự
    // (Luật Đo đạc 2018) nhắm vào cơ sở, không nhắm vào tên hòn đảo; để tag đó lại thì records.mjs loại.
    const out = chinhSach(
      f('w332539799', 114.355, 11.453, {
        place: 'islet',
        name: 'Parola Island',
        landuse: 'military',
        military: 'base',
      }),
      ctx,
    );
    expect(out?.tags).toEqual({
      place: 'islet',
      name: 'Đảo Song Tử Đông',
      'name:vi': 'Đảo Song Tử Đông',
    });
  });

  it('đảo KHÔNG có trong danh sách duyệt: loại, kể cả khi có name:vi', () => {
    expect(
      chinhSach(f('w50548011', 111.686, 16.566, { place: 'islet', 'name:vi': 'Đảo Ba Ba' }), ctx),
    ).toBeNull();
  });

  it('Hoàng Sa: không nhận cơ sở nào, kể cả có name:vi', () => {
    expect(
      chinhSach(
        f('n1', 112.34, 16.83, {
          amenity: 'townhall',
          'name:vi': 'Tòa Thị chính Thành phố Tam Sa',
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it('cơ sở trong vòng ta giữ với tên tiếng Việt: nhận (tên gốc giữ lại dù thiếu name:vi)', () => {
    const out = chinhSach(
      f('w701336130', 114.331, 11.4285, { amenity: 'place_of_worship', name: 'Chùa Song Tử Tây' }),
      ctx,
    );
    expect(out?.tags).toEqual({
      amenity: 'place_of_worship',
      name: 'Chùa Song Tử Tây',
      'name:vi': 'Chùa Song Tử Tây',
    });
  });

  it.each([
    ['không tên', { amenity: 'ferry_terminal' }],
    ['tên Latin nước ngoài', { man_made: 'lighthouse', name: 'Southwest Cay Light' }],
    ['tên chữ Hán', { amenity: 'place_of_worship', name: '南子岛庙' }],
    [
      'gắn military (Luật Đo đạc 2018)',
      { amenity: 'school', name: 'Trường Song Tử Tây', military: 'barracks' },
    ],
  ])('cơ sở trong vòng ta giữ nhưng %s: loại', (_ly_do, tags) => {
    expect(chinhSach(f('n2', 114.331, 11.428, tags), ctx)).toBeNull();
  });

  it('vùng chỉ có landuse (vd landuse=residential "Đảo Nam Yết"): loại — trùng tên với chính hòn đảo', () => {
    expect(
      chinhSach(f('w5', 114.331, 11.428, { landuse: 'residential', name: 'Đảo Song Tử Tây' }), ctx),
    ).toBeNull();
  });

  it('cơ sở ngoài vòng ta giữ (đá nước khác chiếm) với name:vi phiên âm: loại', () => {
    expect(
      chinhSach(
        f('w3', 112.89, 9.55, { aeroway: 'aerodrome', 'name:vi': 'Sân bay Đá Vĩnh Thử' }),
        ctx,
      ),
    ).toBeNull();
  });

  it('ngoài hai vùng: không phải việc của chính sách này', () => {
    expect(chinhSach(f('n4', 105.85, 21.03, { amenity: 'cafe', name: 'Cà phê' }), ctx)).toBeNull();
  });
});

describe('dữ liệu commit — CI chặn mọi thứ trái chính sách trước khi lên production', () => {
  /** @type {{ osm_type: string, osm_id: string, lon: number, lat: number, tags: Record<string, string> }[]} */
  const doiTuong = JSON.parse(readFileSync(QUAN_DAO_OSM, 'utf8')).doi_tuong;
  const dao = docDao();
  const taGiu = docTaGiu();
  const qa = JSON.parse(readFileSync('pipelines/tiles/qa.config.json', 'utf8'));
  // Từ cấm của QA tiles + tên nước ngoài hay gặp ở hai quần đảo (Tam Sa, Vĩnh Hưng, Pag-asa, Parola…).
  const TU_CAM = [
    ...qa.forbiddenWords,
    'Sansha',
    'Yongxing',
    'Pag-asa',
    'Pagasa',
    'Kalayaan',
    'Parola',
    'Taiping',
    'Layang',
    'Tam Sa',
    'Trung Quốc',
    'Trung Hoa',
  ].map((w) => w.toLowerCase());
  const toaDo = new Map(doiTuong.map((d) => [`${d.osm_type}${d.osm_id}`, d]));

  it('ảnh chụp có cả hai quần đảo', () => {
    expect(doiTuong.filter((d) => vungCua(d.lon, d.lat) === 'hoang_sa').length).toBeGreaterThan(0);
    expect(doiTuong.filter((d) => vungCua(d.lon, d.lat) === 'truong_sa').length).toBeGreaterThan(0);
  });

  it('mọi đối tượng: trong vùng, tên tiếng Việt, không chữ Hán/từ cấm ở BẤT KỲ tag nào, không quân sự', () => {
    const sai = doiTuong.filter((d) => {
      const giaTri = Object.values(d.tags);
      return (
        !vungCua(d.lon, d.lat) ||
        d.tags.name !== d.tags['name:vi'] ||
        !laTenViet(d.tags.name) ||
        giaTri.some((v) => CJK.test(v) || TU_CAM.some((w) => v.toLowerCase().includes(w))) ||
        d.tags.military !== undefined ||
        d.tags.landuse === 'military'
      );
    });
    expect(sai).toEqual([]);
  });

  it('Hoàng Sa chỉ có đảo/bãi trong danh sách duyệt; cơ sở Trường Sa nằm trong vòng ta giữ', () => {
    const sai = doiTuong.filter((d) => {
      if (dao.has(`${d.osm_type}${d.osm_id}`)) return false;
      if (vungCua(d.lon, d.lat) === 'hoang_sa') return true;
      return !taGiu.some((c) => khoangCachM(d.lon, d.lat, c.lon, c.lat) <= c.banKinhM);
    });
    expect(sai).toEqual([]);
  });

  it('mọi hàng trong danh sách duyệt có mặt trong ảnh chụp (không lặng lẽ mất một hòn đảo)', () => {
    expect([...dao.keys()].filter((k) => !toaDo.has(k))).toEqual([]);
  });

  it('danh sách duyệt: tên Việt, nước giữ hợp lệ, Hoàng Sa ghi CN, đảo ta giữ nằm trong vòng ta giữ', () => {
    const sai = [...dao].filter(([k, v]) => {
      const d = toaDo.get(k);
      if (!d || !laTenViet(v.ten) || !['VN', 'CN', 'PH', 'TW', 'MY'].includes(v.nuocGiu))
        return true;
      if (vungCua(d.lon, d.lat) === 'hoang_sa') return v.nuocGiu !== 'CN';
      const trongVongTaGiu = taGiu.some(
        (c) => khoangCachM(d.lon, d.lat, c.lon, c.lat) <= c.banKinhM,
      );
      return (v.nuocGiu === 'VN') !== trongVongTaGiu;
    });
    expect(sai).toEqual([]);
  });

  it('mỗi vòng ta giữ cách mọi đảo/đá nước khác chiếm ≥ bán kính + 2 km (Song Tử Tây–Song Tử Đông 3,5 km)', () => {
    const sai = [];
    for (const [k, v] of dao) {
      const d = toaDo.get(k);
      if (!d || v.nuocGiu === 'VN') continue;
      for (const c of taGiu) {
        const m = khoangCachM(d.lon, d.lat, c.lon, c.lat);
        if (m < c.banKinhM + 2000) sai.push(`${v.ten} cách vòng ${c.ten} ${Math.round(m)} m`);
      }
    }
    expect(sai).toEqual([]);
  });
});

describe('dongQuanDao — dòng COPY vào src_osm_place (cùng cột với rows() của ingest/osm.mjs)', () => {
  it('ra đúng cột, names chỉ gồm name/name:vi, chạy lại chính sách (phòng thủ nếu ảnh chụp bị sửa tay)', () => {
    const rows = [
      ...dongQuanDao(
        '2026-09-26',
        [
          {
            osm_type: 'r',
            osm_id: '7434587',
            lon: 112.341,
            lat: 16.834,
            tags: { place: 'island', name: '永兴岛' },
          },
          {
            osm_type: 'n',
            osm_id: '9',
            lon: 112.34,
            lat: 16.83,
            tags: { amenity: 'bank', name: 'Bank of China' },
          },
        ],
        ctx,
      ),
    ];
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.slice(0, 3)).toEqual(['r', '7434587', 'Đảo Phú Lâm']);
    expect(JSON.parse(String(row?.[3]))).toEqual({ name: 'Đảo Phú Lâm', 'name:vi': 'Đảo Phú Lâm' });
    expect(row?.[5]).toBe('SRID=4326;POINT(112.341 16.834)');
    expect(row?.[6]).toBe('2026-09-26');
  });
});
