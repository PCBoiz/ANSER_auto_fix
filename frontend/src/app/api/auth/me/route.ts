import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authCookieOptions, COOKIE_NAME, signToken } from "@/server/auth";
import { badRequest, handle, unauthorized } from "@/server/api";
import { getSessionUser, resolveUserFlow } from "@/server/session";
import { parseBody, passwordField, requiredText } from "@/server/validation";
import { toPublicUser, updateUser } from "@/server/store/users";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    if (!user) return unauthorized();
    return NextResponse.json({
      user: toPublicUser(user),
      flow: await resolveUserFlow(user),
      mustChangePassword: user.mustChangePassword,
    });
  });
}

// `phone` cố tình KHÔNG dùng `optionalText()`: helper đó gộp "không gửi trường" và "gửi
// chuỗi rỗng" thành cùng một `null`, nên không phân biệt được "giữ nguyên số cũ" với
// "xoá số điện thoại đi". Ở đây `undefined` = không đụng tới, `null`/`""` = xoá.
const profileSchema = z.object({
  firstName: requiredText("Tên", 100).optional(),
  lastName: requiredText("Họ", 100).optional(),
  phone: z.union([z.string().max(30), z.null()]).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordField.optional(),
});

// Sửa hồ sơ của chính mình: tên/SĐT và/hoặc đổi mật khẩu.
//
// Dùng `getSessionUser()` chứ KHÔNG `requireUser()`: `requireUser()` chặn tài khoản đang
// mang mật khẩu tạm chưa đổi, mà route này chính là chỗ họ đổi. Chặn ở đây là khoá người
// dùng vĩnh viễn ở ngoài hệ thống của họ.
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const parsed = await parseBody(request, profileSchema);
    if (!parsed.ok) return parsed.response;
    const { firstName, lastName, phone, currentPassword, newPassword } = parsed.data;

    const patch: Parameters<typeof updateUser>[1] = {};
    if (firstName) patch.firstName = firstName;
    if (lastName) patch.lastName = lastName;
    if (phone !== undefined) patch.phone = typeof phone === "string" ? phone.trim() || null : null;

    let passwordChanged = false;
    if (newPassword) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return badRequest("Mật khẩu hiện tại không đúng.");
      }
      // Đặt lại đúng mật khẩu cũ thì coi như chưa đổi gì — người đang bị ép đổi mật khẩu
      // tạm sẽ lách được bằng cách gõ lại chính nó, và cờ `mustChangePassword` bị xoá
      // trong khi mật khẩu vẫn là chuỗi đã đi qua tin nhắn/điện thoại.
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        return badRequest("Mật khẩu mới phải khác mật khẩu hiện tại.");
      }
      patch.passwordHash = await bcrypt.hash(newPassword, 10);
      patch.mustChangePassword = false;
      passwordChanged = true;
    }

    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const updated = await updateUser(user.id, patch);

    // Cấp lại cookie sau khi đổi mật khẩu: token cũ mang cờ `mcp` (phải đổi mật khẩu) và
    // `proxy.ts` đọc cờ đó để chặn. Không ký lại thì người vừa đổi xong vẫn bị đá về
    // trang đổi mật khẩu cho tới khi token hết hạn — 7 ngày sau.
    if (passwordChanged) {
      const cookieStore = await cookies();
      cookieStore.set(COOKIE_NAME, signToken(user.id), authCookieOptions);
    }

    return NextResponse.json({ user: updated ? toPublicUser(updated) : null, passwordChanged });
  });
}
