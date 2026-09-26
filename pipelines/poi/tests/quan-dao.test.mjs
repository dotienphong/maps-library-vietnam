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
  tenAnToan,
  vungCua,
  vungQuanDao,
} from '../src/lib/quan-dao.mjs';

/** Bộ dữ liệu duyệt thu nhỏ cho test chính sách (dữ liệu thật: data/quan-dao-dao.csv, quan-dao-ta-giu.json). */
const ctx = {
  dao: new Map([
    ['r7434587', { ten: 'Đảo Phú Lâm', tenKhac: '', nuocGiu: 'CN' }],
    ['w332539799', { ten: 'Đảo Song Tử Đông', tenKhac: '', nuocGiu: 'PH' }],
    ['r7910282', { ten: 'Đảo Trường Sa', tenKhac: 'Đảo Trường Sa Lớn', nuocGiu: 'VN' }],
    ['w537200587', { ten: 'Đá Xu Bi', tenKhac: '', nuocGiu: 'CN' }],
    ['w493742720', { ten: 'Đảo Sinh Tồn', tenKhac: '', nuocGiu: 'VN' }],
    ['n2647317689', { ten: 'Sân bay Trường Sa', tenKhac: '', nuocGiu: 'VN' }],
    ['n77', { ten: '', tenKhac: '', nuocGiu: 'VN' }],
    ['n88', { ten: 'Nhà khách Đá Chữ Thập', tenKhac: '', nuocGiu: 'CN' }],
  ]),
  taGiu: [
    { ten: 'Song Tử Tây', lon: 114.331, lat: 11.428, banKinhM: 1500 },
    { ten: 'Sinh Tồn', lon: 114.33, lat: 9.885, banKinhM: 1500 },
    { ten: 'Trường Sa', lon: 111.919, lat: 8.645, banKinhM: 2500 },
  ],
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
    // Lãnh hải 12 hải lý quanh Pulau Mantanani (Sabah, 116,31°E 6,71°N) — không chỉ đất liền.
    ['vùng biển Mantanani (Sabah)', 116.2, 6.7],
    ['vùng biển Balabac (Palawan)', 116.85, 8.2],
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
  it.each([
    'Đảo Song Tử Tây',
    'Hải đăng Đá Lát',
    'Chùa Trường Sa Lớn',
    'Đá Chữ Thập',
    // Chỉ có dấu sắc/huyền (dùng chung với pinyin) nhưng mọi từ là âm tiết tiếng Việt.
    'Chùa Vinh Phúc',
    'Hòn Tháp',
    'UBND Thị trấn Trường Sa (cũ)',
    'Bia chủ quyền của VNCH năm 1956',
    'Trung tâm dịch vụ hậu cần nghề cá đảo Đá Tây A',
    'Nhà tưởng niệm Chủ tịch Hồ Chí Minh',
    'Đảo Bình Nguyên',
  ])(
    '%s là tên Việt',
    (ten) => {
      expect(laTenViet(ten)).toBe(true);
    },
  );

  it.each([
    'Parola Lighthouse',
    'Pag-asa Island',
    // Dấu á/à/é/í/ó/ú dùng chung với pinyin và tiếng Pháp/Tây Ban Nha — không đủ để là tên Việt.
    'Nánshā Qúndǎo',
    'Tàipíng Dǎo',
    'Zhōngyè Dǎo',
    'Récif Discovery',
    'Repúblika ng Pilipinas',
    'Isla Parolá',
    // Có chữ riêng tiếng Việt nhưng lẫn từ nước ngoài.
    'Đảo Pag-asa',
    'Đảo Layang Layang',
    'Southwest Cay Light',
    'Đảo 𠀀',
    'Đảo 豈',
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

  it('đảo nước khác chiếm trong danh sách: CHỈ tag loại đảo + tên — không thành "sân bay" tên Việt', () => {
    const out = chinhSach(
      f('w537200587', 114.081, 10.926, {
        place: 'island',
        natural: 'coastline',
        aeroway: 'aerodrome',
        landuse: 'military',
        name: '渚碧岛',
      }),
      ctx,
    );
    expect(out?.tags).toEqual({
      place: 'island',
      natural: 'coastline',
      name: 'Đá Xu Bi',
      'name:vi': 'Đá Xu Bi',
    });
  });

  it('hàng duyệt cho vùng chỉ có landuse (Sinh Tồn) dựng thành place=island', () => {
    const out = chinhSach(f('w493742720', 114.33, 9.885, { landuse: 'residential' }), ctx);
    expect(out?.tags).toEqual({ place: 'island', name: 'Đảo Sinh Tồn', 'name:vi': 'Đảo Sinh Tồn' });
  });

  it('hàng duyệt tên rỗng = loại trừ', () => {
    expect(
      chinhSach(f('n77', 114.331, 11.428, { amenity: 'school', name: 'Trường Song Tử Tây' }), ctx),
    ).toBeNull();
  });

  it('cơ sở do quân đội vận hành: loại, trừ khi được duyệt đích danh trên đảo ta giữ', () => {
    const tags = {
      aeroway: 'aerodrome',
      operator: "People's Army of Vietnam",
      name: 'Sân bay Trường Sa',
    };
    expect(chinhSach(f('n5', 111.92, 8.646, tags), ctx)).toBeNull();
    expect(chinhSach(f('n2647317689', 111.92, 8.646, tags), ctx)?.tags).toEqual({
      aeroway: 'aerodrome',
      name: 'Sân bay Trường Sa',
      'name:vi': 'Sân bay Trường Sa',
    });
  });

  it('cơ sở được duyệt nhưng thuộc nước khác chiếm: loại', () => {
    expect(
      chinhSach(f('n88', 112.89, 9.55, { tourism: 'hotel', name: '永暑宾馆' }), ctx),
    ).toBeNull();
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
  const anhChup = JSON.parse(readFileSync(QUAN_DAO_OSM, 'utf8')).doi_tuong;
  const dao = docDao();
  const taGiu = docTaGiu();
  const ctxThat = { dao, taGiu };
  // Kiểm ĐÚNG thứ được nạp (dongQuanDao đọc lại CSV hiện hành), không chỉ file ảnh chụp: sửa riêng CSV
  // (thêm ten_khac "Pag-asa Island") mà không dựng lại ảnh chụp vẫn phải đỏ.
  const napVao = [...dongQuanDao('kiem', anhChup, ctxThat)].map((r) => {
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(String(r[5]));
    return {
      key: `${r[0]}${r[1]}`,
      lon: Number(m?.[1]),
      lat: Number(m?.[2]),
      tags: /** @type {Record<string, string>} */ (JSON.parse(String(r[4]))),
    };
  });
  const qa = JSON.parse(readFileSync('pipelines/tiles/qa.config.json', 'utf8'));
  /** Bỏ dấu, đ→d, chữ thường: "Nánshā" và "Vĩnh Hưng" khớp từ cấm viết không dấu. @param {string} s */
  const gap = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
  // Từ cấm của QA tiles + tên/phiên âm nước ngoài hay gặp ở hai quần đảo; so NGUYÊN TỪ sau khi bỏ dấu.
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
    'Vĩnh Hưng',
    'Nam Sa',
    'Tây Sa',
    'Trung Sa',
    'Trung Quốc',
    'Trung Hoa',
  ].map((w) => new RegExp(`\\b${gap(w).replace(/[-]/g, '\\-')}\\b`));
  const coTuCam = (/** @type {string} */ v) => TU_CAM.some((re) => re.test(gap(v)));
  const toaDo = new Map(anhChup.map((d) => [`${d.osm_type}${d.osm_id}`, d]));

  it('ảnh chụp có cả hai quần đảo, và chạy lại chính sách lên nó ra y hệt (CSV không trôi khỏi ảnh chụp)', () => {
    expect(anhChup.filter((d) => vungCua(d.lon, d.lat) === 'hoang_sa').length).toBeGreaterThan(0);
    expect(anhChup.filter((d) => vungCua(d.lon, d.lat) === 'truong_sa').length).toBeGreaterThan(0);
    const troi = anhChup.filter((d) => {
      const out = chinhSach(
        { osmType: d.osm_type, osmId: d.osm_id, lon: d.lon, lat: d.lat, tags: d.tags },
        ctxThat,
      );
      return JSON.stringify(out?.tags) !== JSON.stringify(d.tags);
    });
    expect(troi.map((d) => `${d.osm_type}${d.osm_id}`)).toEqual([]);
    expect(napVao).toHaveLength(anhChup.length);
  });

  it('mọi dòng nạp: trong vùng, name = name:vi, tên Việt (cơ sở) / tên an toàn (hàng duyệt), không chữ Hán hay từ cấm ở BẤT KỲ tag nào, không quân sự', () => {
    const sai = napVao.filter((d) => {
      const giaTri = Object.values(d.tags);
      const tenHopLe = dao.has(d.key)
        ? tenAnToan(d.tags.name) && (!d.tags.alt_name || tenAnToan(d.tags.alt_name))
        : laTenViet(d.tags.name);
      return (
        !vungCua(d.lon, d.lat) ||
        d.tags.name !== d.tags['name:vi'] ||
        !tenHopLe ||
        giaTri.some((v) => CJK.test(v) || coTuCam(v)) ||
        d.tags.military !== undefined ||
        d.tags.landuse === 'military'
      );
    });
    expect(sai.map((d) => `${d.key} ${d.tags.name}`)).toEqual([]);
  });

  it('Hoàng Sa và đảo nước khác chiếm: chỉ tag loại đảo + tên; cơ sở Trường Sa nằm trong vòng ta giữ', () => {
    const TAG_DAO = new Set(['place', 'natural', 'name', 'name:vi', 'alt_name']);
    const sai = napVao.filter((d) => {
      const duyet = dao.get(d.key);
      const trongVong = taGiu.some((c) => khoangCachM(d.lon, d.lat, c.lon, c.lat) <= c.banKinhM);
      if (vungCua(d.lon, d.lat) === 'hoang_sa' || (duyet && duyet.nuocGiu !== 'VN')) {
        return !duyet || Object.keys(d.tags).some((k) => !TAG_DAO.has(k));
      }
      return !trongVong;
    });
    expect(sai.map((d) => `${d.key} ${JSON.stringify(d.tags)}`)).toEqual([]);
  });

  it('mọi hàng duyệt (trừ hàng loại trừ) có mặt trong ảnh chụp (không lặng lẽ mất một hòn đảo)', () => {
    expect([...dao].filter(([k, v]) => v.ten && !toaDo.has(k)).map(([k]) => k)).toEqual([]);
  });

  it('danh sách duyệt: ten/ten_khac an toàn, không từ cấm; nước giữ hợp lệ; Hoàng Sa ghi CN; VN nằm trong vòng ta giữ', () => {
    const sai = [...dao].filter(([k, v]) => {
      if (!['VN', 'CN', 'PH', 'TW', 'MY'].includes(v.nuocGiu)) return true;
      if (!v.ten) return false;
      if (!tenAnToan(v.ten) || coTuCam(v.ten)) return true;
      if (v.tenKhac && (!tenAnToan(v.tenKhac) || coTuCam(v.tenKhac))) return true;
      const d = toaDo.get(k);
      if (!d) return true;
      if (vungCua(d.lon, d.lat) === 'hoang_sa') return v.nuocGiu !== 'CN';
      const trongVong = taGiu.some((c) => khoangCachM(d.lon, d.lat, c.lon, c.lat) <= c.banKinhM);
      return (v.nuocGiu === 'VN') !== trongVong;
    });
    expect(sai.map(([k]) => k)).toEqual([]);
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
    // records.mjs đọc tên và tên khác từ cột tags — phải là tag đã qua chính sách, không phải tag gốc.
    expect(JSON.parse(String(row?.[4]))).toEqual({
      place: 'island',
      name: 'Đảo Phú Lâm',
      'name:vi': 'Đảo Phú Lâm',
    });
    expect(row?.[5]).toBe('SRID=4326;POINT(112.341 16.834)');
    expect(row?.[6]).toBe('2026-09-26');
  });
});
