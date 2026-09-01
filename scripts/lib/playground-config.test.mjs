import { describe, expect, it } from 'vitest';

import { resolveApiBase } from '../../apps/docs/public/playground-config.js';

const PRODUCTION_API = 'https://mapslibvn-api-production.dotienphong1993.workers.dev';

describe('resolveApiBase', () => {
  it('dùng API production khi mở playground Pages không có query', () => {
    expect(resolveApiBase('', 'mapslibvn-docs.pages.dev')).toBe(PRODUCTION_API);
  });

  it('giữ API local khi phát triển trên localhost', () => {
    expect(resolveApiBase('', 'localhost')).toBe('http://localhost:8787');
    expect(resolveApiBase('', '127.0.0.1')).toBe('http://localhost:8787');
  });

  it('ưu tiên api trong query để debug hoặc dùng deployment khác', () => {
    expect(resolveApiBase('?api=https%3A%2F%2Fapi.example.com', 'mapslibvn-docs.pages.dev')).toBe(
      'https://api.example.com',
    );
  });
});
