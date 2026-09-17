import jwt from "jsonwebtoken";

const FALLBACK_SECRET = "dev-secret-change-me";

export const COOKIE_NAME = "anser_auto_token";

// Kiểm tra LÚC DÙNG, không phải lúc import module: `next build` chạy với
// NODE_ENV=production và import mọi route để thu thập metadata, nên throw ở tầng
// module sẽ làm build fail trên máy chưa có secret — dù không token nào được ký.
// Ở đây vẫn fail-fast đúng lúc quan trọng: mọi thao tác ký/verify token thật.
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production.");
  }
  return FALLBACK_SECRET;
}

// `mcp` = must change password. Nhét cờ này vào chính token để `proxy.ts` chặn được
// người dùng mang mật khẩu tạm mà KHÔNG phải truy vấn DB — proxy chạy trước mọi request
// vào /dashboard, thêm một round-trip tới Neon ở đó là cộng thẳng vào thời gian tải của
// từng trang. Cờ có thể cũ so với DB (token sống 7 ngày), nên nó chỉ dùng để điều hướng;
// hàng rào thật nằm ở `requireUser()` trong session.ts, nơi đọc giá trị mới nhất từ DB.
export type TokenPayload = { sub: string; mcp?: boolean };

export function signToken(userId: string, options?: { mustChangePassword?: boolean }) {
  const payload: TokenPayload = { sub: userId };
  if (options?.mustChangePassword) payload.mcp = true;
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload | null {
  // Lấy secret NGOÀI try: thiếu cấu hình là lỗi vận hành phải nổ ra, không được lẫn
  // vào nhánh "token không hợp lệ" khiến cả hệ thống lặng lẽ đăng xuất mọi người.
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret) as TokenPayload;
  } catch {
    return null;
  }
}

export const authCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  // Giây (không phải ms như res.cookie của Express).
  maxAge: 7 * 24 * 60 * 60,
};
