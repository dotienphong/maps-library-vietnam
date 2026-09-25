import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Ép SEO ngay lúc build, giống bài viết của website: description ngoài 120–160 ký tự thì
      // Google tự viết lại hoặc cắt, và `astro build` đỏ ở đây trước khi lên production.
      extend: z.object({ description: z.string().min(120).max(160) }),
    }),
  }),
};
