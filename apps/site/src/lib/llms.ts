import { API_BASE, DOCS, DOCS_LLMS } from '@mapslibvn/catalog';
import { BRAND, CONSOLE_URL, SUPPORT_EMAIL, SUPPORT_PHONE_HIEN_THI } from '../../site.config.mjs';
import { sapTheoNgayMoi } from './bai-viet';
import { bangGia } from './gia';
import { canonicalUrl } from './seo';
import { TRANG, type TrangMeta } from './trang';

export interface BaiLlms {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
}

const SDK = ['@mapslibvn/web', '@mapslibvn/react', '@mapslibvn/react-native', '@mapslibvn/core'];

/** Một dòng link đúng khuôn llmstxt.org: `- [tên](url)` rồi `: ghi chú` nếu có. */
const dong = (ten: string, url: string, ghiChu?: string) =>
  `- [${ten}](${url})${ghiChu ? `: ${ghiChu}` : ''}`;

/**
 * `/llms.txt` của website theo llmstxt.org (spec SEO-AI mục 5.2). Sinh từ TRANG, catalog giá và
 * bài đã duyệt: đổi giá hay đổi mô tả trang là tệp tự đúng theo, không có con số nào gõ tay.
 */
export function noiDungLlms(baiViet: readonly BaiLlms[]): string {
  const gia = bangGia().map((goi) =>
    goi.tier === 'trial'
      ? `  - ${goi.ten}: miễn phí 30 ngày, ${goi.placesHienThi} lượt Places, ${goi.directionsHienThi} lượt tính tuyến`
      : `  - ${goi.ten}: ${goi.theoKy[1].vndHienThi} mỗi tháng, ${goi.placesHienThi} lượt Places, ${goi.directionsHienThi} lượt tính tuyến`,
  );
  const trangChinh = (Object.values(TRANG) as TrangMeta[])
    .filter((trang) => trang.path !== TRANG.trangChu.path && trang.path !== TRANG.khong404.path)
    .map((trang) => dong(trang.h1, canonicalUrl(trang.path), trang.description));
  const bai = sapTheoNgayMoi(baiViet).map((item) =>
    dong(item.title, canonicalUrl(`/bai-viet/${item.slug}/`), item.description),
  );

  return [
    `# ${BRAND}`,
    '',
    `> ${TRANG.trangChu.description}`,
    '',
    'Cần biết:',
    '',
    `- API: ${API_BASE} — mọi endpoint /v1/* cần khoá API gửi qua header X-Api-Key.`,
    `- SDK trên npm: ${SDK.join(', ')}.`,
    '- Giá tính theo lượt gọi API, không theo số người dùng:',
    ...gia,
    `- Đăng ký và lấy khoá: ${CONSOLE_URL}`,
    `- Liên hệ: ${SUPPORT_EMAIL}, ${SUPPORT_PHONE_HIEN_THI}`,
    '',
    '## Trang chính',
    '',
    ...trangChinh,
    ...(bai.length > 0 ? ['', '## Bài viết', '', ...bai] : []),
    '',
    '## Tài liệu',
    '',
    dong('Mục lục tài liệu cho LLM', DOCS_LLMS, 'toàn bộ tài liệu kỹ thuật dạng văn bản'),
    dong('Bắt đầu 5 phút', DOCS.batDau),
    dong('Khoá API', DOCS.khoaApi),
    dong('REST API', DOCS.api),
    '',
  ].join('\n');
}
