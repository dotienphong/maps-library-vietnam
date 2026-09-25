import { DOCS_URL, robotsTxt } from '@mapslibvn/catalog';
import type { APIRoute } from 'astro';

// Thay cho đoạn chú thích mặc định Cloudflare trả khi site không có robots.txt — bản đó không có
// `Sitemap:`, nên bot phải tự đoán đường tới sitemap (spec SEO-AI mục 1).
export const GET: APIRoute = () =>
  new Response(robotsTxt(DOCS_URL), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
