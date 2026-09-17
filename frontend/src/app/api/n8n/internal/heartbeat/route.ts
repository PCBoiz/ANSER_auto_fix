import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/server/api";
import { detectRunSource, recordRuleRun } from "@/server/automation/rules";
import { AUTOMATION_RULE_TYPES } from "@/server/domain";
import { checkInternalToken } from "@/server/internalAuth";
import { parseBody } from "@/server/validation";

export const dynamic = "force-dynamic";

const heartbeatSchema = z.object({
  type: z.enum(AUTOMATION_RULE_TYPES),
  status: z.enum(["ok", "error", "skipped"]),
  summary: z.string().max(500).optional(),
});

// POST /api/n8n/internal/heartbeat  { type, status, summary? }
//
// Node cuối của mỗi workflow mẫu gọi vào đây sau khi GỬI XONG email (hoặc sau nhánh lỗi).
//
// Khác với lần ghi ở endpoint dữ liệu (chỉ chứng minh workflow đã NỔ và lấy được dữ liệu),
// nhịp tim này chứng minh workflow đã CHẠY HẾT — lấy dữ liệu được mà SMTP hỏng thì email vẫn
// không tới, và trạng thái "fetched" sẽ không bao giờ lên "ok". Hai mốc tách nhau giúp biết
// hỏng ở khúc nào mà không phải mở n8n ra đọc lịch sử chạy.
export async function POST(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const parsed = await parseBody(request, heartbeatSchema);
    if (!parsed.ok) return parsed.response;

    const source = detectRunSource(request);
    await recordRuleRun(parsed.data.type, {
      status: parsed.data.status,
      summary: parsed.data.summary ?? (parsed.data.status === "ok" ? "Đã gửi xong" : "Không rõ"),
      source,
    });

    return NextResponse.json({ ok: true, recorded: source !== "unknown", source });
  });
}
