import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { getLedgerAnomalies } from "@/server/reports";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/ledger-anomalies?days=1&multiplier=5
// Chứng từ bán/mua hàng mới có giá trị vượt trội hẳn so với trung bình lịch sử — không khẳng
// định sai, chỉ gắn cờ để kế toán liếc lại (khả năng gõ nhầm thêm số 0).
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? 1);
    const multiplier = Number(url.searchParams.get("multiplier") ?? 5);

    const [report, company] = await Promise.all([
      getLedgerAnomalies({
        days: Number.isFinite(days) ? days : 1,
        multiplier: Number.isFinite(multiplier) ? multiplier : 5,
      }),
      getCompanySettings(),
    ]);

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      days: report.days,
      multiplier: report.multiplier,
      count: report.anomalies.length,
      items: report.anomalies.map((a) => ({
        source: a.source,
        partner_name: a.partnerName,
        voucher_no: a.voucherNo,
        date: a.date,
        total_amount: a.totalAmount,
        average: a.average,
        multiple: a.multiple,
      })),
    });
  });
}
