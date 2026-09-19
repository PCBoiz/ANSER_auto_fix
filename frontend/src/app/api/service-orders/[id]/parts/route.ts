import { after, NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, notFound, unauthorized } from "@/server/api";
import { lineWarning } from "@/lib/revenueGuard";
import { requireUser } from "@/server/session";
import { syncRevenueIncidentsSafe } from "@/server/revenueGuard";
import { InsufficientStockError } from "@/server/store/parts";
import { addPart, CrossBranchError, OrderLockedError, OrderNotFoundError } from "@/server/store/serviceOrders";
import { parseBody, positiveQuantity, uuidField, vndAmount } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  partId: uuidField,
  quantity: positiveQuantity.default(1),
  // Không gửi -> lấy giá bán hiện tại của phụ tùng (addPart). Gửi 0 là bán 0đ có chủ đích.
  unitPrice: vndAmount.optional(),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const line = await addPart(id, parsed.data);
      // Cho thêm dòng 0đ / dưới giá vốn (không làm kẹt xưởng), nhưng nói ngay trên màn hình
      // và đưa lên chuông của quản lý — xem lib/revenueGuard.ts.
      const warning = lineWarning({
        kind: "part",
        name: line.name,
        unitPrice: line.unitPrice,
        unitCost: line.unitCost,
        quantity: line.quantity,
      });
      after(syncRevenueIncidentsSafe);
      return NextResponse.json({ line, warning }, { status: 201 });
    } catch (error) {
      if (error instanceof InsufficientStockError) return conflict(error.message);
      if (error instanceof CrossBranchError) return conflict(error.message);
      if (error instanceof OrderLockedError) return conflict(error.message);
      if (error instanceof OrderNotFoundError) return notFound(error.message);
      throw error;
    }
  });
}
