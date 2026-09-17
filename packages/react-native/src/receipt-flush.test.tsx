// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlushReceiptsOnBackground } from './receipt-flush';
import { setAppState } from './test/react-native-mock';

vi.mock('react-native', () => import('./test/react-native-mock'));

afterEach(cleanup);

function Harness({ flush }: { flush: () => Promise<boolean> }) {
  useFlushReceiptsOnBackground({ flushReceipts: flush });
  return null;
}

describe('useFlushReceiptsOnBackground', () => {
  it('app vào nền → ACK ngay những receipt còn chờ', () => {
    // React Native không có pagehide/visibilitychange. Không có móc này thì receipt cuối cùng của
    // mỗi phiên dùng app chết theo tiến trình, và ba phiên là chạm ngưỡng ack_required của sổ.
    const flush = vi.fn(async () => true);
    setAppState('active');
    render(<Harness flush={flush} />);
    expect(flush).not.toHaveBeenCalled();

    act(() => setAppState('background'));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('chuyển sang inactive (kéo thanh thông báo, chuyển app) cũng ACK', () => {
    const flush = vi.fn(async () => true);
    setAppState('active');
    render(<Harness flush={flush} />);
    act(() => setAppState('inactive'));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('quay lại active không gọi thêm lần nào', () => {
    const flush = vi.fn(async () => true);
    setAppState('active');
    render(<Harness flush={flush} />);
    act(() => setAppState('background'));
    act(() => setAppState('active'));
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
