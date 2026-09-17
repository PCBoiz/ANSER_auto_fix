import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { PART_CATEGORIES, PART_UNITS } from "@/server/domain";
import { requireUser } from "@/server/session";
import { listBranches } from "@/server/store/branches";
import { suggestNextCode } from "@/server/store/codes";
import {
  countParts,
  createPart,
  DuplicatePartCodeError,
  listPartCodes,
  listParts,
  type ListPartsOptions,
} from "@/server/store/parts";
import {
  optionalNonNegativeInt,
  optionalText,
  parseBody,
  requiredText,
  uuidField,
  vndAmount,
} from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);

    const limitParam = Number(url.searchParams.get("limit"));
    const offsetParam = Number(url.searchParams.get("offset"));

    const options: ListPartsOptions = {
      search: url.searchParams.get("search") ?? undefined,
      branchId: url.searchParams.get("branchId") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      missingPrice: url.searchParams.get("missingPrice") === "1",
      missingThreshold: url.searchParams.get("missingThreshold") === "1",
      limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : undefined,
      offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : undefined,
    };

    const [list, total, codes, branches] = await Promise.all([
      listParts(options),
      countParts(options),
      // Chỉ đọc cột `code`. Trước đây chỗ này gọi `listParts()` lần thứ hai không lọc,
      // kéo đủ 788 dòng kèm join branches qua mạng chỉ để suy ra mã kế tiếp.
      listPartCodes(),
      listBranches(),
    ]);

    return NextResponse.json({
      parts: list,
      total,
      branches,
      suggestedCode: suggestNextCode("PT", codes),
    });
  });
}

const createSchema = z.object({
  code: requiredText("Mã phụ tùng", 50).transform((v) => v.toUpperCase()),
  name: requiredText("Tên phụ tùng", 300),
  // Không ép `z.enum(PART_CATEGORIES)`: kho thật đã có nhóm "Đồng - Sơn" nhập từ Excel,
  // không nằm trong danh sách gợi ý. Ép cứng sẽ chặn chính dữ liệu đang dùng.
  category: requiredText("Nhóm phụ tùng", 100),
  branchId: uuidField,
  oemNumber: optionalText(100),
  unit: z.string().trim().max(20).optional().transform((v) => v || PART_UNITS[0]),
  price: vndAmount.optional(),
  // `null` = chưa biết giá vốn, khác hẳn 0 = không tốn đồng nào.
  cost: optionalNonNegativeInt.optional(),
  minStock: optionalNonNegativeInt.optional(),
  location: optionalText(100),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    try {
      const part = await createPart({
        code: body.code,
        name: body.name,
        category: body.category || PART_CATEGORIES[0],
        branchId: body.branchId,
        oemNumber: body.oemNumber,
        unit: body.unit,
        price: body.price ?? 0,
        cost: body.cost ?? null,
        minStock: body.minStock ?? null,
        location: body.location,
      });
      return NextResponse.json({ part }, { status: 201 });
    } catch (error) {
      if (error instanceof DuplicatePartCodeError) return conflict(error.message);
      throw error;
    }
  });
}
