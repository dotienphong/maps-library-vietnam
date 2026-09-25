import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { noiDungLlms } from '../lib/llms';

// Chỉ bài đã duyệt, giống sitemap và trang /bai-viet/: bản nháp không được lọt ra cho máy đọc.
export const GET: APIRoute = async () => {
  const bai = await getCollection('baiViet', ({ data }) => data.daDuyet);
  const txt = noiDungLlms(
    bai.map((item) => ({
      slug: item.id,
      title: item.data.title,
      description: item.data.description,
      publishedAt: item.data.publishedAt,
    })),
  );
  return new Response(txt, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
