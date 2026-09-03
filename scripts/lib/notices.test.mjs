import { describe, expect, it } from 'vitest';
import { NOTICE_FILES, SDK_PACKAGES, noticePlan, staleCopies } from './notices.mjs';

describe('noticePlan', () => {
  it('mỗi gói SDK nhận đủ LICENSE và THIRD_PARTY_NOTICES.md', () => {
    const plan = noticePlan();
    expect(NOTICE_FILES).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md']);
    expect(SDK_PACKAGES).toEqual([
      'packages/core',
      'packages/web',
      'packages/react',
      'packages/react-native',
    ]);
    expect(plan).toHaveLength(8);
    expect(plan).toContainEqual({ src: 'LICENSE', dst: 'packages/web/LICENSE' });
    expect(plan).toContainEqual({
      src: 'THIRD_PARTY_NOTICES.md',
      dst: 'packages/react-native/THIRD_PARTY_NOTICES.md',
    });
  });
});

describe('staleCopies', () => {
  /** @type {Record<string, string>} */
  const files = {
    LICENSE: 'MIT',
    'THIRD_PARTY_NOTICES.md': 'notices v2',
    'packages/core/LICENSE': 'MIT',
    'packages/core/THIRD_PARTY_NOTICES.md': 'notices v1', // lệch
    'packages/web/LICENSE': 'MIT',
    'packages/web/THIRD_PARTY_NOTICES.md': 'notices v2',
    // packages/react và packages/react-native thiếu cả hai
  };

  it('liệt kê bản sao lệch hoặc thiếu, bỏ qua bản sao đúng', () => {
    expect(staleCopies(noticePlan(), (p) => files[p])).toEqual([
      'packages/core/THIRD_PARTY_NOTICES.md',
      'packages/react/LICENSE',
      'packages/react/THIRD_PARTY_NOTICES.md',
      'packages/react-native/LICENSE',
      'packages/react-native/THIRD_PARTY_NOTICES.md',
    ]);
  });

  it('trả mảng rỗng khi mọi bản sao khớp', () => {
    /** @type {Record<string, string>} */
    const all = {
      ...files,
      'packages/core/THIRD_PARTY_NOTICES.md': 'notices v2',
      'packages/react/LICENSE': 'MIT',
      'packages/react/THIRD_PARTY_NOTICES.md': 'notices v2',
      'packages/react-native/LICENSE': 'MIT',
      'packages/react-native/THIRD_PARTY_NOTICES.md': 'notices v2',
    };
    expect(staleCopies(noticePlan(), (p) => all[p])).toEqual([]);
  });
});
