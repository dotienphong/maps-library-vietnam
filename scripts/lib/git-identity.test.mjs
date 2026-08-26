import { describe, expect, it } from 'vitest';
import { checkGitIdentity } from './git-identity.mjs';

const GOOD_REMOTE = 'git@github.com-dotienphong:dotienphong/maps-library-vietnam.git';
const GOOD_EMAIL = 'dotienphong1993@gmail.com';

describe('checkGitIdentity', () => {
  it('chấp nhận remote alias cá nhân và email cá nhân', () => {
    const result = checkGitIdentity({ remoteUrl: GOOD_REMOTE, email: GOOD_EMAIL });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('chấp nhận remote không có đuôi .git', () => {
    const result = checkGitIdentity({
      remoteUrl: GOOD_REMOTE.replace(/\.git$/, ''),
      email: GOOD_EMAIL,
    });
    expect(result.errors).toEqual([]);
  });

  it('từ chối host github.com trơn (sẽ dùng key/account mặc định)', () => {
    const result = checkGitIdentity({
      remoteUrl: 'git@github.com:dotienphong/maps-library-vietnam.git',
      email: GOOD_EMAIL,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Remote origin sai/);
  });

  it('từ chối remote HTTPS', () => {
    const result = checkGitIdentity({
      remoteUrl: 'https://github.com/dotienphong/maps-library-vietnam.git',
      email: GOOD_EMAIL,
    });
    expect(result.errors).toHaveLength(1);
  });

  it('từ chối email chứa bark', () => {
    const result = checkGitIdentity({
      remoteUrl: GOOD_REMOTE,
      email: 'phong.dotien.ext@bark.com',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/account công ty/);
  });

  it('thiếu remote chỉ là cảnh báo, thiếu email là lỗi', () => {
    const result = checkGitIdentity({ remoteUrl: '', email: '' });
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
