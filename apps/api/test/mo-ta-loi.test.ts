import { describe, expect, it } from 'vitest';
import { moTaLoi } from '../src/errors';

describe('moTaLoi', () => {
  it('lấy message của Error thường', () => {
    expect(moTaLoi(new Error('email_send_failed_401'))).toBe('email_send_failed_401');
  });

  it('ghép code, bảng và ràng buộc mà driver Postgres gắn vào lỗi', () => {
    const loi = Object.assign(new Error('permission denied for table api_key'), {
      code: '42501',
      table_name: 'api_key',
      constraint_name: 'api_key_kind_check',
    });
    expect(moTaLoi(loi)).toBe(
      'permission denied for table api_key | code=42501 | bảng=api_key | ràng buộc=api_key_kind_check',
    );
  });

  it('KHÔNG đưa `detail` vào log — Postgres nhét nguyên dòng vi phạm vào đó', () => {
    const loi = Object.assign(new Error('vi phạm ràng buộc'), {
      code: '23514',
      detail: 'Failing row contains (uuid, khach-that@vidu.vn, abc123hash…).',
    });
    const ra = moTaLoi(loi);
    expect(ra).not.toContain('khach-that@vidu.vn');
    expect(ra).not.toContain('Failing row');
    expect(ra).toContain('code=23514');
  });

  it('lỗi không phải Error thì vẫn ra chuỗi, không ném', () => {
    expect(moTaLoi('hỏng')).toBe('hỏng');
    expect(moTaLoi(null)).toBe('null');
    expect(moTaLoi({ a: 1 })).toBe('[object Object]');
  });

  it('bỏ qua trường lạ kiểu không phải chuỗi', () => {
    const loi = Object.assign(new Error('x'), { code: 42501, constraint_name: null });
    expect(moTaLoi(loi)).toBe('x');
  });
});
