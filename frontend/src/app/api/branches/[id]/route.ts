import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, forbidden, handle, notFound, unauthorized } from "@/server/api";
import { BRANCH_SPECIALTIES } from "@/server/domain";
import { requireManager, requireUser } from "@/server/session";
import { optionalEmail, optionalText, parseBody, requiredText } from "@/server/validation";
import {
  deleteBranch,
  findBranchBlockers,
  getBranchById,
  updateBranch,
} from "@/server/store/branches";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// `.partial()` không dùng được ở đây: ta cần phân biệt "không gửi trường" (giữ nguyên)
// với "gửi null" (xoá giá trị), nên từng trường tự khai `.optional()` và giữ null.
const patchSchema = z.object({
  name: requiredText("Tên chi nhánh", 120).optional(),
  address: optionalText(300).optional(),
  phone: optionalText(30).optional(),
  specialty: z.union([z.enum(BRANCH_SPECIALTIES), z.literal(""), z.null()]).optional(),
  notificationEmail: optionalEmail.optional(),
});

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    const branch = await getBranchById(id);
    if (!branch) return notFound("Không tìm thấy chi nhánh.");
    return NextResponse.json({ branch });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới sửa được chi nhánh.");

    const { id } = await params;
    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Chỉ đưa vào patch những field thực sự có mặt: Drizzle `.set({})` với toàn undefined
    // sinh câu UPDATE rỗng và ném lỗi.
    const patch: Parameters<typeof updateBranch>[1] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.address !== undefined) patch.address = body.address;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.specialty !== undefined) patch.specialty = body.specialty || null;
    if (body.notificationEmail !== undefined) patch.notificationEmail = body.notificationEmail;
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const branch = await updateBranch(id, patch);
    if (!branch) return notFound("Không tìm thấy chi nhánh.");
    return NextResponse.json({ branch });
  });
}

// Xoá chi nhánh — chỉ khi nó chưa dính gì tới nghiệp vụ. Chi nhánh đóng luôn vai trò kho
// phụ tùng và là nơi tiếp nhận xe, nên xoá một chi nhánh đang hoạt động sẽ kéo theo cả
// kho lẫn lịch sử của nó.
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới xoá được chi nhánh.");

    const { id } = await params;
    const branch = await getBranchById(id);
    if (!branch) return notFound("Không tìm thấy chi nhánh.");

    const blockers = await findBranchBlockers(id);
    if (blockers.length > 0) {
      return conflict(
        `Chi nhánh "${branch.name}" đang gắn với ${blockers.join(", ")}. Hãy chuyển hoặc xoá những dữ liệu đó trước.`,
      );
    }

    await deleteBranch(id);
    return NextResponse.json({ ok: true });
  });
}
