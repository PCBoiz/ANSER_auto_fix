import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { buildMorningBrief } from "@/server/automation/digests";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/morning-brief
//
// Bản tin sáng cho quản lý xưởng — gộp xe quá hẹn trả, xe chờ nghiệm thu, đặt hàng ngoài
// về trễ, lịch hẹn, phụ tùng sắp hết và công nợ vào MỘT email, sắp theo mức cần xử lý.
//
// Trả sẵn `subject` + `html` đã dựng: workflow n8n chỉ còn "hẹn giờ -> gọi URL -> nếu
// `send` thì gửi". Nội dung email là nghiệp vụ, nên nó nằm trong git (automation/digests.ts)
// chứ không nằm trong node Code của một file JSON phải import tay.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("morning_brief", request, { days: 2, qty: 10 });
    if (!rule.enabled) {
      await recordRuleRun("morning_brief", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json({ ...skippedPayload("morning_brief"), send: false });
    }

    const company = await getCompanySettings();
    const digest = await buildMorningBrief({
      companyName: company.name,
      awaitingDays: rule.thresholdDays ?? 2,
      lowStockLimit: rule.thresholdQty ?? 10,
      lowStockFallback: 5,
    });

    await recordRuleRun("morning_brief", {
      status: digest.totalItems > 0 ? "fetched" : "skipped",
      summary: digest.totalItems > 0 ? digest.subject : "Không có gì cần báo",
      source,
    });

    return NextResponse.json({
      // `send` là thứ duy nhất node IF trong workflow cần đọc. Không có mục nào thì không
      // gửi: một bản tin toàn "không có gì" mỗi sáng là bản tin dạy người ta thôi mở.
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
