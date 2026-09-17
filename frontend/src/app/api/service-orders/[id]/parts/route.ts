import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, notFound, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
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
      return NextResponse.json({ line }, { status: 201 });
    } catch (error) {
      if (error instanceof InsufficientStockError) return conflict(error.message);
      if (error instanceof CrossBranchError) return conflict(error.message);
      if (error instanceof OrderLockedError) return conflict(error.message);
      if (error instanceof OrderNotFoundError) return notFound(error.message);
      throw error;
    }
  });
}
