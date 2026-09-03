// @vitest-environment jsdom
import { attributionText } from '@mapslibvn/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Attribution, COMPACT_ATTRIBUTION } from './attribution';

vi.mock('react-native', () => import('./test/react-native-mock'));

// Vitest chạy không có `globals` nên RTL không tự dọn DOM giữa các test.
afterEach(cleanup);

describe('Attribution', () => {
  it('đầy đủ: hiện chuỗi attributionText() và gọi onPress khi bấm', () => {
    const onPress = vi.fn();
    render(<Attribution compact={false} onPress={onPress} />);
    const box = screen.getByTestId('mapslibvn-attribution');
    expect(box.textContent).toBe(attributionText());
    fireEvent.click(box);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gọn: chỉ MapsLibVN + OSM', () => {
    render(<Attribution compact onPress={() => {}} />);
    expect(screen.getByTestId('mapslibvn-attribution').textContent).toBe(COMPACT_ATTRIBUTION);
    expect(COMPACT_ATTRIBUTION).toBe('© MapsLibVN · © OpenStreetMap contributors');
  });
});
