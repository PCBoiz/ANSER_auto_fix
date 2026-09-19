import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { buildOwnerWeekly } from "@/server/automation/digests";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/owner-weekly
//
// Báo cáo tuần cho chủ gara (automation/digests.ts — buildOwnerWeekly). Cùng khuôn với bản tin
// sáng: app dựng sẵn `subject` + `html`, workflow n8n chỉ "hẹn giờ -> gọi URL -> gửi".
// Khác bản tin sáng: LUÔN gửi (`send: true`) — tuần "0 lệnh" chính là điều chủ gara cần biết.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("owner_weekly_report", request, { days: 2 });
    if (!rule.enabled) {
      await recordRuleRun("owner_weekly_report", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json({ ...skippedPayload("owner_weekly_report"), send: false });
    }

    const company = await getCompanySettings();
    const digest = await buildOwnerWeekly({ companyName: company.name });
    await recordRuleRun("owner_weekly_report", { status: "fetched", summary: digest.subject, source });

    return NextResponse.json({
      send: true,
      email_to: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
      sections: digest.sections.map((s) => ({ key: s.key, title: s.title, count: s.count, priority: s.priority })),
    });
  });
}
