// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MaQr } from './ma-qr';

describe('MaQr', () => {
  it('vẽ ảnh QR dạng data URL từ chuỗi VietQR, có nhãn cho trình đọc màn hình', () => {
    render(
      <MaQr noiDung="00020101021238570010A000000727012700069704220113001234567890208QRIBFTTA5303704" />,
    );
    const anh = screen.getByRole('img', { name: /Mã QR/ });
    expect(anh.getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
  });
});
