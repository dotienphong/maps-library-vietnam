// @vitest-environment jsdom

import { DOCS } from '@mapslibvn/catalog';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KhoaMotLan } from './khoa-mot-lan';

const KHOA = 'mlv_live_ABCDEFGHIJKLMNOPQRSTUVWX';
const BASE = 'https://api.ai-solutions.io.vn';

const ve = () => render(<KhoaMotLan khoa={KHOA} apiBase={BASE} />);

describe('KhoaMotLan', () => {
  it('hiện khoá và nói rõ nó chỉ xuất hiện một lần', () => {
    ve();
    expect(screen.getByTestId('khoa-mot-lan')).toHaveTextContent(KHOA);
    expect(screen.getByText(/một lần/)).toBeInTheDocument();
  });

  it('lệnh thử đặt khoá trong header X-Api-Key, KHÔNG trên URL', () => {
    ve();
    const lenh = screen.getByText(/curl/).textContent ?? '';
    expect(lenh).toContain(`X-Api-Key: ${KHOA}`);
    // Khoá trên URL lọt vào log máy chủ, header Referer và bộ nhớ đệm trung gian. Nếu ai đó đổi
    // ví dụ này sang `?key=`, bài kiểm phải đỏ.
    expect(lenh).not.toContain(`key=${KHOA}`);
    expect(lenh).toContain(BASE);
  });

  it('đoạn mã nhúng dùng đúng khoá và đúng địa chỉ máy chủ của phiên hiện tại', () => {
    ve();
    const ma = screen.getByText(/createMap/).textContent ?? '';
    expect(ma).toContain(`apiKey: '${KHOA}'`);
    expect(ma).toContain(`apiBase: '${BASE}'`);
  });

  it('có đủ ba bước, theo thứ tự thử trước rồi mới cài', () => {
    ve();
    const buoc = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(buoc).toHaveLength(3);
    expect(buoc[0]).toMatch(/Thử ngay/);
    expect(buoc[1]).toMatch(/Cài thư viện/);
    expect(buoc[2]).toMatch(/bản đồ đầu tiên/);
  });

  it('dẫn sang tài liệu, mở tab mới và có rel an toàn', () => {
    ve();
    const batDau = screen.getByRole('link', { name: /5 phút/ });
    expect(batDau).toHaveAttribute('href', DOCS.batDau);
    expect(batDau).toHaveAttribute('target', '_blank');
    // Thiếu `noreferrer` thì trang đích đọc được `window.opener`.
    expect(batDau).toHaveAttribute('rel', 'noreferrer');

    expect(screen.getByRole('link', { name: /khoá API/i })).toHaveAttribute('href', DOCS.khoaApi);
  });

  it('mọi link tài liệu trỏ về đúng tên miền docs', () => {
    ve();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/mapslibvn-docs\.pages\.dev\//);
    }
  });
});
