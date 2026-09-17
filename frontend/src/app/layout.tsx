import type { Metadata } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// FONT PHẢI CÓ SUBSET "vietnamese".
//
// Trước đây app dùng Geist với `subsets: ["latin"]`. Geist không có subset tiếng Việt
// (chỉ cyrillic/latin/latin-ext), và subset "latin" chỉ phủ Latin-1. Hệ quả: trong
// "Nguyễn Văn Hùng", chữ "ù" vẽ bằng Geist nhưng "ă" (Latin Extended-A) và "ễ" (Latin
// Extended Additional) rơi về font hệ thống — lẫn hai font NGAY GIỮA MỘT TỪ, trên toàn bộ
// giao diện của một phần mềm viết cho người Việt. Lỗi này không hiện trong build hay
// typecheck; chỉ thấy khi nhìn kỹ màn hình, và càng rõ khi in hoá đơn.
//
// Be Vietnam Pro do nhà thiết kế Việt Nam làm, dấu chồng (ệ, ở, ự) được căn riêng thay
// vì ghép máy móc. Không phải font biến thiên nên phải liệt kê đúng các độ đậm đang dùng
// (normal/medium/semibold/bold/extrabold trong Tailwind).
const sans = Be_Vietnam_Pro({
  variable: "--font-sans-vi",
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Mã chứng từ, biển số, số tiền dạng bảng. JetBrains Mono có subset tiếng Việt và chữ số
// rộng đều — cột tiền thẳng hàng mà không cần `tabular-nums`.
const mono = JetBrains_Mono({
  variable: "--font-mono-vi",
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ANSER Auto",
  description: "Nền tảng điều hành gara dịch vụ sửa chữa ô tô.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
