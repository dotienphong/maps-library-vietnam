const KHOA = 'admin-tai-lai-vi-chunk';
/** Trong vòng 30 giây mà phải tải lại lần nữa thì coi như lỗi khác, đừng lặp vô hạn. */
const CUA_SO_MS = 30_000;

export interface ChunkReloadDeps {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
}

/**
 * Khi deploy bản mới, tên các chunk đổi theo hash. Một tab đang mở vẫn giữ `index.html` cũ nên
 * sẽ xin đúng chunk cũ đã biến mất — dynamic import thất bại và màn hình đứng im không lý do.
 * Vite phát `vite:preloadError` cho đúng tình huống này; tải lại trang là cách sửa duy nhất, vì
 * mã mà tab đang chạy đã lỗi thời.
 *
 * Chỉ tải lại MỘT lần trong cửa sổ 30 giây: nếu lần sau vẫn hỏng thì nguyên nhân khác, và vòng
 * lặp tải lại sẽ che mất lỗi thật.
 */
export function dangKyTaiLaiKhiThieuChunk(
  target: Pick<Window, 'addEventListener'>,
  deps: ChunkReloadDeps = {},
): void {
  const now = deps.now ?? (() => Date.now());
  const reload = deps.reload ?? (() => location.reload());
  const storage = deps.storage ?? sessionStorage;

  target.addEventListener('vite:preloadError', ((event: Event) => {
    event.preventDefault();

    let lanTruoc = 0;
    try {
      lanTruoc = Number(storage.getItem(KHOA) ?? '0');
    } catch {
      // Trình duyệt chặn sessionStorage — cứ tải lại, tệ nhất là lặp một vòng.
    }
    if (lanTruoc && now() - lanTruoc < CUA_SO_MS) return;

    try {
      storage.setItem(KHOA, String(now()));
    } catch {
      // Không ghi nhớ được thì thôi; vẫn tải lại.
    }
    reload();
  }) as EventListener);
}
