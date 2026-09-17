import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";
import { listUnpaidInvoicesOlderThan } from "@/server/store/invoices";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/unpaid-invoices
//
// Hoá đơn chưa thu đủ quá N ngày (N đọc từ quy tắc `unpaid_invoice_report`) — báo cáo NỘI
// BỘ cho quản lý, không gửi khách. Không trả customer_email vì workflow này cố ý không có
// nhánh gửi khách; số điện thoại vẫn trả để quản lý gọi trực tiếp nếu cần.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("unpaid_invoice_report", request, { days: 7 });
    if (!rule.enabled) {
      await recordRuleRun("unpaid_invoice_report", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json({ ...skippedPayload("unpaid_invoice_report"), total_outstanding: 0 });
    }

    const days = rule.thresholdDays ?? 7;
    const [invoiceList, company] = await Promise.all([
      listUnpaidInvoicesOlderThan(days),
      getCompanySettings(),
    ]);

    const items = invoiceList.map((inv) => ({
      invoice_code: inv.code,
      customer_name: inv.customerName,
      customer_phone: inv.customerPhone,
      license_plate: inv.plateSnapshot,
      total: inv.total,
      paid_amount: inv.paidAmount,
      outstanding: inv.outstanding,
      days_old: inv.daysOld,
      status: inv.status,
    }));

    const totalOutstanding = items.reduce((sum, item) => sum + item.outstanding, 0);
    await recordRuleRun("unpaid_invoice_report", {
      status: "fetched",
      summary: `${items.length} hoá đơn nợ quá ${days} ngày, tổng ${totalOutstanding.toLocaleString("vi-VN")}đ`,
      source,
    });

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      threshold_days: days,
      count: items.length,
      total_outstanding: totalOutstanding,
      items,
    });
  });
}
