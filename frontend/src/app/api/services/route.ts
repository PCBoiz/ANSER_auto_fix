import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { optionalText, parseBody, requiredText, vndAmount } from "@/server/validation";
import { suggestNextCode } from "@/server/store/codes";
import {
  createService,
  DuplicateServiceCodeError,
  listServiceCodes,
  listServices,
} from "@/server/store/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    const list = await listServices({
      search: url.searchParams.get("search") ?? undefined,
      activeOnly: url.searchParams.get("activeOnly") === "1",
    });
    // Trả kèm mã gợi ý để form không phải tự tính — mã do người dùng đặt, đây chỉ là
    // giá trị điền sẵn cho tiện (xem `suggestNextCode`). Chỉ đọc cột `code` thay vì gọi
    // `listServices()` lần thứ hai không lọc — cùng lỗi từng có ở /api/parts.
    return NextResponse.json({
      services: list,
      suggestedCode: suggestNextCode("DV", await listServiceCodes()),
    });
  });
}

const createSchema = z.object({
  code: requiredText("Mã dịch vụ", 30).transform((v) => v.toUpperCase()),
  name: requiredText("Tên hạng mục", 200),
  category: requiredText("Nhóm dịch vụ", 100),
  standardMinutes: z.coerce
    .number({ message: "Giờ công định mức không hợp lệ." })
    .int("Giờ công định mức tính bằng phút, số nguyên.")
    .positive("Giờ công định mức phải lớn hơn 0."),
  laborPrice: vndAmount.default(0),
  description: optionalText(2000),
  active: z.boolean().default(true),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const service = await createService(parsed.data);
      return NextResponse.json({ service }, { status: 201 });
    } catch (error) {
      if (error instanceof DuplicateServiceCodeError) return conflict(error.message);
      throw error;
    }
  });
}
