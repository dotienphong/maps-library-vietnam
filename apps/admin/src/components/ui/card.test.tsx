// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './card';

describe('Card', () => {
  it('thẻ thường không có hiệu ứng rê chuột — nó không bấm được thì không được hứa hẹn gì', () => {
    render(<Card>Nội dung</Card>);
    const card = screen.getByText('Nội dung');
    expect(card.className).not.toContain('hover:');
    expect(card).not.toHaveAttribute('data-card', 'interactive');
  });

  it('thẻ bấm được: nổi lên khi rê chuột, lún lại khi bấm, và làm mốc cho nút phủ toàn thẻ', () => {
    render(<Card interactive>Nội dung</Card>);
    const card = screen.getByText('Nội dung');
    expect(card).toHaveAttribute('data-card', 'interactive');
    // `relative` là điều kiện sống của nút phủ toàn thẻ (after:inset-0) — thiếu nó thì vùng bấm
    // nhảy ra phần tử định vị gần nhất phía trên, tức một thẻ khác hoặc cả trang.
    expect(card.className).toContain('relative');
    expect(card.className).toContain('hover:-translate-y-0.5');
    expect(card.className).toContain('active:translate-y-0');
  });

  it('người tắt hiệu ứng chuyển động thì thẻ không nhúc nhích', () => {
    render(<Card interactive>Nội dung</Card>);
    expect(screen.getByText('Nội dung').className).toContain('motion-reduce:');
  });

  it('bàn phím cũng thấy thẻ nổi lên khi tiêu điểm vào nút bên trong', () => {
    render(<Card interactive>Nội dung</Card>);
    expect(screen.getByText('Nội dung').className).toContain('has-[:focus-visible]');
  });
});
