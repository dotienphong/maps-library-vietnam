export const ALLOWED_REMOTE = /^git@github\.com-dotienphong:dotienphong\/MapsLibVN(\.git)?$/;
export const FORBIDDEN_EMAIL = /bark/i;
export const REQUIRED_REMOTE = 'git@github.com-dotienphong:dotienphong/MapsLibVN.git';

/**
 * Kiểm tra remote và author có đúng account cá nhân dotienphong không.
 * @param {{ remoteUrl: string, email: string }} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkGitIdentity({ remoteUrl, email }) {
  const errors = [];
  const warnings = [];
  const remote = (remoteUrl ?? '').trim();
  const mail = (email ?? '').trim();

  if (!remote) {
    warnings.push(`Chưa có remote origin. Thêm bằng: git remote add origin ${REQUIRED_REMOTE}`);
  } else if (!ALLOWED_REMOTE.test(remote)) {
    errors.push(`Remote origin sai: "${remote}". Bắt buộc: ${REQUIRED_REMOTE}`);
  }

  if (!mail) {
    errors.push('Chưa cấu hình user.email. Dùng: git config user.email dotienphong1993@gmail.com');
  } else if (FORBIDDEN_EMAIL.test(mail)) {
    errors.push(`user.email "${mail}" thuộc account công ty — CẤM dùng cho MapsLibVN`);
  }

  return { errors, warnings };
}
