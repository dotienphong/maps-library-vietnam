import type { Env } from '../env';
import { FREE_DIRECTIONS_PER_DAY, FREE_PLACES_PER_DAY, vnDay } from '../quota';

export interface KhoaQuota {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
}

export interface MucDungNhom {
  used: number;
  limit: number;
}

export interface MucDungKhoa {
  keyPrefix: string;
  label: string | null;
  places: MucDungNhom;
  directions: MucDungNhom;
}

export interface MucDungLegacy {
  day: string;
  keys: MucDungKhoa[];
  total: { places: MucDungNhom; directions: MucDungNhom };
}

/**
 * Mức dùng HÔM NAY (theo ngày VN) của tenant chưa bật chế độ thương mại, đọc từ bộ đếm xấp xỉ
 * trong KV. KHÔNG chạm Durable Object: `readUsage()` sẽ TẠO sổ quota cho tenant chưa có, và một
 * lần mở trang quản trị không được phép đẻ ra sổ cho tenant legacy.
 */
export async function legacyUsageForKeys(
  env: Env,
  keys: readonly KhoaQuota[],
): Promise<MucDungLegacy> {
  const day = vnDay();
  const items = await Promise.all(
    keys.map(async (key) => {
      const [places, directions] = await Promise.all([
        env.META.get(`quota:${key.key_hash}:${day}:places`),
        env.META.get(`quota:${key.key_hash}:${day}:directions`),
      ]);
      return {
        keyPrefix: key.key_prefix,
        label: key.label,
        places: {
          used: Number(places ?? 0),
          limit: key.quota_places_per_day ?? FREE_PLACES_PER_DAY,
        },
        directions: {
          used: Number(directions ?? 0),
          limit: key.quota_directions_per_day ?? FREE_DIRECTIONS_PER_DAY,
        },
      };
    }),
  );
  const cong = (group: 'places' | 'directions'): MucDungNhom => ({
    used: items.reduce((tong, item) => tong + item[group].used, 0),
    limit: items.reduce((tong, item) => tong + item[group].limit, 0),
  });
  return { day, keys: items, total: { places: cong('places'), directions: cong('directions') } };
}
