import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRules, serviceOrders } from "@/server/db/schema";
import { backupIncidents } from "@/lib/backupPolicy";
import { findSilentRules, heartbeatPingUrl, n8nIncidents, n8nWatchdogSilence, type IncidentInput } from "@/lib/opsLoop";
import { DEFAULT_IDLE_WORKING_DAYS, detectUsageIssues } from "@/lib/usage";
import { backupDir, getBackupState } from "@/server/backup";
import { syncN8nWorkflows, type SyncReport } from "@/server/automation/n8nSync";
import type { RunSource } from "@/server/automation/rules";
import { computeHealth, WATCHDOG_TICK_KEY } from "@/server/health";
import { sendPendingAlerts } from "@/server/incidentAlerts";
import { isN8nApiConfigured } from "@/server/n8nApi";
import { getReadinessReport, type ReadinessReport } from "@/server/readiness";
import { syncRevenueIncidents } from "@/server/revenueGuard";
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

export { WATCHDOG_TICK_KEY };
/** Lần gửi nhịp gần nhất ra canh gác bên ngoài (HEARTBEAT_URL). */
export const HEARTBEAT_KEY = "heartbeat:last";
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

  try {
    const state = await getBackupState();
    incidents.push(...backupIncidents({ configured: Boolean(backupDir()), ...state }, now));
  } catch (error) {
    errors.push(`sao lưu: ${error instanceof Error ? error.message : String(error)}`);
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

  // Thất thoát doanh thu: route sửa lệnh đã đồng bộ ngay, ở đây bắt nốt thứ đổi theo thời gian
  // (giao xe quá 24 giờ chưa lập hoá đơn) và thứ sửa ở chỗ khác (sửa giá trong kho).
  try {
    const r = await syncRevenueIncidents(now);
    opened += r.opened;
    resolved += r.resolved;
  } catch (error) {
    errors.push(`thất thoát: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Mức sử dụng: xưởng ngừng lập lệnh. Đi theo công tắc của "Báo cáo tuần cho chủ gara".
  try {
    const [rule] = await db
      .select({ enabled: automationRules.enabled, days: automationRules.thresholdDays })
      .from(automationRules)
      .where(sql`${automationRules.type} = 'owner_weekly_report'`)
      .limit(1);
    const [span] = await db
      .select({
        first: sql<string | null>`min(${serviceOrders.receivedAt})`,
        last: sql<string | null>`max(${serviceOrders.receivedAt})`,
      })
      .from(serviceOrders);
    const usage =
      rule && !rule.enabled
        ? []
        : detectUsageIssues(
            {
              firstOrderAt: span?.first ? new Date(span.first) : null,
              lastOrderAt: span?.last ? new Date(span.last) : null,
            },
            now,
            rule?.days ?? DEFAULT_IDLE_WORKING_DAYS,
          );
    const r = await syncIncidents("usage", "manager", usage);
    opened += r.opened;
    resolved += r.resolved;
  } catch (error) {
    errors.push(`mức sử dụng: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Email báo nhanh — sau mọi lần đồng bộ ở trên, để một lượt chỉ ra MỘT email.
  let alertNote = "";
  try {
    const a = await sendPendingAlerts();
    if (a.status === "sent") alertNote = `; email báo ${a.opened} mới, ${a.resolved} đã xong`;
    else if (a.status === "error") alertNote = `; email báo nhanh lỗi (${a.detail}), lượt sau gửi lại`;
  } catch (error) {
    errors.push(`email báo nhanh: ${error instanceof Error ? error.message : String(error)}`);
  }

  const summary =
    `Mở ${opened}, đóng ${resolved}, tự sửa ${autoFixed}; ${n8nNote}${alertNote}` +
    (errors.length ? `. Lỗi: ${errors.join(" | ")}` : "");

  // Nhịp của CHÍNH bộ canh gác — /api/health đọc nó để biết lịch nội bộ còn sống. Lần bấm tay
  // không tính: lịch chết mà có người bấm "Kiểm tra ngay" thì nhịp vẫn phải trông là đã chết.
  if (source !== "manual") {
    const tick: WatchdogTick = { at: now.toISOString(), source, summary };
    await setSystemState(WATCHDOG_TICK_KEY, tick).catch((error) =>
      console.error("[watchdog] Không ghi được nhịp:", error),
    );
  }

  // Nhịp ra canh gác BÊN NGOÀI — sau khi đã ghi nhịp trong app, để phép đo sức khoẻ thấy
  // đúng lượt này. Chỉ lượt theo lịch: bấm tay không được làm dịch vụ ngoài tưởng lịch còn sống.
  if (source !== "manual") await pingHeartbeat(summary);

  return { status: errors.length ? "error" : "ok", opened, resolved, autoFixed, summary };
}

/**
 * Gửi nhịp tới HEARTBEAT_URL (healthchecks.io…). Khoẻ -> URL gốc; hỏng -> `/fail`. Không bao
 * giờ throw: mạng ra ngoài chập chờn thì dịch vụ bên kia sẽ tự thấy nhịp trễ — đó là việc của nó.
 */
async function pingHeartbeat(summary: string) {
  const base = process.env.HEARTBEAT_URL?.trim();
  if (!base) return;
  const at = new Date().toISOString();
  try {
    const health = await computeHealth();
    const failing = health.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
    const res = await fetch(heartbeatPingUrl(base, health.status), {
      method: "POST",
      body: [health.status, ...failing, summary].join("\n").slice(0, 10_000),
      signal: AbortSignal.timeout(10_000),
    });
    await setSystemState(HEARTBEAT_KEY, { at, status: health.status, ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` });
  } catch (error) {
    await setSystemState(HEARTBEAT_KEY, {
      at,
      status: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
  }
}
