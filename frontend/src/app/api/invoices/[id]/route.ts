import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, notFound, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { PAYMENT_METHODS } from "@/server/domain";
import { parseBody, vndAmount } from "@/server/validation";
import { recordPayment } from "@/server/store/invoices";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Ghi nhận thanh toán. `paidAmount` là số đã thu LUỸ KẾ (xem `recordPayment`).
// `paidAmount` là số đã thu LUỸ KẾ, không phải số cộng thêm — xem recordPayment().
const paymentSchema = z.object({
  paidAmount: vndAmount,
  paymentMethod: z.enum(PAYMENT_METHODS, { message: "Hình thức thanh toán không hợp lệ." }).nullable().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, paymentSchema);
    if (!parsed.ok) return parsed.response;

    const invoice = await recordPayment(id, {
      paidAmount: parsed.data.paidAmount,
      paymentMethod: parsed.data.paymentMethod ?? null,
    });
    if (!invoice) return notFound("Không tìm thấy hoá đơn.");
    return NextResponse.json({ invoice });
  });
}
