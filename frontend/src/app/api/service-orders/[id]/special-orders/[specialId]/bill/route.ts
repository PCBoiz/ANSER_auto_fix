import { after, NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { syncRevenueIncidentsSafe } from "@/server/revenueGuard";
import { billSpecialOrder, SpecialOrderStateError } from "@/server/store/specialOrders";
import { parseBody, vndAmount } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; specialId: string }> };

const billSchema = z.object({ sellPrice: vndAmount });

// Chuyển khoản đặt ngoài đã về hàng thành 1 dòng phụ tùng thật trên lệnh — điểm DUY NHẤT
// nó bắt đầu tính vào tổng tiền. Xem lý do tách hành động này ra riêng trong specialOrders.ts.
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { specialId } = await params;

    const parsed = await parseBody(request, billSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const line = await billSpecialOrder(specialId, parsed.data);
      after(syncRevenueIncidentsSafe);
      return NextResponse.json({ line }, { status: 201 });
    } catch (error) {
      if (error instanceof SpecialOrderStateError) return conflict(error.message);
      throw error;
    }
  });
}
