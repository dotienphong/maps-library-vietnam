import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from './cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      tone: {
        brand: 'bg-accent-soft text-accent-text',
        neutral: 'bg-black/5 text-[var(--text-muted)] dark:bg-white/10',
        success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
        warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
        danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
