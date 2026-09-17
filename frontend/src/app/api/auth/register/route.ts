import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authCookieOptions, COOKIE_NAME, signToken } from "@/server/auth";
import { conflict, forbidden, handle } from "@/server/api";
import { emailField, optionalText, parseBody, passwordField, requiredText } from "@/server/validation";
import { countUsers, createUser, findUserByEmail, toPublicUser } from "@/server/store/users";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  firstName: requiredText("Tên", 100),
  lastName: requiredText("Họ", 100),
  email: emailField,
  phone: optionalText(30),
  password: passwordField,
});

/**
 * Tạo tài khoản.
 *
 * LỖ HỔNG ĐÃ VÁ (17/09/2026): route này trước đây hoàn toàn mở. Bất kỳ ai biết URL đều
 * tạo được tài khoản `staff` và nhận cookie phiên ngay lập tức. Mà `resolveUserFlow()`
 * trả `"manager"` cho tài khoản staff chưa liên kết nhân sự (mặc định để không làm mất
 * menu của tài khoản cũ), nên người lạ đó thấy đủ menu; và 44/51 route chỉ yêu cầu
 * `requireUser()`, nghĩa là đọc/ghi được khách hàng, xe, lệnh sửa chữa, hoá đơn, kho và
 * sổ kế toán. Trên localhost thì vô hại; deploy ra Internet là mất sạch dữ liệu gara.
 *
 * Nay chỉ mở trong ĐÚNG hai trường hợp:
 *
 *  1. DB chưa có tài khoản nào — người cài đặt cần một cách tạo chủ tài khoản đầu tiên.
 *     Người này thành `admin` (không phải `staff`): họ là chủ hệ thống, không phải khách
 *     vãng lai. Cửa sổ này tự đóng ngay khi có tài khoản đầu tiên.
 *
 *  2. `ALLOW_PUBLIC_REGISTER=true` được đặt tường minh trong env — dành cho môi trường
 *     demo/thử nghiệm. Phải tự bật, không phải mặc định.
 *
 * Ngoài hai trường hợp đó, tài khoản do quản trị viên cấp qua `POST /api/users`
 * (`requireAdmin()`), kèm mật khẩu tạm bắt buộc đổi ở lần đăng nhập đầu.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const existingUsers = await countUsers();
    const isBootstrap = existingUsers === 0;
    const publicRegisterEnabled = process.env.ALLOW_PUBLIC_REGISTER === "true";

    if (!isBootstrap && !publicRegisterEnabled) {
      return forbidden(
        "Hệ thống không mở đăng ký công khai. Liên hệ quản trị viên của gara để được cấp tài khoản.",
      );
    }

    const parsed = await parseBody(request, registerSchema);
    if (!parsed.ok) return parsed.response;
    const { firstName, lastName, email, phone, password } = parsed.data;

    if (await findUserByEmail(email)) {
      return conflict("Email đã được sử dụng.");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser({
      firstName,
      lastName,
      email,
      phone: phone ?? undefined,
      passwordHash,
      // Người cài đặt đầu tiên là chủ hệ thống. Ở chế độ demo (`ALLOW_PUBLIC_REGISTER`)
      // thì vẫn chỉ là `staff` như cũ.
      role: isBootstrap ? "admin" : "staff",
      // Mật khẩu do chính họ chọn, không phải mật khẩu tạm — không cần ép đổi.
      mustChangePassword: false,
    });

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, signToken(user.id), authCookieOptions);

    return NextResponse.json(
      { user: toPublicUser(user), bootstrap: isBootstrap },
      { status: 201 },
    );
  });
}
