import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, forbidden, handle, notFound, unauthorized } from "@/server/api";
import { requireManager, requireUser } from "@/server/session";
import {
  optionalDate,
  optionalEmail,
  optionalNonNegativeInt,
  optionalText,
  optionalUuid,
  parseBody,
  pickDefined,
  requiredText,
} from "@/server/validation";
import {
  deleteEmployee,
  getEmployeeById,
  updateEmployee,
} from "@/server/store/employees";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: requiredText("Tên nhân sự", 200).optional(),
  position: optionalText(100).optional(),
  specialty: optionalText(100).optional(),
  hourlyCost: optionalNonNegativeInt.optional(),
  phone: optionalText(30).optional(),
  email: optionalEmail.optional(),
  hireDate: optionalDate.optional(),
  branchId: optionalUuid.optional(),
  active: z.boolean().optional(),
  note: optionalText(2000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới sửa được nhân sự.");

    const { id } = await params;
    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const patch = pickDefined(parsed.data);
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const employee = await updateEmployee(id, patch);
    if (!employee) return notFound("Không tìm thấy nhân sự.");
    return NextResponse.json({ employee });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới xoá được nhân sự.");

    const { id } = await params;
    if (!(await getEmployeeById(id))) return notFound("Không tìm thấy nhân sự.");

    try {
      await deleteEmployee(id);
      return new NextResponse(null, { status: 204 });
    } catch {
      // Nhân sự đã được gán vào dòng công hoặc là cố vấn của lệnh nào đó thì FK sẽ chặn
      // (`set null` chỉ áp cho một số quan hệ). Gợi ý cách đúng thay vì báo lỗi DB thô.
      return conflict(
        "Nhân sự này đang gắn với lệnh sửa chữa nên không xoá được. Hãy bỏ tick 'Đang làm việc' để ẩn khỏi danh sách phân công.",
      );
    }
  });
}
