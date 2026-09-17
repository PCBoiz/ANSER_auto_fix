<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ANSER Auto — lưu ý riêng của project

- Đọc `../ARCHITECTURE.md` trước khi sửa schema hoặc thêm nghiệp vụ: nó giải thích **vì sao**
  từng bảng được tách như hiện tại (đặc biệt `service_order_labors` vs `service_order_parts`).
- Tiền tệ lưu bằng **số nguyên VND** (`integer`), không dùng float. Số km cũng là `integer`.
- Cột giá vốn (`cost`, `unit_cost`) **nullable có chủ đích**: `null` = chưa biết, khác hẳn `0`.
- `middleware.ts` đã bị đổi tên thành `proxy.ts` ở bản Next.js này (xem `src/proxy.ts`).
