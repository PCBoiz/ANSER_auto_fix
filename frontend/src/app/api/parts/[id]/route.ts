import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, notFound, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import {
  deletePart,
  DuplicatePartCodeError,
  getPartById,
  listPartTransactions,
  updatePart,
  type PartInput,
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

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    const part = await getPartById(id);
    if (!part) return notFound("Không tìm thấy phụ tùng.");
    return NextResponse.json({
      part,
      transactions: await listPartTransactions({ partId: id, limit: 50 }),
    });
  });
}

// `stock` cố ý KHÔNG có ở đây: tồn kho chỉ đổi qua phiếu nhập/xuất (xem createPart).
const patchSchema = z.object({
  code: requiredText("Mã phụ tùng", 50).transform((v) => v.toUpperCase()).optional(),
  name: requiredText("Tên phụ tùng", 300).optional(),
  category: requiredText("Nhóm phụ tùng", 100).optional(),
  branchId: uuidField.optional(),
  unit: requiredText("Đơn vị", 20).optional(),
  oemNumber: optionalText(100).optional(),
  location: optionalText(100).optional(),
  price: vndAmount.optional(),
  cost: optionalNonNegativeInt.optional(),
  minStock: optionalNonNegativeInt.optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;

    // Chỉ giữ trường có gửi lên (undefined = giữ nguyên).
    const patch: Partial<PartInput> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    try {
      const part = await updatePart(id, patch);
      if (!part) return notFound("Không tìm thấy phụ tùng.");
      return NextResponse.json({ part });
    } catch (error) {
      if (error instanceof DuplicatePartCodeError) return conflict(error.message);
      throw error;
    }
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    if (!(await getPartById(id))) return notFound("Không tìm thấy phụ tùng.");

    // Có lịch sử nhập/xuất thì không cho xoá: `part_transactions.partId` là cascade nên
    // xoá phụ tùng sẽ xoá sạch lịch sử kho theo — mất dấu vết của hàng đã thực sự luân
    // chuyển, và không có cách nào lấy lại.
    const history = await listPartTransactions({ partId: id, limit: 1 });
    if (history.length > 0) {
      return conflict(
        "Phụ tùng này đã có lịch sử nhập/xuất kho nên không xoá được — xoá sẽ mất luôn lịch sử. Hãy đặt tồn về 0 nếu không dùng nữa.",
      );
    }

    await deletePart(id);
    return new NextResponse(null, { status: 204 });
  });
}
