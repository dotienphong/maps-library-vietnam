# @mapslibvn/ui

Bộ giao diện dùng chung cho `apps/admin` và `apps/console` (và `tokens.css` cho `apps/site`).
Package nội bộ, không publish, không build: app import thẳng `src/index.ts`, Vite biên dịch.

Hai việc app dùng package PHẢI làm trong CSS gốc, sau `@import "tailwindcss"`:

```css
@import "../../../packages/ui/src/tokens.css";  /* @theme + biến màu; đường dẫn tương đối */
@source "../../../packages/ui/src";              /* Tailwind không quét node_modules — thiếu dòng này nút mất kiểu mà không có lỗi */
```

Ranh giới: package không biết fetcher, router hay API của app nào. `ErrorState` nhận lỗi bất kỳ
và đọc `status`/`code`/`message` nếu có (`isApiErrorLike`); `DelayedActionProvider` nhận
`reloadGuard` để app nối với fetcher của mình; `theme` nhận `storageKey` để hai app không kéo
theme của nhau.
