import { after, NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { syncRevenueIncidentsSafe } from "@/server/revenueGuard";
import { PAYMENT_METHODS } from "@/server/domain";
import { optionalText, parseBody, uuidField, vndAmount } from "@/server/validation";
import {
  createInvoice,
  InvoiceExistsError,
  listInvoiceableOrders,
  listInvoices,
  OrderNotReadyError,
  ZeroPriceLinesError,
} from "@/server/store/invoices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    return NextResponse.json({
      invoices: await listInvoices({
        search: url.searchParams.get("search") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      }),
      invoiceableOrders: await listInvoiceableOrders(),
    });
  });
}

const createSchema = z.object({
  serviceOrderId: uuidField,
  // Không gửi -> lấy thuế suất mặc định trong Cài đặt (createInvoice).
  taxRate: z.coerce
    .number({ message: "Thuế suất không hợp lệ." })
    .int("Thuế suất là số nguyên phần trăm.")
    .min(0, "Thuế suất phải trong khoảng 0–100.")
    .max(100, "Thuế suất phải trong khoảng 0–100.")
    .optional(),
  paidAmount: vndAmount.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS, { message: "Hình thức thanh toán không hợp lệ." }).nullable().default(null),
  insuranceAmount: vndAmount.default(0),
  insuranceProvider: optionalText(200),
  note: optionalText(2000),
  // Lệnh còn dòng 0đ thì phải xác nhận mới lập được hoá đơn (xem createInvoice).
  confirmZeroPrice: z.boolean().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const { confirmZeroPrice, ...input } = parsed.data;
      const invoice = await createInvoice(input, { confirmZeroPrice: confirmZeroPrice === true });
      after(syncRevenueIncidentsSafe);
      return NextResponse.json({ invoice }, { status: 201 });
    } catch (error) {
      if (error instanceof ZeroPriceLinesError) {
        // 409 kèm `code` + danh sách dòng: giao diện hỏi lại người dùng rồi gửi kèm
        // `confirmZeroPrice: true`. Không chặn hẳn — có dòng 0đ là có chủ đích (bảo hành, tặng).
        return NextResponse.json(
          { message: error.message, code: "ZERO_PRICE_LINES", lines: error.lines },
          { status: 409 },
        );
      }
      if (error instanceof InvoiceExistsError) return conflict(error.message);
      if (error instanceof OrderNotReadyError) return conflict(error.message);
      throw error;
    }
  });
}
