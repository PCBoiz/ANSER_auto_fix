import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRules } from "@/server/db/schema";
import type { AutomationRuleType } from "@/server/domain";

// Cầu nối giữa quy tắc tự động trong DB và các endpoint mà n8n (hoặc bộ lập lịch nội bộ)
// gọi vào. Sửa ba lỗi thiết kế cùng lúc:
//
// 1. NGƯỠNG GIẢ. Trang Tự động hoá sửa được `threshold_days`/`threshold_km`, nhưng workflow
//    truyền cứng `?days=7&km=500` trong URL — sửa trên app không có tác dụng gì. Nay
//    endpoint tự đọc ngưỡng từ DB; tham số URL bị BỎ QUA trừ khi kèm `override=1` (để thử
//    tay). Nhờ vậy các workflow ĐÃ import từ trước tự động theo ngưỡng trong DB mà không
//    phải import lại.
//
// 2. NÚT TẮT GIẢ. Tắt quy tắc trong app chỉ đổi cột `enabled`; workflow bên n8n vẫn Active
//    và vẫn gửi email. Nay endpoint trả `{ skipped: true, count: 0, items: [] }` khi quy tắc
//    tắt — các workflow hiện có đều kiểm tra `count > 0` trước khi gửi, nên tắt trong app là
//    dừng thật, không cần đụng tới n8n.
//
// 3. KHÔNG BIẾT CÓ CHẠY KHÔNG. Mỗi lần endpoint dữ liệu được gọi là một bằng chứng workflow
//    đã nổ. Ghi lại vào `last_run_*` ngay tại đó — không cần sửa workflow nào. Node nhịp tim
//    cuối workflow (`POST /internal/heartbeat`) ghi đè thêm kết quả gửi thành công hay không.

export type RuleConfig = {
  type: AutomationRuleType;
  /**
   * Quy tắc đang bật. KHÔNG có dòng nào trong DB thì coi là BẬT — giữ đúng hành vi trước
   * đây của workflow. DB thật hôm 17/09/2026 chỉ có 5/7 loại quy tắc (thiếu
   * `revenue_report`, `order_status_update`); coi "không có" là "tắt" sẽ làm workflow
   * doanh thu đang chạy im bặt mà không ai hiểu vì sao.
   */
  enabled: boolean;
  thresholdQty: number | null;
  thresholdDays: number | null;
  thresholdKm: number | null;
  branchId: string | null;
};

/**
 * Đọc cấu hình quy tắc theo loại, có áp tham số URL khi được phép.
 *
 * `defaults` là giá trị dùng khi DB để trống cột ngưỡng — không phải khi URL có tham số.
 */
export async function resolveRuleConfig(
  type: AutomationRuleType,
  request: Request,
  defaults: { qty?: number; days?: number; km?: number },
): Promise<RuleConfig & { source: "db" | "override" }> {
  const [rule] = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.type, type))
    .limit(1);

  const url = new URL(request.url);
  const override = url.searchParams.get("override") === "1";

  const num = (name: string) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const config: RuleConfig = {
    type,
    enabled: rule ? rule.enabled : true,
    thresholdQty: rule?.thresholdQty ?? defaults.qty ?? null,
    thresholdDays: rule?.thresholdDays ?? defaults.days ?? null,
    thresholdKm: rule?.thresholdKm ?? defaults.km ?? null,
    branchId: rule?.branchId ?? null,
  };

  if (!override) return { ...config, source: "db" };

  // Chế độ thử tay: tham số URL thắng, và coi như đang bật để người thử thấy được dữ liệu.
  return {
    ...config,
    enabled: true,
    thresholdQty: num("threshold") ?? num("qty") ?? config.thresholdQty,
    thresholdDays: num("days") ?? num("hours") ?? config.thresholdDays,
    thresholdKm: num("km") ?? config.thresholdKm,
    source: "override",
  };
}

export type RunSource = "schedule" | "manual" | "cron" | "n8n" | "unknown";
export type RunStatus = "fetched" | "ok" | "error" | "skipped";

/**
 * Suy ra ai đã gọi endpoint.
 *
 * Workflow mẫu mới gắn header `X-Anser-Trigger` bằng biểu thức
 * `{{ $execution.mode === 'production' ? 'schedule' : 'manual' }}` — n8n trả `production`
 * khi workflow đang Active tự nổ theo lịch, và `test` khi người bấm "Execute workflow". Nhờ
 * vậy phân biệt được lịch thật với lần bấm thử.
 *
 * Workflow cũ không có header thì nhận diện qua User-Agent của node HTTP Request (axios),
 * ghi là `n8n` — biết chắc là n8n gọi, nhưng không biết do lịch hay do bấm tay.
 */
export function detectRunSource(request: Request): RunSource {
  const explicit = request.headers.get("x-anser-trigger");
  if (explicit === "schedule" || explicit === "manual" || explicit === "cron") return explicit;
  const ua = request.headers.get("user-agent") ?? "";
  if (/n8n|axios/i.test(ua)) return "n8n";
  return "unknown";
}

/** Nguồn chạy được tính là bằng chứng "lịch tự động đang hoạt động". */
export const SCHEDULED_SOURCES: RunSource[] = ["schedule", "n8n", "cron"];

/**
 * Nguồn được tính là "n8n còn chạy theo lịch" — riêng cho bộ canh gác.
 *
 * Không có `cron`: bản tin sáng chạy được cả bằng n8n (gửi email) lẫn bằng lịch nội bộ (lên
 * chuông). Nếu lịch nội bộ cũng đẩy mốc này thì n8n chết cả tuần mà bản tin sáng vẫn trông
 * "đúng giờ" — bộ canh gác mù đúng chỗ nó cần nhìn. Lịch nội bộ có nhịp riêng
 * (`watchdog:lastTick`, xem `/api/health`).
 */
export const EXTERNAL_SCHEDULE_SOURCES: RunSource[] = ["schedule", "n8n"];

/**
 * Ghi dấu vết một lần chạy. KHÔNG BAO GIỜ throw: ghi nhật ký hỏng không được làm hỏng chính
 * lần gửi cảnh báo mà nó đang ghi nhận.
 *
 * Nguồn `unknown` (curl, trình duyệt, script thử) KHÔNG được ghi: cột `last_run_*` là bằng
 * chứng để trả lời "workflow có tự chạy đúng lịch không". Một lần gọi thử bằng tay mà cũng
 * ghi vào đó thì bằng chứng thành giả — và nó còn ghi đè mất dấu vết của lần chạy theo lịch
 * thật trước đó.
 */
export async function recordRuleRun(
  type: AutomationRuleType,
  run: { status: RunStatus; summary: string; source: RunSource },
) {
  if (run.source === "unknown") return;
  try {
    await db
      .update(automationRules)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: run.status,
        lastRunSummary: run.summary.slice(0, 500),
        lastRunSource: run.source,
        // Chỉ n8n chạy theo lịch mới đẩy mốc này — lần bấm tay không được che lịch đã chết.
        ...(EXTERNAL_SCHEDULE_SOURCES.includes(run.source) && run.status !== "error"
          ? { lastScheduledRunAt: new Date() }
          : {}),
      })
      .where(eq(automationRules.type, type));
  } catch (error) {
    console.error(`[automation] Không ghi được nhịp chạy của "${type}":`, error);
  }
}

/** Phản hồi chuẩn khi quy tắc đang tắt — giữ đúng hình dạng mà workflow hiện có đang đọc. */
export function skippedPayload(type: AutomationRuleType) {
  return {
    skipped: true,
    reason: `Quy tắc "${type}" đang tắt trong ANSER Auto — không gửi gì.`,
    count: 0,
    contactable_count: 0,
    items: [],
  };
}
