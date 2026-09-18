// Kéo kiểu matcher của jest-dom (toBeVisible, toHaveAttribute…) vào chương trình typecheck của
// app. Lúc CHẠY, matcher được nạp qua apps/admin/src/test-setup.ts mà vitest gốc dùng chung cho
// mọi bộ test; file này chỉ lo phần kiểu. Cùng cách packages/ui đã làm.
import '@testing-library/jest-dom/vitest';
