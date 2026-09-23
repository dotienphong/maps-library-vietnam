import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DANG_KHOA, docBienEnv, quyetDinhChen } from './inject-demo-key.mjs';

const KHOA = 'mlv_live_abcdefghijklmnopqrstuvwx';

/** @param {string} noiDung */
const envTam = (noiDung) => {
  const duong = join(mkdtempSync(join(tmpdir(), 'mlv-env-')), '.env');
  writeFileSync(duong, noiDung);
  return duong;
};

describe('docBienEnv', () => {
  it('đọc giá trị trần', () => {
    expect(
      docBienEnv(envTam(`PUBLIC_MAPSLIBVN_DEMO_KEY=${KHOA}\n`), 'PUBLIC_MAPSLIBVN_DEMO_KEY'),
    ).toBe(KHOA);
  });

  it('bóc nháy đơn và nháy kép — dotenv cũng bóc, hai bên phải hiểu giống nhau', () => {
    // Đây là ca có thật: khoá dán vào .env kèm nháy, Astro bóc nên trang React chạy, còn script
    // này đọc thô thì nhận chuỗi 35 ký tự và chặn build vì "sai định dạng".
    expect(docBienEnv(envTam(`K='${KHOA}'\n`), 'K')).toBe(KHOA);
    expect(docBienEnv(envTam(`K="${KHOA}"\n`), 'K')).toBe(KHOA);
  });

  it('bỏ qua dòng chú thích và biến có tên là tiền tố của tên cần tìm', () => {
    const duong = envTam(`# K=sai\nK_KHAC=nham\nK=${KHOA}\n`);
    expect(docBienEnv(duong, 'K')).toBe(KHOA);
  });

  it('không có biến, hoặc không có file → chuỗi rỗng, không ném', () => {
    expect(docBienEnv(envTam('KHAC=1\n'), 'K')).toBe('');
    expect(docBienEnv('/khong/ton/tai/.env', 'K')).toBe('');
  });

  it('mẫu khoá chỉ nhận đúng 24 ký tự sau tiền tố', () => {
    expect(DANG_KHOA.test(KHOA)).toBe(true);
    expect(DANG_KHOA.test(`'${KHOA}'`)).toBe(false);
    expect(DANG_KHOA.test('mlv_live_ngan')).toBe(false);
  });
});

describe('quyetDinhChen', () => {
  it('có file đích, khoá đúng định dạng → chèn, ở máy dev lẫn CI', () => {
    expect(quyetDinhChen({ key: KHOA, coFileDich: true, laCI: false })).toBe('chen');
    expect(quyetDinhChen({ key: KHOA, coFileDich: true, laCI: true })).toBe('chen');
  });

  it('máy dev thiếu khoá hoặc thiếu file → chỉ cảnh báo, build vẫn xanh', () => {
    expect(quyetDinhChen({ key: '', coFileDich: true, laCI: false })).toBe('thieu-khoa-canh-bao');
    expect(quyetDinhChen({ key: KHOA, coFileDich: false, laCI: false })).toBe(
      'thieu-file-canh-bao',
    );
  });

  it('CI thiếu khoá hoặc thiếu file → lỗi, không được deploy bản playground trống khoá', () => {
    // Sự cố lặp lại nhiều lần tới 23/09/2026: workflow Deploy Docs không truyền secret nên bản CI
    // luôn thiếu khoá, playground production trả 401 cho tới khi có người deploy tay đè.
    expect(quyetDinhChen({ key: '', coFileDich: true, laCI: true })).toBe('thieu-khoa-loi');
    expect(quyetDinhChen({ key: KHOA, coFileDich: false, laCI: true })).toBe('thieu-file-loi');
  });

  it('khoá sai định dạng → lỗi ở mọi nơi', () => {
    expect(quyetDinhChen({ key: 'mlv_live_ngan', coFileDich: true, laCI: false })).toBe(
      'sai-dinh-dang',
    );
    expect(quyetDinhChen({ key: 'mlv_live_ngan', coFileDich: true, laCI: true })).toBe(
      'sai-dinh-dang',
    );
  });
});
