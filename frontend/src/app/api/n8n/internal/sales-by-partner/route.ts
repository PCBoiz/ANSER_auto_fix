import { NextResponse } from "next/server";
import { badRequest, handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { getSalesByPartnerReport, REPORT_PERIODS, type ReportPeriod } from "@/server/reports";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/sales-by-partner?period=day|week|month&limit=10
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const period = (url.searchParams.get("period") ?? "month") as ReportPeriod;
    if (!REPORT_PERIODS.includes(period)) {
      return badRequest(`period phải là một trong: ${REPORT_PERIODS.join(", ")}.`);
    }
    const limit = Number(url.searchParams.get("limit") ?? 10);

    const [report, company] = await Promise.all([
      getSalesByPartnerReport(period, Number.isFinite(limit) ? limit : 10),
      getCompanySettings(),
    ]);

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      period: report.period,
      period_label: report.periodLabel,
      total_count: report.totalCount,
      total_amount: report.totalAmount,
      partners: report.partners.map((p) => ({
        partner_name: p.partnerName,
        count: p.count,
        total_amount: p.totalAmount,
      })),
    });
  });
}
