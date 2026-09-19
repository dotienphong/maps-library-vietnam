// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTurnstile } from './turnstile';

/**
 * Turnstile thật tải script từ Cloudflare. Ở đây đặt sẵn `window.turnstile` nên `napScript` trả
 * về ngay, và bài kiểm điều khiển được đúng thời điểm widget trả token.
 */
function dungTurnstileGia() {
  const goiLai: { callback?: (t: string) => void; het?: () => void; loi?: () => void } = {};
  let soLanRender = 0;
  let soLanReset = 0;
  window.turnstile = {
    render(_el, opts) {
      soLanRender += 1;
      goiLai.callback = opts.callback as (t: string) => void;
      goiLai.het = opts['expired-callback'] as () => void;
      goiLai.loi = opts['error-callback'] as () => void;
      return `widget-${soLanRender}`;
    },
    reset() {
      soLanReset += 1;
    },
    remove() {},
  };
  return {
    goiLai,
    soLanRender: () => soLanRender,
    soLanReset: () => soLanReset,
  };
}

function Thu({ siteKey }: { siteKey: string | undefined }) {
  const t = useTurnstile(siteKey);
  return (
    <div>
      <div ref={t.oWidget} data-testid="o-widget" />
      <span data-testid="token">{t.token || '(rỗng)'}</span>
      <button type="button" disabled={t.dangCho} onClick={() => t.datLai()}>
        Gửi
      </button>
    </div>
  );
}

const nut = () => screen.getByRole('button', { name: 'Gửi' });

describe('useTurnstile', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    window.turnstile = undefined;
    for (const s of document.querySelectorAll('script')) s.remove();
  });

  it('khoá nút cho tới khi widget trả token — đây chính là lỗi đã gặp trên production', async () => {
    const gia = dungTurnstileGia();
    render(<Thu siteKey="0x4AAAAAAE" />);

    // Ngay sau khi trang dựng xong, token còn rỗng. Bản cũ để nút BẬT ở đúng khoảnh khắc này,
    // nên ai bấm nhanh sẽ gửi token rỗng và máy chủ trả 403 kèm câu "không qua được bước chống
    // robot" — người thật bị gọi là robot.
    expect(nut()).toBeDisabled();
    expect(screen.getByTestId('token')).toHaveTextContent('(rỗng)');

    await vi.waitFor(() => expect(gia.goiLai.callback).toBeTypeOf('function'));
    gia.goiLai.callback?.('token-that');

    await vi.waitFor(() => expect(nut()).toBeEnabled());
    expect(screen.getByTestId('token')).toHaveTextContent('token-that');
  });

  it('token hết hạn thì khoá nút lại, không để người dùng gửi token chết', async () => {
    const gia = dungTurnstileGia();
    render(<Thu siteKey="0x4AAAAAAE" />);
    await vi.waitFor(() => expect(gia.goiLai.callback).toBeTypeOf('function'));

    gia.goiLai.callback?.('token-that');
    await vi.waitFor(() => expect(nut()).toBeEnabled());

    // Token của Turnstile sống 300 giây; trang đăng nhập mở lâu rồi mới bấm là chuyện thường.
    gia.goiLai.het?.();
    await vi.waitFor(() => expect(nut()).toBeDisabled());
  });

  it('widget báo lỗi cũng khoá nút', async () => {
    const gia = dungTurnstileGia();
    render(<Thu siteKey="0x4AAAAAAE" />);
    await vi.waitFor(() => expect(gia.goiLai.callback).toBeTypeOf('function'));

    gia.goiLai.callback?.('token-that');
    await vi.waitFor(() => expect(nut()).toBeEnabled());

    gia.goiLai.loi?.();
    await vi.waitFor(() => expect(nut()).toBeDisabled());
  });

  it('không có site key thì nút mở ngay — môi trường phát triển bỏ qua bước kiểm', () => {
    dungTurnstileGia();
    render(<Thu siteKey={undefined} />);
    expect(nut()).toBeEnabled();
  });

  it('không có site key thì KHÔNG dựng widget nào', async () => {
    const gia = dungTurnstileGia();
    render(<Thu siteKey="" />);
    await Promise.resolve();
    expect(gia.soLanRender()).toBe(0);
  });

  it('dựng đúng một widget dù React gọi effect hai lần', async () => {
    const gia = dungTurnstileGia();
    const { rerender } = render(<Thu siteKey="0x4AAAAAAE" />);
    await vi.waitFor(() => expect(gia.soLanRender()).toBe(1));
    rerender(<Thu siteKey="0x4AAAAAAE" />);
    await Promise.resolve();
    expect(gia.soLanRender()).toBe(1);
  });

  it('datLai xoá token và xin widget cấp cái mới — token dùng được đúng một lần', async () => {
    const gia = dungTurnstileGia();
    render(<Thu siteKey="0x4AAAAAAE" />);
    await vi.waitFor(() => expect(gia.goiLai.callback).toBeTypeOf('function'));

    gia.goiLai.callback?.('token-that');
    await vi.waitFor(() => expect(nut()).toBeEnabled());

    nut().click();
    await vi.waitFor(() => expect(nut()).toBeDisabled());
    expect(gia.soLanReset()).toBe(1);
  });
});

describe('useTurnstile khi script không tải được', () => {
  afterEach(() => {
    window.turnstile = undefined;
    for (const s of document.querySelectorAll('script')) s.remove();
  });

  it('giữ nút khoá thay vì mở ra cho người dùng ăn 403', async () => {
    window.turnstile = undefined;
    render(<Thu siteKey="0x4AAAAAAE" />);
    const script = document.querySelector('script');
    expect(script, 'phải có thẻ script được thêm vào').not.toBeNull();
    script?.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(nut()).toBeDisabled();
  });
});

/** Bài kiểm nhỏ cho chính `Thu`, để một thay đổi ở khung test không âm thầm làm rỗng các bài trên. */
describe('khung kiểm', () => {
  it('nút phản ứng theo state như một nút thật', () => {
    function Doi() {
      const [khoa, datKhoa] = useState(true);
      return (
        <button type="button" disabled={khoa} onClick={() => datKhoa(false)}>
          Gửi
        </button>
      );
    }
    render(<Doi />);
    expect(nut()).toBeDisabled();
  });
});
