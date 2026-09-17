import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { cancelSpecialOrder, markArrived, SpecialOrderStateError } from "@/server/store/specialOrders";
import { optionalNonNegativeInt, parseBody } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; specialId: string }> };

const patchSchema = z.object({
  status: z.enum(["arrived", "cancelled"], {
    message: 'Chỉ nhận status "arrived" hoặc "cancelled" ở endpoint này.',
  }),
  actualCost: optionalNonNegativeInt.optional(),
});

// Chỉ dùng để đổi trạng thái (đã về hàng / huỷ) — chuyển thành dòng phụ tùng thật trên
// hoá đơn là một hành động riêng, xem POST .../special-orders/[specialId]/bill.
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { specialId } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    try {
      const specialOrder =
        body.status === "arrived"
          ? await markArrived(specialId, { actualCost: body.actualCost ?? null })
          : await cancelSpecialOrder(specialId);
      return NextResponse.json({ specialOrder });
    } catch (error) {
      if (error instanceof SpecialOrderStateError) return conflict(error.message);
      throw error;
    }
  });
}
