import { ApiError } from '../errors';

/** Mốc giờ đã parse: UNIX giây (nguyên) và độ lệch múi giờ (phút) để in lại đúng múi người gọi dùng. */
export interface ParsedTime {
  unix: number;
  offsetMin: number;
}

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;
const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const VI_DU = '2026-09-24T08:00:00+07:00';

/**
 * ISO 8601 KÈM múi giờ → UNIX giây. Không nhận chuỗi thiếu múi giờ: "08:00" của ai? Worker chạy ở
 * UTC, khách ở +07:00, và VROOM chỉ hiểu số giây — một mốc mập mờ là một lịch sai cả tiếng.
 */
export function parseIsoWithOffset(raw: unknown, name: string): ParsedTime {
  if (typeof raw !== 'string') {
    throw new ApiError(
      400,
      'invalid_request',
      `${name} phải là chuỗi ISO 8601 kèm múi giờ, ví dụ ${VI_DU}`,
    );
  }
  const trimmed = raw.trim();
  const match = ISO_WITH_OFFSET.exec(trimmed);
  if (!match) {
    throw new ApiError(
      400,
      'invalid_request',
      ISO_NO_OFFSET.test(trimmed)
        ? `${name} phải kèm múi giờ, ví dụ ${VI_DU} (nhận "${trimmed}")`
        : `${name} phải là ISO 8601 kèm múi giờ, ví dụ ${VI_DU} (nhận "${trimmed}")`,
    );
  }
  const tz = match[7] ?? 'Z';
  const offsetMin =
    tz === 'Z'
      ? 0
      : (tz.startsWith('-') ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));
  const ms = Date.parse(trimmed);
  // V8 nhận "2026-02-30" và cuộn sang 02/03 (kiểm 23/09/2026): so lại năm-tháng-ngày theo đúng múi
  // giờ người gọi viết để bắt ngày không tồn tại, thay vì lặng lẽ xếp lịch vào một ngày khác.
  const local = new Date(ms + offsetMin * 60_000);
  if (
    !Number.isFinite(ms) ||
    local.getUTCFullYear() !== Number(match[1]) ||
    local.getUTCMonth() + 1 !== Number(match[2]) ||
    local.getUTCDate() !== Number(match[3])
  ) {
    throw new ApiError(
      400,
      'invalid_request',
      `${name} không phải thời điểm hợp lệ (nhận "${trimmed}")`,
    );
  }
  return { unix: Math.floor(ms / 1000), offsetMin };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** UNIX giây → ISO 8601 theo múi giờ cho trước, không mili giây: 1790211600, 420 → 2026-09-24T08:00:00+07:00. */
export function formatIsoAt(unix: number, offsetMin: number): string {
  const d = new Date((unix + offsetMin * 60) * 1000);
  const abs = Math.abs(offsetMin);
  const tz =
    offsetMin === 0
      ? 'Z'
      : `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${tz}`;
}
