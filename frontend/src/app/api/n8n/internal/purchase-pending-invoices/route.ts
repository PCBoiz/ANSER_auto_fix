import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { listPendingInvoicePurchases } from "@/server/store/purchaseLedger";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/purchase-pending-invoices?days=14
// Phiếu mua hàng đã lập quá `days` ngày mà chưa nhận hoá đơn đỏ — báo NỘI BỘ cho kế toán.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? 14);

    const [rows, company] = await Promise.all([
      listPendingInvoicePurchases(Number.isFinite(days) ? days : 14),
      getCompanySettings(),
    ]);

    const items = rows.map((r) => ({
      voucher_no: r.voucherNo,
      posting_date: r.postingDate,
      partner_name: r.partnerName,
      total_amount: r.totalAmount,
      invoice_status: r.invoiceStatus,
    }));

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      days,
      count: items.length,
      total_amount: items.reduce((sum, i) => sum + i.total_amount, 0),
      items,
    });
  });
}
