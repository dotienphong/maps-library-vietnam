import type { getSql } from '../../src/db';

export interface RecordedQuery {
  text: string;
  params: unknown[];
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
  const build = (strings: TemplateStringsArray, values: unknown[]): RecordedQuery => {
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
    return { text: text.replace(/\s+/g, ' ').trim(), params };
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = build(strings, values);
    calls.push(query);
    const result = typeof rows === 'function' ? rows(query) : rows;
    return Object.assign(Promise.resolve(result), query);
  };
  tag.unsafe = (text: string): RecordedQuery => ({ text, params: [] });
  // `sql.json(v)` của postgres.js đánh dấu tham số là jsonb và tự serialize. Bản giả giữ nguyên
  // giá trị để test khẳng định được cái gì thật sự được gửi đi.
  tag.json = (value: unknown): unknown => value;
  // `sql.begin(fn)` của postgres.js chạy fn với client trong transaction; bản giả chạy ngay với
  // chính tag này — đủ để khẳng định thứ tự và nội dung câu lệnh, không giả lập rollback.
  tag.begin = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tag);
  return { sql: tag as unknown as ReturnType<typeof getSql>, calls };
}
