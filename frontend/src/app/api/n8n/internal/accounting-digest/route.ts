import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { buildAccountingDigest } from "@/server/automation/digests";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/accounting-digest
//
// Tổng hợp tuần cho kế toán. Thiết kế lại từ đầu thay cho bộ 10 workflow kế toán cũ đã bị
// revert (e4c131d): 10 endpoint gần-trùng-nhau, mỗi cái một email riêng, gộp lại thành một
// bản tin với 3 mục có hành động cụ thể — đòi hoá đơn đầu vào theo nhà cung cấp, lập hoá
// đơn cho hàng đã giao, và thống nhất tên khách bị ghi nhiều cách.
//
// Ngưỡng `threshold_days` = chứng từ mua "chưa nhận hoá đơn" bao lâu thì đưa vào danh sách.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("accounting_digest", request, { days: 15 });
    if (!rule.enabled) {
      await recordRuleRun("accounting_digest", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json({ ...skippedPayload("accounting_digest"), send: false });
    }

    const company = await getCompanySettings();
    const digest = await buildAccountingDigest({
      companyName: company.name,
      pendingInvoiceDays: rule.thresholdDays ?? 15,
    });

    await recordRuleRun("accounting_digest", {
      status: digest.totalItems > 0 ? "fetched" : "skipped",
      summary: digest.subject,
      source,
    });

    return NextResponse.json({
      send: digest.totalItems > 0,
      email_to: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
      total_items: digest.totalItems,
      sections: digest.sections.map((s) => ({ key: s.key, title: s.title, count: s.count, priority: s.priority })),
    });
  });
}
