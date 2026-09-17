import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";
import { listOrdersAwaitingAcceptanceTooLong } from "@/server/store/serviceOrders";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/awaiting-acceptance
//
// Lệnh ở trạng thái "chờ nghiệm thu" quá N ngày (N đọc từ quy tắc
// `awaiting_acceptance_reminder`). Khách đã được báo 1 lần lúc lệnh chuyển sang trạng thái
// này, nhưng nếu quên không tới thì xe cứ chiếm chỗ xưởng mà không ai nhắc lại.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("awaiting_acceptance_reminder", request, { days: 2 });
    if (!rule.enabled) {
      await recordRuleRun("awaiting_acceptance_reminder", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json(skippedPayload("awaiting_acceptance_reminder"));
    }

    const days = rule.thresholdDays ?? 2;
    const [orders, company] = await Promise.all([
      listOrdersAwaitingAcceptanceTooLong(days),
      getCompanySettings(),
    ]);

    const items = orders.map((o) => ({
      order_code: o.code,
      license_plate: o.plateSnapshot,
      vehicle: o.vehicleLabel,
      days_waiting: o.daysWaiting,
      customer_name: o.customerName,
      customer_phone: o.customerPhone,
      customer_email: o.customerEmail,
      contactable: Boolean(o.customerEmail),
    }));

    const contactableCount = items.filter((item) => item.contactable).length;
    await recordRuleRun("awaiting_acceptance_reminder", {
      status: "fetched",
      summary: `${items.length} xe chờ nghiệm thu quá ${days} ngày (${contactableCount} có email)`,
      source,
    });

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      threshold_days: days,
      count: items.length,
      contactable_count: contactableCount,
      items,
    });
  });
}
