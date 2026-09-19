import type { getSql } from '../../src/db';

export interface RecordedQuery {
  text: string;
  params: unknown[];
  /**
   * `true` CHỈ khi câu này chạy qua `tag` được `sql.begin()` truyền vào callback — tức "trong cùng
   * transaction". Trước đây `begin(fn)` chạy `fn` bằng CHÍNH tag gốc nên không có cách nào phân
   * biệt "trong tx" với "ngoài tx" chỉ bằng đếm số câu hay khớp mảnh SQL; một bài kiểm khẳng định
   * "cả ba câu đều chạy trong một transaction" theo cách đó vẫn xanh dù mã thật đưa lần đọc lại ra
   * NGOÀI `sql.begin`. Cờ này để bài kiểm khẳng định đúng điều nó tuyên bố.
   */
  inTx?: boolean;
}

const isFragment = (value: unknown): value is RecordedQuery =>
  typeof value === 'object' && value !== null && 'text' in value && 'params' in value;

/**
 * Tag `sql` giả: trả về {text, params} thay vì chạy. Fragment lồng nhau được nối phẳng;
 * tham số thường thành `$n`. `rows` là kết quả trả cho mỗi lần `await`.
 */
export function fakeSql(
  rows: unknown[] | ((query: RecordedQuery) => unknown[] | Promise<unknown[]>) = [],
  calls: RecordedQuery[] = [],
) {
  const build = (
    strings: TemplateStringsArray,
    values: unknown[],
    inTx: boolean,
  ): RecordedQuery => {
    let text = '';
    const params: unknown[] = [];
    strings.forEach((part, i) => {
      text += part;
      if (i >= values.length) return;
      const value = values[i];
      if (isFragment(value)) {
        text += value.text;
        params.push(...value.params);
      } else {
        params.push(value);
        text += `$${params.length}`;
      }
    });
    const query: RecordedQuery = { text: text.replace(/\s+/g, ' ').trim(), params };
    if (inTx) query.inTx = true;
    return query;
  };
  /**
   * Dựng một tag — `inTx` chỉ khác nhau giữa tag gốc (`false`) và tag mà `begin()` truyền vào
   * callback (`true`). Cả hai chia sẻ chung `calls`/`rows` qua closure nên thứ tự và số lượng câu
   * vẫn đúng như trước; chỉ thêm được khả năng phân biệt "câu này chạy ở đâu".
   */
  const layTag = (inTx: boolean) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = build(strings, values, inTx);
      calls.push(query);
      const result = typeof rows === 'function' ? rows(query) : rows;
      return Object.assign(Promise.resolve(result), query);
    };
    tag.unsafe = (text: string): RecordedQuery => ({ text, params: [] });
    // `sql.json(v)` của postgres.js đánh dấu tham số là jsonb và tự serialize. Bản giả giữ nguyên
    // giá trị để test khẳng định được cái gì thật sự được gửi đi.
    tag.json = (value: unknown): unknown => value;
    // `sql.begin(fn)` của postgres.js chạy fn với client trong transaction; bản giả chạy `fn` bằng
    // một tag RIÊNG đánh dấu `inTx: true` — đủ để khẳng định thứ tự, nội dung VÀ phạm vi transaction
    // của câu lệnh, không giả lập rollback.
    tag.begin = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(layTag(true));
    // `endSql()` gọi `sql.end({ timeout: 1 })` ở mọi route; thiếu hàm này thì route nào dùng client
    // tiêm vào cũng ném ngay trong `finally` và mọi nhánh biến thành 503.
    tag.end = (): Promise<void> => Promise.resolve();
    return tag;
  };
  const tag = layTag(false);
  return { sql: tag as unknown as ReturnType<typeof getSql>, calls };
}
