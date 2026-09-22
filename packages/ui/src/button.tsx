import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

// min-h-11 = 44px: ngưỡng vùng chạm tối thiểu trên điện thoại, áp cho mọi biến thể.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] px-4 text-sm font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  {
    variants: {
      variant: {
        // Chữ mực trên nền xanh chanh: 13:1. Hover tối nhẹ bằng brightness để không cần token thứ hai.
        primary: 'bg-accent text-accent-ink hover:brightness-95',
        secondary:
          'border border-border bg-surface text-text hover:border-border-strong hover:bg-accent-soft',
        ghost: 'text-muted hover:bg-accent-soft hover:text-text',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, block, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, block }), className)}
      {...props}
    />
  );
}
