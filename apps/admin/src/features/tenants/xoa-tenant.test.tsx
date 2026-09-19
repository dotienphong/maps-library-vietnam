// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { XoaTenantDialog } from './xoa-tenant';

const TEN = 'Phong Company Test';

const stubXoa = (
  body: unknown = { deleted: true, name: TEN, keys_deleted: 2, accounts_unlinked: 1 },
  status = 200,
) => {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const ve = (props: Partial<Parameters<typeof XoaTenantDialog>[0]> = {}) => {
  const onClose = vi.fn();
  const onXoaXong = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <XoaTenantDialog
        tenantId="t1"
        tenantName={TEN}
        soKhoa={2}
        onClose={onClose}
        onXoaXong={onXoaXong}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose, onXoaXong };
};

const nutXoa = () => screen.getByRole('button', { name: 'Xoá vĩnh viễn' });
const oGoLai = () => screen.getByLabelText('Gõ lại tên tổ chức để xác nhận');

afterEach(() => vi.unstubAllGlobals());

describe('XoaTenantDialog', () => {
  it('nút xoá KHOÁ khi chưa gõ gì — bấm nhầm hai lần không xoá được tổ chức', () => {
    stubXoa();
    ve();
    expect(nutXoa()).toBeDisabled();
  });

  it('gõ sai tên thì vẫn khoá, không gửi gì lên máy chủ', async () => {
    const fetchMock = stubXoa();
    ve();
    await userEvent.type(oGoLai(), 'Phong Company');
    expect(nutXoa()).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gõ đúng tên thì mở khoá và gửi DELETE kèm confirm_name', async () => {
    const fetchMock = stubXoa();
    const { onXoaXong } = ve();
    await userEvent.type(oGoLai(), TEN);
    expect(nutXoa()).toBeEnabled();
    await userEvent.click(nutXoa());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/admin/tenants/t1');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ confirm_name: TEN });
    await vi.waitFor(() => expect(onXoaXong).toHaveBeenCalled());
  });

  it('khoảng trắng thừa hai đầu vẫn tính là khớp — người ta hay dán kèm dấu cách', async () => {
    stubXoa();
    ve();
    await userEvent.type(oGoLai(), `  ${TEN}  `);
    expect(nutXoa()).toBeEnabled();
  });

  it('nói rõ sẽ xoá bao nhiêu khoá, vì đó là thứ làm hỏng ứng dụng đang chạy', () => {
    stubXoa();
    ve({ soKhoa: 7 });
    expect(screen.getByTestId('so-khoa')).toHaveTextContent('7');
  });

  it('nói rõ tài khoản đăng nhập của khách được giữ lại', () => {
    stubXoa();
    ve();
    expect(screen.getByText(/giữ lại/)).toBeInTheDocument();
  });

  it('máy chủ từ chối vì còn đóng góp POI thì hiện NGUYÊN thông điệp đó', async () => {
    stubXoa(
      {
        error: {
          code: 'tenant_has_edits',
          message: 'Tổ chức còn 12 đóng góp POI — xử lý chúng trước rồi mới xoá được',
        },
      },
      409,
    );
    const { onXoaXong } = ve();
    await userEvent.type(oGoLai(), TEN);
    await userEvent.click(nutXoa());

    const loi = await screen.findByRole('alert');
    expect(loi).toHaveTextContent('12 đóng góp POI');
    // Không gọi onXoaXong khi máy chủ từ chối: đóng bảng lúc này là nói dối người dùng.
    expect(onXoaXong).not.toHaveBeenCalled();
  });

  it('máy chủ báo lệch tên thì cũng hiện nguyên thông điệp', async () => {
    stubXoa(
      { error: { code: 'confirm_name_mismatch', message: 'Gõ đúng tên tổ chức để xác nhận' } },
      400,
    );
    ve();
    await userEvent.type(oGoLai(), TEN);
    await userEvent.click(nutXoa());
    expect(await screen.findByRole('alert')).toHaveTextContent('Gõ đúng tên tổ chức');
  });

  it('nhắc khoá còn sống thêm vài phút vì bộ nhớ đệm — nếu không người vận hành tưởng xoá hỏng', () => {
    stubXoa();
    ve();
    expect(screen.getByText(/5 phút/)).toBeInTheDocument();
  });

  it('bấm Huỷ thì đóng mà không gửi gì', async () => {
    const fetchMock = stubXoa();
    const { onClose } = ve();
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
