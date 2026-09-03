# Trang nhúng thử độc lập

Trang HTML trắng, **không thuộc `apps/docs` và không thuộc dự án nào khác**, dùng để chứng minh
SDK MapsLibVN nhúng được vào một trang bất kỳ ở origin riêng bằng khoá `web` có `allowed_origins`
đúng origin đó (nghiệm thu M5, spec mục 13 hàng M5).

```bash
pnpm example:embed        # phục vụ ở http://localhost:5500 và mở trình duyệt
```

Khoá đọc từ `KEY_EXAMPLE_EMBED` trong `.env` ở gốc repo, nên không cần gõ tay. Muốn thử khoá khác
mà không sửa `.env` thì thêm `--key mlv_live_…`.

Khoá **không** nằm trong repo: truyền qua tham số hoặc biến môi trường, và trang đọc nó từ query
string. Khoá phải có `http://localhost:5500` trong `allowed_origins`; cấp bằng:

```bash
pnpm db:seed-tenant db/seed/tenant_nhung_thu.sql
pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 \
  --label "embed-web thử độc lập" --kind web --origins http://localhost:5500
```
