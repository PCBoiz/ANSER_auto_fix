import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/server/auth";

// LƯU Ý: ở bản Next.js này `middleware.ts` đã bị đổi tên thành `proxy.ts` (hàm export
// cũng đổi từ `middleware` thành `proxy`) — xem
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
//
// Proxy chạy trên Node.js runtime (mặc định từ v16), nên verify được chữ ký JWT tại
// đây chứ không chỉ kiểm tra "có cookie hay không".
//
// Đây CHỈ là lớp chặn ngoài cùng cho trải nghiệm điều hướng. Không được coi nó là lớp
// bảo vệ duy nhất: một lần sửa `matcher` là mất sạch mà không lỗi nào nổ ra. Mọi Route
// Handler đọc/ghi dữ liệu vẫn phải tự gọi `getSessionUser()`/`requireRole()`.
export const CHANGE_PASSWORD_PATH = "/doi-mat-khau";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? verifyToken(token) : null;

  if (payload) {
    // Mật khẩu tạm chưa đổi: đẩy về trang đổi mật khẩu thay vì cho vào dashboard. Trang
    // đó nằm NGOÀI /dashboard (không khớp `matcher` bên dưới) nên không tạo vòng lặp
    // chuyển hướng — đó là lý do nó không đặt trong /dashboard cho gọn.
    if (payload.mcp) {
      return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url));
    }
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  // Giữ lại đích đến để đăng nhập xong quay về đúng trang đang muốn vào.
  loginUrl.searchParams.set("next", request.nextUrl.pathname);

  const response = NextResponse.redirect(loginUrl);
  // Cookie hết hạn/sai chữ ký thì xoá luôn, tránh vòng lặp chuyển hướng khi người dùng
  // bấm back rồi vào lại.
  if (token) response.cookies.delete(COOKIE_NAME);
  return response;
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
};
