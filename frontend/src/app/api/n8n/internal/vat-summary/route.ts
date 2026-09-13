import { NextResponse } from "next/server";
import { badRequest, handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { getVatSummaryReport, REPORT_PERIODS, type ReportPeriod } from "@/server/reports";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/vat-summary?period=day|week|month
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const period = (url.searchParams.get("period") ?? "month") as ReportPeriod;
    if (!REPORT_PERIODS.includes(period)) {
      return badRequest(`period phải là một trong: ${REPORT_PERIODS.join(", ")}.`);
    }

    const [report, company] = await Promise.all([getVatSummaryReport(period), getCompanySettings()]);

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      period: report.period,
      period_label: report.periodLabel,
      vat_output: report.vatOutput,
      vat_input: report.vatInput,
      vat_payable: report.vatPayable,
      revenue: report.revenue,
      spend: report.spend,
    });
  });
}
