import { db } from "@/server/db/client";
import { automationRules } from "@/server/db/schema";
import { findSilentRules, n8nIncidents, n8nWatchdogSilence, type IncidentInput } from "@/lib/opsLoop";
import { syncN8nWorkflows, type SyncReport } from "@/server/automation/n8nSync";
import type { RunSource } from "@/server/automation/rules";
import { isN8nApiConfigured } from "@/server/n8nApi";
import { getReadinessReport, type ReadinessReport } from "@/server/readiness";
import {
  recordAutoFix,
  supersedeDatedNotifications,
  syncIncidents,
  type IncidentSyncResult,
} from "@/server/store/notifications";
import { getSystemState, setSystemState } from "@/server/store/systemState";

// Bộ canh gác — nửa "trong app" của vòng lặp khép kín. Mỗi lượt:
//
//   PHÁT HIỆN  quy tắc im quá nhịp; n8n không trả lời; workflow thiếu/lệch/tắt; việc chặn go-live
//   SỬA        tự làm việc an toàn (tạo workflow thiếu, tắt theo app) — xem decideActivation
//   CẢNH BÁO   việc cần người lên chuông, MỘT bản ghi mỗi sự cố dù kéo dài bao lâu
//   KIỂM CHỨNG lượt sau đo lại; không còn thấy thì ĐÓNG (resolution = "verified")
//
// Nửa còn lại chạy trong n8n (`n8n-workflows/app_watchdog.json`): hỏi /api/health mỗi 30
// phút, email khi app chết HOẶC khi lượt canh gác này ngừng chạy. Hai bên canh nhau.

export const WATCHDOG_TICK_KEY = "watchdog:lastTick";
/** Lần cuối workflow "Canh gác app" bên n8n hỏi /api/health theo lịch — ghi ở route health. */
export const N8N_WATCHDOG_SEEN_KEY = "watchdog:n8nLastSeen";

export type WatchdogTick = { at: string; source: RunSource; summary: string };

/**
 * Việc chặn go-live -> sự cố trên chuông, khoá KHÔNG kèm ngày.
 *
 * Trước đây khoá là `readiness:<id>:<ngày>`: sửa xong vẫn còn thông báo của hôm nay, còn việc
 * chưa sửa thì mỗi sáng thêm một bản mới. Nay một việc = một bản ghi, đóng khi đo lại không
 * còn thấy.
 */
export async function syncReadinessIncidents(report?: ReadinessReport): Promise<IncidentSyncResult> {
  const r = report ?? (await getReadinessReport());
  const incidents: IncidentInput[] = r.items
    .filter((item) => item.severity === "blocker")
    .map((item) => ({
      key: `readiness:${item.id}`,
      severity: "high",
      title: item.title,
      body: item.fix,
      href: item.href ?? "/dashboard/readiness",
    }));
  // Đóng bản có-ngày kiểu cũ TRƯỚC khi đối soát — nếu không, chúng bị tính là "đã sửa xong
  // và được kiểm chứng" trong số liệu vòng lặp, trong khi thật ra chỉ là đổi cách đặt khoá.
  await supersedeDatedNotifications(
    "readiness",
    incidents.map((i) => i.key),
  );
  return syncIncidents("readiness", "manager", incidents);
}

export type WatchdogResult = {
  status: "ok" | "error";
  opened: number;
  resolved: number;
  autoFixed: number;
  summary: string;
};

/**
 * Một lượt canh gác.
 *
 * `sync` truyền sẵn khi NGƯỜI vừa bấm "Đồng bộ workflow": dùng luôn kết quả đó để đóng các sự
 * cố vừa được sửa, và không ghi "tự khắc phục" cho việc người làm.
 */
export async function runWatchdog(source: RunSource, sync?: SyncReport): Promise<WatchdogResult> {
  const now = new Date();
  const incidents: IncidentInput[] = [];
  const errors: string[] = [];
  let autoFixed = 0;
  let n8nNote = "n8n chưa cấu hình API";

  try {
    const rules = await db
      .select({
        type: automationRules.type,
        name: automationRules.name,
        enabled: automationRules.enabled,
        lastScheduledRunAt: automationRules.lastScheduledRunAt,
      })
      .from(automationRules);
    incidents.push(...findSilentRules(rules, now));
  } catch (error) {
    errors.push(`quy tắc: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (sync || isN8nApiConfigured()) {
    try {
      const report = sync ?? (await syncN8nWorkflows({ trigger: "watchdog" }));
      const out = n8nIncidents(report);
      incidents.push(...out.incidents);

      // n8n không trả lời thì đã có sự cố riêng — không báo thêm "canh gác ngừng hỏi" cho
      // cùng một nguyên nhân. Chưa có email nhận thì workflow canh gác được để tắt có chủ đích.
      if (report.reachable && report.alertEmailSet) {
        const seen = await getSystemState<{ at: string }>(N8N_WATCHDOG_SEEN_KEY);
        const silence = n8nWatchdogSilence(seen ? new Date(seen.value.at) : null, now);
        if (silence) incidents.push(silence);
      }

      if (!sync) {
        // Khoá kèm thời điểm: mỗi lượt tự sửa là một bản ghi riêng, nên đếm được hệ thống đã
        // phải can thiệp bao nhiêu lần — một workflow bị ai đó xoá mỗi tuần sẽ lộ ra ở đây.
        for (const fix of out.autoFixes) {
          await recordAutoFix("watchdog", "manager", { ...fix, key: `${fix.key}:${now.toISOString()}` });
        }
        autoFixed = out.autoFixes.length;
      }
      n8nNote = report.reachable
        ? `n8n: ${report.items.length} workflow, lệch ${report.driftCount}`
        : "n8n không trả lời";
    } catch (error) {
      errors.push(`n8n: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let opened = 0;
  let resolved = 0;
  // Lượt đo lỗi giữa chừng thì KHÔNG đối soát: danh sách sự cố thiếu một phần sẽ bị hiểu là
  // "phần đó đã hết" và đóng nhầm những việc chưa ai sửa.
  if (errors.length === 0) {
    const r = await syncIncidents("watchdog", "manager", incidents);
    opened += r.opened;
    resolved += r.resolved;
  }

  try {
    const r = await syncReadinessIncidents();
    opened += r.opened;
    resolved += r.resolved;
  } catch (error) {
    errors.push(`kiểm tra vận hành: ${error instanceof Error ? error.message : String(error)}`);
  }

  const summary =
    `Mở ${opened}, đóng ${resolved}, tự sửa ${autoFixed}; ${n8nNote}` +
    (errors.length ? `. Lỗi: ${errors.join(" | ")}` : "");

  // Nhịp của CHÍNH bộ canh gác — /api/health đọc nó để biết lịch nội bộ còn sống. Lần bấm tay
  // không tính: lịch chết mà có người bấm "Kiểm tra ngay" thì nhịp vẫn phải trông là đã chết.
  if (source !== "manual") {
    const tick: WatchdogTick = { at: now.toISOString(), source, summary };
    await setSystemState(WATCHDOG_TICK_KEY, tick).catch((error) =>
      console.error("[watchdog] Không ghi được nhịp:", error),
    );
  }

  return { status: errors.length ? "error" : "ok", opened, resolved, autoFixed, summary };
}
