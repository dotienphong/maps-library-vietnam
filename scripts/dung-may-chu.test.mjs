import { describe, expect, it } from 'vitest';
import { CONTAINER_POSTGRES, loiDanh, tinhHinhMayChu } from './lib/dung-may-chu.mjs';

describe('tinhHinhMayChu', () => {
  it('container đang chạy → đúng máy', () => {
    expect(tinhHinhMayChu(`${CONTAINER_POSTGRES}\n`, `${CONTAINER_POSTGRES}\n`)).toEqual({
      oDay: true,
      ma: 'dang-chay',
    });
  });

  it('có container nhưng đã tắt → phân biệt được với máy hoàn toàn khác', () => {
    expect(tinhHinhMayChu('', `${CONTAINER_POSTGRES}\n`)).toEqual({
      oDay: false,
      ma: 'co-nhung-da-tat',
    });
  });

  it('không có gì → máy này không phải máy chủ', () => {
    expect(tinhHinhMayChu('', '')).toEqual({ oDay: false, ma: 'khong-phai-may-nay' });
  });

  it('chỉ có khoảng trắng cũng tính là không có — docker in dòng trống khi không khớp', () => {
    expect(tinhHinhMayChu('  \n', '\n').ma).toBe('khong-phai-may-nay');
  });
});

describe('loiDanh', () => {
  it('máy khác: nói rõ lệnh tác động lên máy đang gõ, và cách tự kiểm', () => {
    const ra = loiDanh('khong-phai-may-nay', 'pnpm server:tenant-xoa');
    expect(ra).toContain('pnpm server:tenant-xoa');
    expect(ra).toContain('MÁY ĐANG GÕ LỆNH');
    expect(ra).toContain(`docker ps --filter name=${CONTAINER_POSTGRES}`);
  });

  it('container tắt: đưa lệnh bật lại, và nhắc đừng bật nhầm nếu máy chủ ở nơi khác', () => {
    const ra = loiDanh('co-nhung-da-tat', 'pnpm server:migrate');
    expect(ra).toContain('docker compose');
    expect(ra).toContain('up -d');
    expect(ra).toContain('máy chủ thật nằm ở máy khác');
  });

  it('hai tình huống cho hai thông báo KHÁC nhau', () => {
    expect(loiDanh('co-nhung-da-tat', 'x')).not.toBe(loiDanh('khong-phai-may-nay', 'x'));
  });
});
