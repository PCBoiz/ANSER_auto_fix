import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chỉ khi dựng image Docker (Dockerfile đặt NEXT_OUTPUT=standalone): gói server tối thiểu
  // chạy bằng `node server.js`, không cần node_modules đầy đủ. Máy dev và Vercel giữ nguyên.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Thư mục build riêng cho git hook (NEXT_DIST_DIR=.next-hook). Trên Windows, `npm run build`
  // chạy trong lúc `npm run dev` đang mở sẽ tranh file trong .next và đỏ ngẫu nhiên — đã gặp
  // đúng một lần khi push. Cho hook build sang chỗ khác là hết tranh.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
