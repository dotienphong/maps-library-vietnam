// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewKeyDialog } from './new-key';

const KEY = 'mlv_live_ABCDEFGHIJKLMNOPQRSTUVWX';

const stubIssue = () => {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          key: KEY,
          key_prefix: KEY.slice(0, 17),
          key_hash: 'a'.repeat(64),
          tenant_id: 't1',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const renderDialog = (onClose = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NewKeyDialog tenantId="t1" onClose={onClose} />
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('NewKeyDialog', () => {
  it('chọn loại "Trang web" thì hiện ô origin và không cho gửi khi bỏ trống', async () => {
    const fetchMock = stubIssue();
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'trang nhúng khách');
    await userEvent.selectOptions(screen.getByLabelText('Loại khoá'), 'web');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /bắt buộc có ít nhất một origin/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cấp khoá máy chủ: gửi đúng thân yêu cầu', async () => {
    const fetchMock = stubIssue();
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'máy chủ nội bộ');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    await screen.findByText(KEY);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      label: 'máy chủ nội bộ',
      kind: 'server',
      scopes: ['places:read'],
    });
  });

  it('khoá hiện đúng một lần kèm cảnh báo rõ ràng', async () => {
    stubIssue();
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    expect(await screen.findByText(KEY)).toBeVisible();
    expect(screen.getByText(/chỉ hiện một lần/i)).toBeVisible();
    // Không còn đường quay lại form khi khoá đã hiện: bấm cấp lần nữa là cấp khoá thứ hai.
    expect(screen.queryByRole('button', { name: 'Cấp khoá' })).not.toBeInTheDocument();
  });

  it('nút sao chép ghi đúng khoá vào clipboard', async () => {
    stubIssue();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sao chép khoá' }));
    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(await screen.findByText('Đã sao chép')).toBeVisible();
  });

  it('lỗi từ máy chủ hiện nguyên mã lỗi, không nuốt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'invalid_request', message: 'label không được rỗng' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    expect(await screen.findByText(/label không được rỗng/)).toBeVisible();
  });
});
