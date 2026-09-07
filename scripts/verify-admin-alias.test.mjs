import { describe, expect, it } from 'vitest';
import {
  PRECISION_RANK,
  evaluateCoverage,
  evaluateGeocode,
  isHighPrecision,
} from './verify-admin-alias.mjs';

/**
 * Cổng đếm theo spec 8.3; số relation không đồng nghĩa số đơn vị pháp lý.
 * @type {Record<string, [number, number]>}
 */
const expectedCounts = { L4: [63, 63], L6: [690, 710], L8: [10_000, 10_700] };

/** @param {Partial<Parameters<typeof evaluateCoverage>[0]>} overrides */
const coverageInput = (overrides = {}) => ({
  expectedCounts,
  countsByLevel: { L4: 63, L6: 700, L8: 10_400 },
  distinctUnits: { L4: 63, L6: 700, L8: 10_400 },
  missingMainlandL8: [],
  offshore: [],
  coverage: [{ id: '1', level: 8, rawCoverage: 1, keptCoverage: 1, discardedShare: 0, targets: 1 }],
  aliasCases: [],
  // Mặc định report và DB cùng generation; các test riêng ghi đè để kiểm guard.
  reportOldCount: 54,
  dbOldCount: 54,
  ...overrides,
});

/** @param {Partial<Parameters<typeof evaluateGeocode>[0][number]>} overrides */
const geocodeCase = (overrides = {}) => ({
  caseId: 'hcm-address-01',
  expectedBbox: /** @type {[number, number, number, number]} */ ([106.64, 10.75, 106.68, 10.79]),
  old: { precision: 'rooftop', lat: 10.77, lng: 106.66 },
  fresh: { precision: 'rooftop', lat: 10.77, lng: 106.66 },
  ...overrides,
});

const tenCases = (mutate = (/** @type {number} */ _index) => ({})) =>
  Array.from({ length: 10 }, (_, index) =>
    geocodeCase({ caseId: `case-${index}`, ...mutate(index) }),
  );

describe('evaluateCoverage', () => {
  it('bộ dữ liệu đủ thì không có failure', () => {
    expect(evaluateCoverage(coverageInput()).failures).toEqual([]);
    expect(evaluateCoverage(coverageInput()).ok).toBe(true);
  });

  it('thiếu một L8 đất liền phải fail', () => {
    const result = evaluateCoverage(
      coverageInput({ missingMainlandL8: [{ id: '9001', name: 'Xã Thiếu' }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain('missing_mainland_l8');
  });

  it('normalized share = 1 nhưng raw coverage 0,6 vẫn phải fail', () => {
    const result = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '77',
            level: 8,
            rawCoverage: 0.6,
            keptCoverage: 0.6,
            discardedShare: 0,
            targets: 2,
            normalizedShareSum: 1,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain('raw_coverage_gap');
    // Chuẩn hoá về 1 không được dùng làm bằng chứng che lỗ dữ liệu.
    expect(result.failures.find((f) => f.kind === 'raw_coverage_gap')?.id).toBe('77');
  });

  it('thiếu một đích của ca tách phải fail', () => {
    const result = evaluateCoverage(
      coverageInput({
        aliasCases: [
          {
            caseId: 'hcm-01',
            split: true,
            expectedTargets: ['Sài Gòn', 'Tân Định'],
            actualTargets: ['Sài Gòn'],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const failure = result.failures.find((f) => f.kind === 'split_target_missing');
    expect(failure?.caseId).toBe('hcm-01');
    expect(failure?.missing).toEqual(['Tân Định']);
  });

  it('đích lạ ngoài tập kỳ vọng cũng fail, không chỉ thiếu', () => {
    const result = evaluateCoverage(
      coverageInput({
        aliasCases: [
          {
            caseId: 'hcm-02',
            split: true,
            expectedTargets: ['Sài Gòn', 'Bến Thành'],
            actualTargets: ['Sài Gòn', 'Bến Thành', 'Vùng Lạ'],
          },
        ],
      }),
    );
    expect(result.failures.map((f) => f.kind)).toContain('unexpected_target');
  });

  it('đếm lệch khoảng spec phải fail chứ không cảnh báo', () => {
    const result = evaluateCoverage(
      coverageInput({ countsByLevel: { L4: 33, L6: 700, L8: 10_400 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain('count_out_of_range');
  });

  it('ca đảo/biển không có bằng chứng thì fail', () => {
    const result = evaluateCoverage(
      coverageInput({ offshore: [{ id: '15015331', name: 'Xã Thanh Lân' }] }),
    );
    expect(result.failures.map((f) => f.kind)).toContain('offshore_without_evidence');
    const withEvidence = evaluateCoverage(
      coverageInput({
        offshore: [
          { id: '15015331', name: 'Xã Thanh Lân', evidenceUrl: 'https://example.gov.vn/x' },
        ],
      }),
    );
    expect(withEvidence.failures).toEqual([]);
  });

  it('report lệch generation với DB phải fail, không đánh giá coverage của lần chạy khác', () => {
    const result = evaluateCoverage(coverageInput({ reportOldCount: 4900, dbOldCount: 54 }));
    expect(result.ok).toBe(false);
    const failure = result.failures.find((f) => f.kind === 'report_generation_mismatch');
    expect(failure).toMatchObject({ reportOldCount: 4900, dbOldCount: 54 });
  });

  it('report khớp generation thì không fail', () => {
    expect(
      evaluateCoverage(coverageInput({ reportOldCount: 54, dbOldCount: 54 })).failures,
    ).toEqual([]);
  });

  it('có coverage row nhưng thiếu hẳn report thì fail', () => {
    const result = evaluateCoverage(coverageInput({ reportOldCount: null, dbOldCount: 54 }));
    expect(result.failures.map((f) => f.kind)).toContain('report_missing');
  });

  // 07/09/2026: fixture Task 0 gán sai huyện cho nhiều ca (toàn bộ Đà Nẵng ghi "Quận Hải Châu",
  // Cần Thơ ghi "Ninh Kiều"), trong khi snapshot ODbL nói Hòa Liên thuộc Hòa Vang, Xuân Hà thuộc
  // Thanh Khê. Ground truth sai thì cổng 8.4 vô nghĩa, nên phải chặn bằng failure riêng.
  it('fixture ghi huyện khác snapshot thì fail', () => {
    const result = evaluateCoverage(
      coverageInput({
        fixtureMismatches: [
          {
            caseId: 'dn-01',
            ward: 'hoa lien',
            fixtureDistrict: 'hai chau',
            snapshotDistrict: 'hoa vang',
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const failure = result.failures.find((f) => f.kind === 'fixture_district_mismatch');
    expect(failure).toMatchObject({ caseId: 'dn-01', snapshotDistrict: 'hoa vang' });
  });

  // Đồng Tháp có hai `Xã Tân Phước` (Lai Vung và Tân Hồng). Nếu tra lấy dòng đầu tuỳ ý thì fixture
  // ghi đúng "Tân Hồng" vẫn bị báo lệch — dương tính giả. Phải coi là khớp khi CÓ dòng trùng huyện.
  it('nhiều đơn vị trùng tên trong tỉnh: khớp nếu có dòng trùng huyện', () => {
    const result = evaluateCoverage(
      coverageInput({
        fixtureMismatches: [],
        fixtureAmbiguous: [
          { caseId: 'dt-08', ward: 'tan phuoc', candidates: ['lai vung', 'tan hong'] },
        ],
      }),
    );
    // Mơ hồ không phải lỗi fixture, nhưng vẫn phải nêu để người đọc biết ca nào chưa kết luận được.
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((w) => w.kind)).toContain('fixture_district_ambiguous');
  });

  it('fixture khớp snapshot thì không fail', () => {
    expect(evaluateCoverage(coverageInput({ fixtureMismatches: [] })).failures).toEqual([]);
  });

  it('raw coverage ngoài [0,95;1,05] và sliver bị bỏ là cảnh báo có ghi lại', () => {
    const result = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '5',
            level: 8,
            rawCoverage: 1.03,
            keptCoverage: 0.99,
            discardedShare: 0.04,
            targets: 2,
          },
          { id: '6', level: 8, rawCoverage: 1.2, keptCoverage: 1.2, discardedShare: 0, targets: 1 },
        ],
      }),
    );
    expect(result.warnings.map((w) => w.kind)).toContain('discarded_sliver');
    expect(result.warnings.map((w) => w.kind)).toContain('raw_coverage_outside_band');
  });

  // Quyết định PHONG 07/09/2026 (A): gap ven biển được chấp nhận khi phần KHÔNG được phủ không có
  // dấu hiệu là đất — đo bằng mật độ POI, vì biển không có POI. Mặt nạ L4 không dùng được: L4 hiện
  // hành cũng bao lãnh hải. Bằng chứng: hồ sơ 8-3-decision-prep.
  it('gap ven biển: phần không phủ gần như không có POI thì là cảnh báo, không phải failure', () => {
    const result = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '90',
            level: 8,
            rawCoverage: 0.36,
            keptCoverage: 0.36,
            discardedShare: 0,
            targets: 1,
            uncoveredKm2: 197.7,
            uncoveredPoiDensity: 0.04,
            coveredPoiDensity: 4.2,
          },
        ],
      }),
    );
    expect(result.failures.map((f) => f.kind)).not.toContain('raw_coverage_gap');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'coastal_gap_accepted', id: '90' }),
    );
  });

  it('gap ven biển: mật độ dưới 10% phần được phủ cũng được chấp nhận (vịnh có cầu tàu)', () => {
    const result = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '91',
            level: 8,
            rawCoverage: 0.37,
            keptCoverage: 0.37,
            discardedShare: 0,
            targets: 1,
            uncoveredKm2: 7.2,
            uncoveredPoiDensity: 3.04,
            coveredPoiDensity: 152.92,
          },
        ],
      }),
    );
    expect(result.failures.map((f) => f.kind)).not.toContain('raw_coverage_gap');
    expect(result.warnings.map((w) => w.kind)).toContain('coastal_gap_accepted');
  });

  it('gap có mật độ POI như đất ở thì vẫn phải fail', () => {
    const result = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '92',
            level: 8,
            rawCoverage: 0.5,
            keptCoverage: 0.5,
            discardedShare: 0,
            targets: 1,
            uncoveredKm2: 3,
            uncoveredPoiDensity: 120,
            coveredPoiDensity: 200,
          },
        ],
      }),
    );
    expect(result.failures.map((f) => f.kind)).toContain('raw_coverage_gap');
  });

  it('thiếu số đo POI thì KHÔNG được chấp nhận — không có bằng chứng thì vẫn là failure', () => {
    const result = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '93',
            level: 8,
            rawCoverage: 0.4,
            keptCoverage: 0.4,
            discardedShare: 0,
            targets: 1,
          },
        ],
      }),
    );
    expect(result.failures.map((f) => f.kind)).toContain('raw_coverage_gap');
    expect(result.warnings.map((w) => w.kind)).not.toContain('coastal_gap_accepted');
  });

  // Quyết định PHONG 07/09/2026 (B): 11.064/12.022 cạnh bị bỏ có raw_share < 0,001; cảnh báo từ
  // `> 0` nhặt cả nhiễu 1e-9. Chỉ cảnh báo khi phần bị bỏ đáng kể.
  it('sliver nhỏ hơn 1% không cảnh báo; từ 1% trở lên thì cảnh báo', () => {
    const small = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '94',
            level: 8,
            rawCoverage: 1,
            keptCoverage: 0.996,
            discardedShare: 0.004,
            targets: 1,
          },
        ],
      }),
    );
    expect(small.warnings.map((w) => w.kind)).not.toContain('discarded_sliver');

    const big = evaluateCoverage(
      coverageInput({
        coverage: [
          {
            id: '95',
            level: 8,
            rawCoverage: 1,
            keptCoverage: 0.99,
            discardedShare: 0.01,
            targets: 1,
          },
        ],
      }),
    );
    expect(big.warnings).toContainEqual(
      expect.objectContaining({ kind: 'discarded_sliver', id: '95' }),
    );
  });
});

describe('evaluateGeocode', () => {
  it('10/10 chính xác cao và không kém cặp mới thì đạt', () => {
    const result = evaluateGeocode(tenCases());
    expect(result.ok).toBe(true);
    expect(result.highPrecision).toBe(10);
    expect(result.failures).toEqual([]);
  });

  it('7/10 chính xác cao phải fail', () => {
    const result = evaluateGeocode(
      tenCases((index) =>
        index < 3 ? { old: { precision: 'street', lat: 10.77, lng: 106.66 } } : {},
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.highPrecision).toBe(7);
    expect(result.failures.map((f) => f.kind)).toContain('high_precision_below_threshold');
  });

  it('8/10 nhưng có cặp kém hơn địa chỉ mới vẫn fail', () => {
    const result = evaluateGeocode(
      tenCases((index) =>
        index < 2
          ? { old: { precision: 'street', lat: 10.77, lng: 106.66 } }
          : index === 5
            ? {
                old: { precision: 'interpolated', lat: 10.77, lng: 106.66 },
                fresh: { precision: 'rooftop', lat: 10.77, lng: 106.66 },
              }
            : {},
      ),
    );
    expect(result.highPrecision).toBe(8);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain('worse_than_new');
  });

  it('lỗi HTTP tính là ca trượt, không được bỏ khỏi mẫu', () => {
    const cases = tenCases((index) => (index === 4 ? { old: { error: 'HTTP 502 upstream' } } : {}));
    const result = evaluateGeocode(cases);
    expect(result.total).toBe(10);
    expect(result.highPrecision).toBe(9);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toContain('request_failed');
  });

  it('điểm nằm ngoài expectedBbox thì fail', () => {
    const result = evaluateGeocode(
      tenCases((index) =>
        index === 0 ? { old: { precision: 'rooftop', lat: 21.0, lng: 105.8 } } : {},
      ),
    );
    expect(result.failures.map((f) => f.kind)).toContain('outside_expected_bbox');
  });
});

describe('thang precision', () => {
  it('xếp bậc đúng và nhận diện nhóm chính xác cao', () => {
    expect(PRECISION_RANK.rooftop).toBeGreaterThan(PRECISION_RANK.alley);
    expect(PRECISION_RANK.alley).toBeGreaterThan(PRECISION_RANK.interpolated);
    expect(PRECISION_RANK.interpolated).toBeGreaterThan(PRECISION_RANK.street);
    expect(PRECISION_RANK.district).toBeGreaterThan(PRECISION_RANK.province);
    expect(isHighPrecision('rooftop')).toBe(true);
    expect(isHighPrecision('alley')).toBe(true);
    expect(isHighPrecision('interpolated')).toBe(true);
    expect(isHighPrecision('street')).toBe(false);
    expect(isHighPrecision(undefined)).toBe(false);
  });
});
