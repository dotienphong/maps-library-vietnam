import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// `z` re-export từ 'astro:content' đã bị Astro 7 đánh dấu ngừng dùng và sẽ bỏ ở bản sau;
// import thẳng từ zod (chính astro đang phụ thuộc zod 4) là đường sống lâu hơn.
import { z } from 'zod';

/**
 * Schema ép đúng ràng buộc SEO ngay lúc build: một bài có description 119 ký tự sẽ làm
 * `astro build` đỏ, không cần test riêng và không bao giờ lọt lên production.
 */
const baiViet = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/bai-viet' }),
  schema: z.object({
    title: z.string().max(60),
    description: z.string().min(120).max(160),
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    updatedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    tags: z.array(z.string()).min(1),
    /** Đặt true khi PHONG đã đọc và đồng ý đăng. Bài chưa duyệt không lên sitemap. */
    daDuyet: z.boolean().default(false),
  }),
});

export const collections = { baiViet };
