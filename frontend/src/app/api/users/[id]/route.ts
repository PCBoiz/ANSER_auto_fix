import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { badRequest, conflict, forbidden, handle, notFound, unauthorized } from "@/server/api";
import { getSessionUser, requireAdmin, requireUser } from "@/server/session";
import { optionalUuid, parseBody, passwordField } from "@/server/validation";
import {
  ASSIGNABLE_ROLES,
  countAdmins,
  deleteUser,
  findUserById,
  toPublicUser,
  updateUser,
} from "@/server/store/users";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES, { message: "Chỉ gán được vai trò staff hoặc manager qua đây." }).optional(),
  employeeId: optionalUuid,
  // Đặt lại mật khẩu hộ nhân viên quên mật khẩu. Luôn kèm cờ bắt buộc đổi: quản trị viên
  // biết chuỗi này, nên nó chỉ được sống tới lần đăng nhập kế tiếp.
  newPassword: passwordField.optional(),
});

// Đổi role (chỉ staff/manager — không thăng admin qua đây, xem ASSIGNABLE_ROLES),
// gán/gỡ hồ sơ nhân sự liên kết, hoặc đặt lại mật khẩu tạm. Đây là nơi DUY NHẤT quyết
// định một tài khoản vào luồng kế toán/KTV/quản lý nào — xem resolveUserFlow().
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const actor = await requireAdmin();
    if (!actor) return forbidden("Chỉ quản trị viên mới sửa được tài khoản.");

    const { id } = await params;
    const target = await findUserById(id);
    if (!target) return notFound("Không tìm thấy tài khoản.");

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const patch: Parameters<typeof updateUser>[1] = {};

    if (body.role !== undefined) {
      // `ASSIGNABLE_ROLES` chỉ có staff/manager, nên gán role qua đây cho một admin LUÔN
      // là hạ cấp. Hạ cấp quản trị viên cuối cùng là tự khoá mình ra khỏi trang Tài khoản,
      // Nhân sự và mọi thao tác cấp quyền — không ai còn sửa lại được từ trong giao diện.
      if (target.role === "admin" && (await countAdmins()) <= 1) {
        return conflict("Đây là quản trị viên duy nhất — hãy cấp quyền cho người khác trước khi hạ cấp.");
      }
      patch.role = body.role;
    }

    if (body.employeeId !== undefined) {
      const employeeId = body.employeeId;
      if (employeeId) {
        // Mỗi hồ sơ nhân sự chỉ nên gắn với đúng 1 tài khoản đăng nhập — gắn 2 tài
        // khoản vào cùng 1 nhân sự sẽ làm "khu vực nhận việc"/chấm công lẫn dữ liệu
        // của 2 người vào chung một luồng.
        const [taken] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.employeeId, employeeId))
          .limit(1);
        if (taken && taken.id !== id) {
          return conflict("Hồ sơ nhân sự này đã liên kết với một tài khoản khác.");
        }
      }
      patch.employeeId = employeeId;
    }

    if (body.newPassword) {
      patch.passwordHash = await bcrypt.hash(body.newPassword, 10);
      patch.mustChangePassword = true;
    }

    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const updated = await updateUser(id, patch);
    return NextResponse.json({ user: updated ? toPublicUser(updated) : null });
  });
}

/**
 * Xoá tài khoản đăng nhập.
 *
 * Trước đây `deleteUser()` đã có sẵn ở tầng store nhưng không route nào gọi tới, nên
 * 3 tài khoản test trong hệ thống này không có cách nào xoá được từ giao diện.
 *
 * Xoá tài khoản KHÔNG xoá hồ sơ nhân sự: đó là hai thứ khác nhau (`users` là cái để
 * đăng nhập, `employees` là con người có chấm công và giờ công). Người nghỉ việc thì
 * xoá tài khoản để họ hết vào được, nhưng giờ công đã làm vẫn phải còn để tính lương.
 */
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireAdmin())) return forbidden("Chỉ quản trị viên mới xoá được tài khoản.");

    const { id } = await params;
    const target = await findUserById(id);
    if (!target) return notFound("Không tìm thấy tài khoản.");

    // Tự xoá mình là mất phiên ngay giữa chừng và có thể là mất luôn quản trị viên cuối
    // cùng — chặn thẳng thay vì để người dùng tự phát hiện sau khi đã muộn.
    const me = await getSessionUser();
    if (me?.id === id) {
      return conflict("Không thể tự xoá tài khoản đang đăng nhập.");
    }

    if (target.role === "admin" && (await countAdmins()) <= 1) {
      return conflict("Đây là quản trị viên duy nhất — không xoá được, hệ thống sẽ không còn ai quản trị.");
    }

    await deleteUser(id);
    return NextResponse.json({ ok: true });
  });
}
