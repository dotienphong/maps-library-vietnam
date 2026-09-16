import { describe, expect, it } from 'vitest';
import { bangLa, CONFIRM_PHRASE, parseResetArgs } from './db-tenant-reset.mjs';

describe('cổng an toàn của db-tenant-reset', () => {
  it('mặc định là dry-run: có --name thôi thì KHÔNG xoá gì', () => {
    expect(parseResetArgs(['--name', 'Phong_Admin'])).toEqual({
      name: 'Phong_Admin',
      plan: 'free',
      apply: false,
    });
  });

  it('--apply mà thiếu chuỗi xác nhận → ném, không chạy', () => {
    // Hai cổng chứ không một: --apply lặp lại từ lịch sử shell là chuyện có thật.
    expect(() => parseResetArgs(['--name', 'X', '--apply'])).toThrow(/--confirm/);
    expect(() => parseResetArgs(['--name', 'X', '--apply', '--confirm', 'xoa'])).toThrow(
      /--confirm/,
    );
  });

  it('đủ hai cổng → apply = true', () => {
    expect(
      parseResetArgs(['--name', 'Phong_Admin', '--apply', '--confirm', CONFIRM_PHRASE]).apply,
    ).toBe(true);
  });

  it('thiếu tên, hoặc --name nuốt mất cờ kế tiếp → ném', () => {
    expect(() => parseResetArgs([])).toThrow(/--name/);
    expect(() => parseResetArgs(['--name', '--apply'])).toThrow(/--name/);
  });

  it('plan phải nằm trong ba giá trị DB chấp nhận', () => {
    expect(parseResetArgs(['--name', 'X', '--plan', 'internal']).plan).toBe('internal');
    expect(() => parseResetArgs(['--name', 'X', '--plan', 'vip'])).toThrow(/internal\|free\|paid/);
  });

  it('bảng lạ có khoá ngoại tới tenant → bị nêu tên để script dừng', () => {
    // Thêm quan hệ mới vào schema mà quên sửa script: xoá tiếp sẽ hoặc vỡ vì khoá ngoại, hoặc
    // để lại dữ liệu mồ côi. Bài này khoá lại hành vi "dừng thay vì đoán".
    expect(bangLa([{ table_name: 'api_key' }, { table_name: 'poi_edit' }])).toEqual([]);
    expect(bangLa([{ table_name: 'api_key' }, { table_name: 'hoa_don' }])).toEqual(['hoa_don']);
  });
});
