import { spawnSync } from 'node:child_process';

/** @typedef {{ taoLuc: string, suaLuc: string }} NgayGit */

/** @type {Map<string, NgayGit | undefined>} */
const DA_DOC = new Map();

/**
 * Ngày commit đầu và cuối của một tệp — ngày COMMITTER (`%cI`), cùng loại ngày Starlight dùng cho
 * `lastUpdated`, nên sitemap, JSON-LD và dòng "Cập nhật lần cuối" không bao giờ lệch nhau.
 *
 * Tệp không có lịch sử (hai trang pháp lý sinh lúc build nằm trong .gitignore, tệp ngoài repo, máy
 * không có git) trả undefined — không ném lỗi. Clone nông cho ngày SAI chứ không lỗi, nên
 * deploy-docs.yml phải kéo đủ lịch sử (`fetch-depth: 0`).
 * @param {string} tep đường dẫn tuyệt đối, hoặc tương đối với cwd
 * @returns {NgayGit | undefined}
 */
export function ngayGit(tep) {
  if (DA_DOC.has(tep)) return DA_DOC.get(tep);
  const kq = spawnSync('git', ['log', '--follow', '--format=%cI', '--', tep], {
    encoding: 'utf8',
  });
  const dong = kq.status === 0 ? kq.stdout.split('\n').filter(Boolean) : [];
  const moiNhat = dong[0];
  const cuNhat = dong[dong.length - 1];
  const ngay = moiNhat && cuNhat ? { taoLuc: cuNhat, suaLuc: moiNhat } : undefined;
  DA_DOC.set(tep, ngay);
  return ngay;
}
