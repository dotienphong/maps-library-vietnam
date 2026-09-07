/**
 * Mẫu telex/VNI còn sót trong chuỗi đã bỏ dấu (spec 05/09 mục 5.6): nguyên âm đôi `aa/ee/oo`,
 * `dd`, dấu `s f r x j` dính cuối từ sau nguyên âm, hoặc chữ số 1–9 dính cuối từ.
 */
const TELEX_PATTERN = /(aa|ee|oo|dd|[aeiouy][sfrxj]\b|[a-z][1-9]\b)/;

/** Chuỗi có dấu hiệu người dùng gõ telex/VNI mà chưa được bộ gõ chuyển thành dấu. */
export function looksLikeTelex(normalized: string): boolean {
  return TELEX_PATTERN.test(normalized);
}

/**
 * Gập telex/VNI còn sót: `aa→a`, `ee→e`, `oo→o`, `dd→d`, `aw→a`, `ow→o`, `uw→u`; bỏ `s f r x j`
 * đứng cuối từ khi trước nó là nguyên âm hoặc phụ âm cuối hợp lệ (xem mục mở rộng dưới); bỏ chữ
 * số 1–9 dính cuối từ.
 *
 * Chỉ áp cho **truy vấn**, không bao giờ cho dữ liệu — đây là bậc 3b, chạy khi mọi bậc trước rỗng
 * và chỉ khi `looksLikeTelex` đúng. Mặc định **tắt** ở lần phát hành đầu (cờ `AUTOCOMPLETE_TELEX`),
 * bật sau khi log `stage_hit` cho thấy tỷ lệ truy vấn rỗng khớp mẫu telex đáng kể.
 *
 * **Mở rộng so với spec 5.6, có lý do:** spec chỉ nói bỏ dấu "sau nguyên âm", nhưng trong telex
 * thật dấu đứng ở CUỐI ÂM TIẾT, tức sau cả phụ âm cuối — `ddoongf` (Đồng) có `f` sau `ng`. Theo
 * đúng chữ của spec thì `ddoongf` chỉ gập được thành `dongf`, còn nguyên chữ `f`, làm bậc 3b gần
 * như vô dụng với âm tiết đóng. Nên nới thành: bỏ `s f r x j` ở cuối từ khi ngay trước nó là
 * nguyên âm **hoặc** một phụ âm cuối hợp lệ của tiếng Việt (`c ch m n ng nh p t`).
 *
 * Điều kiện này chính là thứ giữ cho tên nước ngoài không bị cắt: `highlands` có `d` trước `s` mà
 * `d` không phải phụ âm cuối hợp lệ → giữ nguyên; `starbucks` có `k` → giữ nguyên. Còn `viets` thì
 * `t` là phụ âm cuối hợp lệ → thành `viet`.
 */
export function foldTelex(normalized: string): string {
  return normalized
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'e')
    .replace(/oo/g, 'o')
    .replace(/dd/g, 'd')
    .replace(/aw/g, 'a')
    .replace(/ow/g, 'o')
    .replace(/uw/g, 'u')
    .replace(/([aeiouy](?:ch|ng|nh|[cmnpt])?)[sfrxj]\b/g, '$1')
    .replace(/([a-z])[1-9]\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
