import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { DOCS_URL } from '@mapslibvn/catalog';
import { ngayGit } from '../scripts/ngay-git.mjs';
import { theHeadDocs } from './lib/seo-docs';

/**
 * Chèn ảnh OG, JSON-LD và noindex vào `<head>` của mọi trang Starlight (spec SEO-AI mục 6.2). Logic
 * nằm ở `lib/seo-docs.ts` để test được bằng vitest; ở đây chỉ gom dữ liệu của route.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  // Trang 404 dựng sẵn của Starlight không có mô tả và không phải bài để mang TechArticle.
  if (route.id === '404') return;
  const { data, filePath } = route.entry;
  route.head.push(
    ...theHeadDocs({
      id: route.id,
      title: data.title,
      description: data.description ?? '',
      url: new URL(context.url.pathname, DOCS_URL).href,
      // Cùng ngày với dòng "Cập nhật lần cuối" Starlight in ở cuối trang.
      dateModified: route.lastUpdated?.toISOString(),
      // Hai trang pháp lý sinh không có lịch sử git → undefined → bỏ trường.
      datePublished: filePath ? ngayGit(filePath)?.taoLuc : undefined,
    }),
  );
});
