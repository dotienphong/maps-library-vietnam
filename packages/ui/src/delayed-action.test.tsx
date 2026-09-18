// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedActionProvider, useDelayedAction } from './delayed-action';

function Harness({ run }: { run: () => Promise<void> }) {
  const { schedule } = useDelayedAction();
  return (
    <button type="button" onClick={() => schedule({ label: 'Đã duyệt #1', run })}>
      Duyệt
    </button>
  );
}

const setup = (run: () => Promise<void>) =>
  render(
    <DelayedActionProvider>
      <Harness run={run} />
    </DelayedActionProvider>,
  );

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('delayed-action', () => {
  it('huỷ trong 5 giây → KHÔNG gọi API lần nào', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(run);

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(run).not.toHaveBeenCalled();
  });

  it('để hết 5 giây → gọi đúng một lần', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(run);

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(run).toHaveBeenCalledOnce();
  });

  it('toast hiện nhãn và số giây còn lại', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(vi.fn().mockResolvedValue(undefined));

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(screen.getByText(/Đã duyệt #1/)).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/3 giây/)).toBeVisible();
  });
  it('reloadGuard nhận hàm nói thật "đang có việc chờ", và nhận () => false khi gỡ', async () => {
    const guards: Array<() => boolean> = [];
    const reloadGuard = (guard: () => boolean) => {
      guards.push(guard);
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(
      <DelayedActionProvider reloadGuard={reloadGuard}>
        <Harness run={vi.fn().mockResolvedValue(undefined)} />
      </DelayedActionProvider>,
    );

    // Lúc gắn: chưa có việc.
    expect(guards).toHaveLength(1);
    expect(guards[0]?.()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(guards[0]?.()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(guards[0]?.()).toBe(false);

    view.unmount();
    expect(guards).toHaveLength(2);
    expect(guards[1]?.()).toBe(false);
  });

  it('không truyền reloadGuard thì vẫn chạy — package không biết fetcher của app nào', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(run);
    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(run).toHaveBeenCalledOnce();
  });
});
