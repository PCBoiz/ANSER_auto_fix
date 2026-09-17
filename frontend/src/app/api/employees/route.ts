import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, handle, unauthorized } from "@/server/api";
import { requireManager, requireUser } from "@/server/session";
import {
  optionalDate,
  optionalEmail,
  optionalNonNegativeInt,
  optionalText,
  optionalUuid,
  parseBody,
  requiredText,
} from "@/server/validation";
import { createEmployee, listEmployees } from "@/server/store/employees";

export const dynamic = "force-dynamic";

// Đọc thì mọi người dùng đã đăng nhập đều được: danh sách nhân sự là dropdown chọn cố vấn
// dịch vụ / kỹ thuật viên trên lệnh sửa chữa, chặn ở đây là chặn luôn việc giao việc.
export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    return NextResponse.json({
      employees: await listEmployees({
        branchId: url.searchParams.get("branchId") ?? undefined,
        activeOnly: url.searchParams.get("activeOnly") === "1",
      }),
    });
  });
}

const createSchema = z.object({
  name: requiredText("Tên nhân sự", 200),
  position: optionalText(100),
  specialty: optionalText(100),
  // Đơn giá công VND/giờ — null = chưa khai, khác 0.
  hourlyCost: optionalNonNegativeInt.optional(),
  phone: optionalText(30),
  email: optionalEmail,
  hireDate: optionalDate,
  branchId: optionalUuid,
  note: optionalText(2000),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới thêm được nhân sự.");

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const employee = await createEmployee({ ...body, hourlyCost: body.hourlyCost ?? null });
    return NextResponse.json({ employee }, { status: 201 });
  });
}
