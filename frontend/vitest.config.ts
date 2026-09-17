import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Test chỉ nhắm vào các module THUẦN (không import db, không import next/*): số thành chữ,
// lược đồ zod, đọc file Excel, thoát HTML, nhận diện tên thiếu dấu. Những module chạm DB
// được kiểm tra bằng script mô phỏng trên DB thật (xem ARCHITECTURE.md §11.4) — dựng một
// Postgres giả cho vài hàm không đáng chi phí bảo trì.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
