import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { listDeliveredNotInvoiced } from "@/server/store/salesLedger";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/sales-invoice-gap
// Đã xuất hàng nhưng chưa lập hoá đơn — rủi ro thất thu, báo NỘI BỘ cho kế toán.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const [rows, company] = await Promise.all([listDeliveredNotInvoiced(), getCompanySettings()]);

    const items = rows.map((r) => ({
      voucher_no: r.voucherNo,
      voucher_date: r.voucherDate,
      partner_name: r.partnerName,
      total_amount: r.totalAmount,
    }));

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      count: items.length,
      total_amount: items.reduce((sum, i) => sum + i.total_amount, 0),
      items,
    });
  });
}
