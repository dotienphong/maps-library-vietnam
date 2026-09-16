// setupFiles áp cho MỌI file test của bộ gốc, kể cả scripts/**/*.test.mjs chạy trong Node.
// jest-dom cần `document`, nên chỉ nạp khi thật sự đang ở môi trường jsdom.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  // Testing Library chỉ tự dọn DOM giữa các test khi vitest bật `globals: true`. Bộ test này
  // không bật (và không nên bật vì còn chạy scripts/**/*.test.mjs trên Node), nên phải đăng ký
  // cleanup bằng tay — thiếu nó thì render của test trước còn nguyên và getByRole thấy hai nút.
  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');
  afterEach(cleanup);
}

// `export {}` là bắt buộc: không có import/export ở cấp cao nhất thì TypeScript coi đây là script
// chứ không phải module, và `await` cấp cao nhất bị từ chối.
export {};
