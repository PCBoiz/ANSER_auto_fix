import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, forbidden, handle, unauthorized } from "@/server/api";
import { BRANCH_SPECIALTIES } from "@/server/domain";
import { requireManager, requireUser } from "@/server/session";
import { optionalEmail, optionalText, parseBody, requiredText } from "@/server/validation";
import { createBranch, listBranches } from "@/server/store/branches";

export const dynamic = "force-dynamic";

const branchSchema = z.object({
  name: requiredText("Tên chi nhánh", 120),
  address: optionalText(300),
  phone: optionalText(30),
  // Chuỗi tự do không được: cả gợi ý xưởng lẫn bộ lọc đều so khớp đúng giá trị này.
  specialty: z.union([z.enum(BRANCH_SPECIALTIES), z.literal(""), z.null()], { message: "Chuyên môn không nằm trong danh sách." }).optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  notificationEmail: optionalEmail,
});

export async function GET() {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    return NextResponse.json({ branches: await listBranches() });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới tạo được chi nhánh.");

    const parsed = await parseBody(request, branchSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const branch = await createBranch(parsed.data);
      return NextResponse.json({ branch }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message.includes("đã tồn tại")) {
        return conflict(error.message);
      }
      throw error;
    }
  });
}
