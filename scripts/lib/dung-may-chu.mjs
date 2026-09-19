import { capture } from './run.mjs';

/**
 * Tên container Postgres của compose `mapslibvn-server`. Compose đặt tên theo
 * `<project>-<service>-<số>`, và project được ghim bằng `name:` ở đầu compose.yml.
 */
export const CONTAINER_POSTGRES = 'mapslibvn-server-postgres-1';

/**
 * Phân loại tình hình từ output của `docker ps`, tách riêng để kiểm được mà không cần Docker.
 *
 * @param {string} dangChay output của `docker ps --filter ... --format {{.Names}}`
 * @param {string} daTungCo output của `docker ps -a --filter ...`
 * @returns {{ oDay: boolean, ma: 'dang-chay' | 'co-nhung-da-tat' | 'khong-phai-may-nay' }}
 */
export function tinhHinhMayChu(dangChay, daTungCo) {
  if (dangChay.trim()) return { oDay: true, ma: 'dang-chay' };
  if (daTungCo.trim()) return { oDay: false, ma: 'co-nhung-da-tat' };
  return { oDay: false, ma: 'khong-phai-may-nay' };
}

/** @param {'dang-chay'|'co-nhung-da-tat'|'khong-phai-may-nay'} ma @param {string} lenh */
export function loiDanh(ma, lenh) {
  if (ma === 'co-nhung-da-tat') {
    return [
      `✗ Máy này CÓ compose máy chủ nhưng container đang TẮT, nên \`${lenh}\` sẽ không chạm được`,
      '  tới dữ liệu nào.',
      '',
      '  Bật lại rồi chạy lại:',
      '      cd infra/server && docker compose --env-file .env -f compose.yml up -d',
      '',
      '  Nếu máy chủ thật nằm ở máy khác thì đừng bật ở đây — hãy gõ lệnh trên máy đó.',
    ].join('\n');
  }
  return [
    `✗ Máy này KHÔNG chạy máy chủ MapsLibVN, nên \`${lenh}\` không có gì để làm.`,
    '',
    `  Lệnh \`server:*\` chỉ là \`docker compose\` — nó tác động lên MÁY ĐANG GÕ LỆNH, không đăng`,
    '  nhập từ xa đi đâu cả. Hãy mở terminal trên máy chủ, vào thư mục repo ở đó, rồi gõ lại.',
    '',
    '  Cách xác nhận đang đứng đúng máy:',
    `      docker ps --filter name=${CONTAINER_POSTGRES}`,
    '  Phải thấy container ở trạng thái Up.',
  ].join('\n');
}

/**
 * Dừng ngay nếu máy đang gõ lệnh không phải máy chủ.
 *
 * Vì sao cần: `docker compose run` vẫn khởi động container `pipeline` bình thường rồi mới chết
 * bên trong với `getaddrinfo ENOTFOUND postgres` — một thông báo không nói gì về nguyên nhân thật.
 * Ngày 19/09/2026 chuyện này xảy ra hai lần trong một buổi, và tài liệu M2 còn viết "máy dev là
 * máy chủ" nên càng dễ nhầm.
 *
 * @param {string} lenh tên lệnh pnpm, chỉ dùng để in thông báo
 */
export function phaiDungTrenMayChu(lenh) {
  const loc = `name=${CONTAINER_POSTGRES}`;
  const { ma } = tinhHinhMayChu(
    capture('docker', ['ps', '--filter', loc, '--format', '{{.Names}}']),
    capture('docker', ['ps', '-a', '--filter', loc, '--format', '{{.Names}}']),
  );
  if (ma === 'dang-chay') return;
  console.error(loiDanh(ma, lenh));
  process.exit(1);
}
