import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Cả thẻ mở được một thứ gì đó. Thẻ nổi lên khi rê chuột và lún lại khi bấm, để người dùng thấy
   * nó bấm được trước khi thử — trên điện thoại thì thẻ là hình dạng chính của mọi danh sách.
   *
   * Đi kèm một nút thật phủ toàn thẻ (`after:inset-0`), không phải `onClick` trên div: trình đọc
   * màn hình và bàn phím cần một phần tử có vai trò nút để tới được.
   */
  interactive?: boolean;
}

export function Card({ className, interactive, ...props }: CardProps) {
  return (
    <div
      {...(interactive ? { 'data-card': 'interactive' } : {})}
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4',
        interactive && [
          // `relative` là mốc cho nút phủ toàn thẻ; thiếu nó vùng bấm nhảy ra phần tử định vị
          // gần nhất phía trên.
          'relative transition duration-150 ease-out',
          // Nổi khối: dịch lên nửa bậc + bóng đổ. Bóng đen gần như vô hình trên nền tối, nên viền
          // đổi màu thương hiệu là tín hiệu chính ở bản tối, bóng chỉ là phần thêm.
          'hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-lg',
          // Bấm xuống thì lún lại: cử chỉ có phản hồi hai chiều mới giống một khối thật.
          'active:translate-y-0 active:shadow-sm active:duration-75',
          // Bàn phím thấy đúng thứ chuột thấy, vì tiêu điểm rơi vào nút bên trong chứ không vào thẻ.
          'has-[:focus-visible]:-translate-y-0.5 has-[:focus-visible]:border-brand-500 has-[:focus-visible]:shadow-lg',
          // Ai tắt hiệu ứng chuyển động thì chỉ còn đổi màu viền và bóng, thẻ đứng yên.
          'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:has-[:focus-visible]:translate-y-0',
        ],
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold', className)} {...props} />;
}

export function CardMuted({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-[var(--text-muted)]', className)} {...props} />;
}
