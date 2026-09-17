// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditPage } from './page';

const DONG = {
  id: '9007199254740993',
  actor: 'phong@test.invalid',
  action: 'billing.unlock_acks',
  target: 'de65cfba-2834-43da-bb81-78033d1b32b8',
  detail: { reason: 'bản vá 0.11.0', unlocked: 3 },
  created_at: '2026-09-17T03:30:00.000Z',
};

let duocGoi: string[] = [];

function mo(items = [DONG], nextCursor: string | null = null) {
  duocGoi = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      duocGoi.push(String(input));
      return new Response(JSON.stringify({ items, nextCursor }));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

const urlCuoi = () => new URL(duocGoi.at(-1) as string, 'https://admin.test');

describe('AuditPage', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('hiện việc đã làm kèm người, đối tượng và chi tiết', async () => {
    mo();
    expect(await screen.findByText('billing.unlock_acks')).toBeVisible();
    expect(screen.getByText('phong@test.invalid')).toBeVisible();
    expect(screen.getByText(DONG.target)).toBeVisible();
    // `detail` phải đọc được như dữ liệu, không phải một khối JSON escape.
    expect(screen.getByText('bản vá 0.11.0')).toBeVisible();
  });

  it('id bigint giữ nguyên dạng chuỗi làm khoá dòng, không rơi qua Number', () => {
    // 9007199254740993 qua Number thành 9007199254740992 — hai dòng nhật ký khác nhau sẽ trùng
    // khoá React và một dòng biến mất khỏi màn hình.
    expect(String(Number(DONG.id))).not.toBe(DONG.id);
  });

  it('lọc người thực hiện và loại việc đi vào query', async () => {
    mo();
    await screen.findByText('billing.unlock_acks');
    await userEvent.type(screen.getByLabelText('Lọc theo người thực hiện'), 'ai@do.vn');
    await waitFor(() => expect(urlCuoi().searchParams.get('actor')).toBe('ai@do.vn'));

    await userEvent.type(screen.getByLabelText('Lọc theo loại việc'), 'edit.approve');
    await waitFor(() => expect(urlCuoi().searchParams.get('action')).toBe('edit.approve'));
  });

  it('chọn một ngày gửi đi khoảng 24 giờ theo giờ máy, không phải nửa đêm UTC', async () => {
    mo();
    await screen.findByText('billing.unlock_acks');
    await userEvent.type(screen.getByLabelText('Từ ngày'), '2026-09-14');
    await userEvent.type(screen.getByLabelText('Đến ngày'), '2026-09-14');

    await waitFor(() => expect(urlCuoi().searchParams.get('to')).toBeTruthy());
    const url = urlCuoi();
    expect(url.searchParams.get('from')).toBe(new Date('2026-09-14T00:00:00').toISOString());
    expect(
      Date.parse(url.searchParams.get('to') as string) -
        Date.parse(url.searchParams.get('from') as string),
    ).toBe(86_400_000);
  });

  it('rỗng thì nói rõ nhật ký chỉ có việc làm qua trang Admin', async () => {
    mo([]);
    expect(await screen.findByText('Không có việc nào khớp')).toBeVisible();
  });
});
