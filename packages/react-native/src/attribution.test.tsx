// @vitest-environment jsdom
import { ATTRIBUTION_LINKS, attributionText } from '@mapslibvn/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Linking } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Attribution, COMPACT_ATTRIBUTION } from './attribution';

vi.mock('react-native', () => import('./test/react-native-mock'));

// Vitest chạy không có `globals` nên RTL không tự dọn DOM giữa các test.
afterEach(() => {
  cleanup();
  vi.mocked(Linking.openURL).mockClear();
});

const labels = () =>
  screen.getAllByTestId('mapslibvn-attribution-link').map((el) => el.textContent);

describe('Attribution', () => {
  it('đầy đủ: hiện chuỗi attributionText(), chưa bấm thì chưa có danh sách', () => {
    render(<Attribution compact={false} />);
    expect(screen.getByTestId('mapslibvn-attribution').textContent).toBe(attributionText());
    expect(screen.queryByTestId('mapslibvn-attribution-sheet')).toBeNull();
  });

  it('gọn: chỉ MapsLibVN + OSM', () => {
    render(<Attribution compact />);
    expect(screen.getByTestId('mapslibvn-attribution').textContent).toBe(COMPACT_ATTRIBUTION);
    expect(COMPACT_ATTRIBUTION).toBe('© MapsLibVN · © OpenStreetMap contributors');
  });

  it('bấm dòng gọn → danh sách đủ bốn nguồn kèm giấy phép, kể cả Foursquare', () => {
    // Hộp thoại native của MapLibre đọc metadata PMTiles chứ không đọc `attribution` trong style,
    // nên chỉ có OpenMapTiles + OSM (đo 23/09/2026) — danh sách phải do SDK tự dựng.
    render(<Attribution compact />);
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    expect(screen.getByTestId('mapslibvn-attribution-sheet')).toBeTruthy();
    expect(labels()).toEqual([
      '© MapsLibVN',
      '© OpenStreetMap contributors (ODbL)',
      '© OpenMapTiles',
      'Foursquare OS Places (Apache-2.0)',
    ]);
  });

  it('bấm một nguồn → mở đúng link của nó', () => {
    render(<Attribution compact={false} />);
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    const links = screen.getAllByTestId('mapslibvn-attribution-link');
    for (const [i, link] of ATTRIBUTION_LINKS.entries()) {
      const el = links[i];
      if (!el) throw new Error(`thiếu dòng ${link.text}`);
      fireEvent.click(el);
      expect(Linking.openURL).toHaveBeenLastCalledWith(link.href);
    }
    expect(Linking.openURL).toHaveBeenCalledTimes(ATTRIBUTION_LINKS.length);
  });

  it('nút Đóng và vùng nền đều đóng danh sách', () => {
    render(<Attribution compact />);
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    fireEvent.click(screen.getByTestId('mapslibvn-attribution-close'));
    expect(screen.queryByTestId('mapslibvn-attribution-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    fireEvent.click(screen.getByTestId('mapslibvn-attribution-backdrop'));
    expect(screen.queryByTestId('mapslibvn-attribution-sheet')).toBeNull();
  });
});
