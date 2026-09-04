import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_LINKS,
  attributionHtml,
  attributionText,
  mapsLibVNAttributionHtml,
} from './attribution';

describe('attribution', () => {
  it('văn bản đúng chuỗi bắt buộc trong spec 12.3', () => {
    expect(attributionText()).toBe(
      '© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)',
    );
  });

  it('HTML có đủ 5 liên kết mở tab mới', () => {
    const html = attributionHtml();
    expect(html.match(/<a /g)).toHaveLength(5);
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain('rel="noopener"');
  });

  it('mapsLibVNAttributionHtml chỉ còn một liên kết MapsLibVN', () => {
    const html = mapsLibVNAttributionHtml();
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('© MapsLibVN');
    expect(html).toContain('href="https://github.com/dotienphong/maps-library-vietnam"');
    // Không được lặp nguồn dữ liệu: style đã tự khai báo.
    expect(html).not.toContain('OpenStreetMap');
    expect(html).not.toContain('Overture');
  });

  it('danh sách liên kết có 5 mục với href https', () => {
    expect(ATTRIBUTION_LINKS).toHaveLength(5);
    for (const link of ATTRIBUTION_LINKS) expect(link.href).toMatch(/^https:\/\//);
  });
});
