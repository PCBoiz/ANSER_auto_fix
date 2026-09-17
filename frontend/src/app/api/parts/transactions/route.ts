import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import {
  createPartTransaction,
  InsufficientStockError,
  listPartTransactions,
} from "@/server/store/parts";
import { optionalNonNegativeInt, optionalText, parseBody, positiveQuantity, uuidField } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    return NextResponse.json({
      transactions: await listPartTransactions({
        partId: url.searchParams.get("partId") ?? undefined,
        limit: Number(url.searchParams.get("limit")) || 100,
      }),
    });
  });
}

const createSchema = z.object({
  partId: uuidField,
  type: z.enum(["import", "export"], { message: "Loại phiếu phải là nhập hoặc xuất." }),
  quantity: positiveQuantity,
  // null = không ghi giá lô này (khác 0 = nhập miễn phí). Chỉ phiếu NHẬP có giá mới cập nhật
  // giá vốn hiện hành của phụ tùng.
  unitCost: optionalNonNegativeInt.optional(),
  counterparty: optionalText(200),
  note: optionalText(1000),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    try {
      const transaction = await createPartTransaction({
        partId: body.partId,
        type: body.type,
        quantity: body.quantity,
        unitCost: body.unitCost ?? null,
        counterparty: body.counterparty,
        note: body.note,
      });
      return NextResponse.json({ transaction }, { status: 201 });
    } catch (error) {
      if (error instanceof InsufficientStockError) return conflict(error.message);
      throw error;
    }
  });
}
