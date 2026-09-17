import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { createSpecialOrder, listSpecialOrders } from "@/server/store/specialOrders";
import { optionalNonNegativeInt, optionalText, parseBody, positiveQuantity, requiredText } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    return NextResponse.json({ specialOrders: await listSpecialOrders(id) });
  });
}

const createSchema = z.object({
  name: requiredText("Tên phụ tùng cần đặt", 300),
  supplier: optionalText(200),
  unit: z.string().trim().max(20).optional().transform((v) => v || "Cái"),
  quantity: positiveQuantity.default(1),
  // null = chưa biết giá lúc đặt, khác 0.
  estimatedCost: optionalNonNegativeInt.optional(),
  note: optionalText(1000),
});

// Ghi nhận một khoản phụ tùng phải đặt ngoài (không có sẵn trong kho) cho lệnh này.
// Chưa tính vào tổng tiền lệnh — chỉ tính khi hàng về và được "tính vào hoá đơn"
// (POST .../special-orders/[specialId]/bill). Xem chú thích bảng trong schema.ts.
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const specialOrder = await createSpecialOrder({
      serviceOrderId: id,
      name: body.name,
      supplier: body.supplier,
      unit: body.unit,
      quantity: body.quantity,
      estimatedCost: body.estimatedCost ?? null,
      note: body.note,
    });

    return NextResponse.json({ specialOrder }, { status: 201 });
  });
}
