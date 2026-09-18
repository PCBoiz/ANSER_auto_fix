import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chỉ khi dựng image Docker (Dockerfile đặt NEXT_OUTPUT=standalone): gói server tối thiểu
  // chạy bằng `node server.js`, không cần node_modules đầy đủ. Máy dev và Vercel giữ nguyên.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
