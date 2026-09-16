import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface DrawerProps {
  title: string;
  children: ReactNode;
}

/**
 * Ngăn kéo cho màn hình hẹp. Radix Dialog lo giam tiêu điểm, Esc, khoá cuộn nền và trả tiêu điểm
 * về nút mở. Trượt bằng `transform` chứ không animate `width`: animate width buộc trình duyệt
 * tính lại bố cục mỗi khung hình và giật trên máy yếu.
 */
export function Drawer({ title, children }: DrawerProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label="Mở menu điều hướng"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-btn)] text-white lg:hidden"
      >
        <span aria-hidden="true" className="flex flex-col gap-1">
          <span className="block h-0.5 w-4 rounded bg-current" />
          <span className="block h-0.5 w-4 rounded bg-current" />
          <span className="block h-0.5 w-4 rounded bg-current" />
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[82vw] overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl"
          aria-label={title}
        >
          <Dialog.Title className="px-2 pb-3 pt-1 text-base font-bold">Admin Page</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
