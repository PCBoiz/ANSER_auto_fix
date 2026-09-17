import { NextResponse } from "next/server";
import { badRequest, handle } from "@/server/api";
import { detectRunSource, recordRuleRun, resolveRuleConfig } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getRevenueReport, REPORT_PERIODS, type ReportPeriod } from "@/server/reports";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/revenue?period=day|week|month
//
// `period` vẫn đọc từ URL: đó là CẤU HÌNH của từng workflow (bản ngày/tuần/tháng là ba
// workflow nhân bản), không phải ngưỡng chỉnh được trên trang Tự động hoá.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const period = (url.searchParams.get("period") ?? "day") as ReportPeriod;
    if (!REPORT_PERIODS.includes(period)) {
      return badRequest(`period phải là một trong: ${REPORT_PERIODS.join(", ")}.`);
    }

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("revenue_report", request, {});
    if (!rule.enabled) {
      await recordRuleRun("revenue_report", { status: "skipped", summary: "Quy tắc đang tắt", source });
      // Đã đối chiếu với node Code của `revenue_report.json` đang import: nó đọc
      // `d.summary || {}` (không nổ khi thiếu) và `email_to: d.company_email || ''`. Payload
      // này cố ý KHÔNG có `company_email`, nên node IF "Có email nhận?" chặn lại — workflow
      // cũ chạy xong mà không gửi gì, không cần import lại.
      return NextResponse.json({ skipped: true, reason: "Quy tắc báo cáo doanh thu đang tắt.", summary: null });
    }

    const [report, company] = await Promise.all([getRevenueReport(period), getCompanySettings()]);

    await recordRuleRun("revenue_report", {
      status: "fetched",
      summary: `${report.periodLabel}: ${report.invoiceCount} hoá đơn, doanh thu ${report.revenue.toLocaleString("vi-VN")}đ`,
      source,
    });

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      currency: company.currency,
      period: report.period,
      period_label: report.periodLabel,
      from: report.from,
      to: report.to,
      summary: {
        invoice_count: report.invoiceCount,
        revenue: report.revenue,
        collected: report.collected,
        outstanding: report.outstanding,
        labor_revenue: report.laborRevenue,
        parts_revenue: report.partsRevenue,
        orders_delivered: report.ordersDelivered,
      },
      top_services: report.topServices,
      top_parts: report.topParts,
    });
  });
}
