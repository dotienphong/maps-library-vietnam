// Kéo kiểu matcher của jest-dom (toBeVisible, toHaveAttribute…) vào chương trình typecheck của
// package. Lúc chạy, root vitest nạp matcher qua apps/admin/src/test-setup.ts; file này chỉ lo kiểu.
import '@testing-library/jest-dom/vitest';
