import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from './attribution';

describe('attribution', () => {
  it('văn bản đúng chuỗi bắt buộc trong spec 12.3 (Overture đã gỡ 13/09/2026)', () => {
    expect(attributionText()).toBe(
      '© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)',
    );
  });

  it('không còn mục Overture trong danh sách liên kết', () => {
    expect(ATTRIBUTION_LINKS.map((l) => l.text)).not.toContain('Places: Overture Maps Foundation');
    expect(attributionText()).not.toMatch(/overture/i);
    expect(attributionHtml()).not.toMatch(/overture/i);
  });

  it('HTML có đủ 4 liên kết mở tab mới, ghép bằng " · ", Foursquare kèm giấy phép', () => {
    const html = attributionHtml();
    expect(html.match(/<a /g)).toHaveLength(4);
    expect(html.split(' · ')).toHaveLength(4);
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain('rel="noopener"');
    expect(html).toMatch(/Foursquare OS Places<\/a> \(Apache-2\.0\)$/);
  });

  it('danh sách liên kết có 4 mục với href https', () => {
    expect(ATTRIBUTION_LINKS).toHaveLength(4);
    for (const link of ATTRIBUTION_LINKS) expect(link.href).toMatch(/^https:\/\//);
  });
});
