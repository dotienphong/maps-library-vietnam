import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

// min-h-11 = 44px: ngưỡng vùng chạm tối thiểu trên điện thoại, áp cho mọi biến thể.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white hover:bg-brand-800',
        secondary:
          'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-brand-50 dark:hover:bg-brand-900',
        ghost: 'text-[var(--text-muted)] hover:bg-brand-50 dark:hover:bg-brand-900',
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
