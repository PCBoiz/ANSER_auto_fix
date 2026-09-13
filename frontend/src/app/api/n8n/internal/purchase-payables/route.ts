import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { listUnpaidPurchasesByPartner } from "@/server/store/purchaseLedger";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/purchase-payables
// Công nợ phải trả nhà cung cấp, gom theo đối tác — báo NỘI BỘ cho kế toán để lên kế hoạch
// dòng tiền.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const [rows, company] = await Promise.all([listUnpaidPurchasesByPartner(), getCompanySettings()]);

    const items = rows.map((r) => ({
      partner_name: r.partnerName,
      count: r.count,
      total_outstanding: r.totalOutstanding,
      oldest_date: r.oldestDate,
    }));

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      count: items.length,
      total_outstanding: items.reduce((sum, i) => sum + i.total_outstanding, 0),
      items,
    });
  });
}
