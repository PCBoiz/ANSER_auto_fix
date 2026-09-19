import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authCookieOptions, COOKIE_NAME, signToken } from "@/server/auth";
import { apiError, handle, unauthorized } from "@/server/api";
import { checkLoginAllowed, clientIpOf, recordLoginAttempt } from "@/server/loginThrottle";
import { resolveUserFlow } from "@/server/session";
import { parseBody } from "@/server/validation";
import { findUserByEmail, toPublicUser, touchLastLogin } from "@/server/store/users";

export const dynamic = "force-dynamic";

// Không dùng `passwordField` (tối thiểu 8 ký tự) ở đây: đó là quy tắc cho việc ĐẶT mật
// khẩu mới. Lúc ĐĂNG NHẬP phải nhận mọi chuỗi, kể cả mật khẩu cũ 6 ký tự đặt từ trước —
// từ chối ngay ở tầng validate sẽ khoá luôn người dùng cũ ra ngoài hệ thống của họ.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Thiếu email.").max(255),
  password: z.string().min(1, "Thiếu mật khẩu.").max(200),
});

export async function POST(request: Request) {
  return handle(async () => {
    const parsed = await parseBody(request, loginSchema);
    if (!parsed.ok) return parsed.response;
    const { email, password } = parsed.data;

    const ip = clientIpOf(request);

    // Kiểm tra hạn mức TRƯỚC khi chạm bcrypt. So hash là thao tác cố tình chậm (~100ms);
    // để kẻ tấn công ép server chạy nó hàng nghìn lần cũng chính là một kiểu làm nghẽn.
    const verdict = await checkLoginAllowed(email, ip);
    if (verdict.blocked) {
      return apiError(
        `Sai mật khẩu quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(verdict.retryAfterSeconds / 60)} phút.`,
        429,
      );
    }

    const user = await findUserByEmail(email);
    // So sánh hash kể cả khi không tìm thấy user sẽ tốt hơn về mặt timing attack, nhưng
    // ở quy mô này ưu tiên giữ code đọc thẳng — chống dò mật khẩu đã có rate-limit
    // (`loginThrottle.ts`) lo, và đó mới là lớp thật sự chặn được.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await recordLoginAttempt(email, ip, false);
      return unauthorized("Email hoặc mật khẩu không đúng.");
    }

    await recordLoginAttempt(email, ip, true);
    await touchLastLogin(user.id);

    const cookieStore = await cookies();
    cookieStore.set(
      COOKIE_NAME,
      signToken(user.id, { mustChangePassword: user.mustChangePassword }),
      authCookieOptions,
    );

    return NextResponse.json({
      user: toPublicUser(user),
      flow: await resolveUserFlow(user),
      // Client điều hướng thẳng sang trang đổi mật khẩu thay vì để người dùng vào
      // dashboard rồi mới bị chặn — mật khẩu tạm do quản lý đọc qua điện thoại không
      // được phép sống quá phiên đầu tiên.
      mustChangePassword: user.mustChangePassword,
    });
  });
}
