import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LoadingSkeleton } from '@/components/states';
import { Card, CardMuted, CardTitle } from '@/components/ui/card';

export interface OProps {
  ten: string;
  den: string;
  so?: ReactNode;
  phu?: ReactNode;
  dangTai?: boolean;
  loi?: boolean;
}

/**
 * Một ô số liệu của Tổng quan. Ba trạng thái tách bạch, và ô nào cũng tự chịu trạng thái của
 * mình: một API chết chỉ làm hỏng ô của nó, không làm trắng trang đích.
 *
 * Lúc đang tải KHÔNG hiện 0. "Không có đóng góp nào chờ duyệt" và "chưa biết có bao nhiêu" là hai
 * câu trả lời khác hẳn nhau, và cái sai ở đây khiến người trực bỏ qua việc cần làm.
 */
export function O({ ten, den, so, phu, dangTai, loi }: OProps) {
  return (
    <Card interactive>
      <CardTitle>
        {/* Link thật phủ cả thẻ: bàn phím và trình đọc màn hình tới được, và người dùng xem trước
            được đích đến ở thanh trạng thái trình duyệt. */}
        <Link to={den} className="after:absolute after:inset-0 after:content-['']">
          {ten}
        </Link>
      </CardTitle>
      {dangTai && <LoadingSkeleton rows={1} />}
      {!dangTai && loi && <CardMuted>Không đọc được số liệu</CardMuted>}
      {!dangTai && !loi && (
        <>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{so}</p>
          {phu && <CardMuted>{phu}</CardMuted>}
        </>
      )}
    </Card>
  );
}
