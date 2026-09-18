import { useQuery } from '@tanstack/react-query';
import { type CauHinh, layCauHinh, layToi, type Toi } from '@/lib/api';

export const khoaCache = {
  cauHinh: ['cau-hinh'] as const,
  toi: ['toi'] as const,
  mucDung: ['muc-dung'] as const,
  khoa: ['khoa'] as const,
};

export function useCauHinh() {
  return useQuery<CauHinh>({
    queryKey: khoaCache.cauHinh,
    queryFn: layCauHinh,
    // Cấu hình gần như không đổi trong một phiên; hỏi lại mỗi lần đổi màn là lãng phí.
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useToi() {
  return useQuery<Toi>({
    queryKey: khoaCache.toi,
    queryFn: layToi,
    // KHÔNG thử lại khi 401: người chưa đăng nhập thì thử lại cũng vậy, mà lại chậm thêm.
    retry: false,
    staleTime: 30_000,
  });
}
