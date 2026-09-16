// setupFiles áp cho MỌI file test của bộ gốc, kể cả scripts/**/*.test.mjs chạy trong Node.
// jest-dom cần `document`, nên chỉ nạp khi thật sự đang ở môi trường jsdom.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

// `export {}` là bắt buộc: không có import/export ở cấp cao nhất thì TypeScript coi đây là script
// chứ không phải module, và `await` cấp cao nhất bị từ chối.
export {};
