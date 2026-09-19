import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { ALERT_KINDS, buildAlertEmail } from "@/lib/incidentAlerts";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { INTERNAL_TOKEN_HEADER } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";

// Gửi email báo nhanh qua n8n (workflow `n8n-workflows/incident_alert.json`).
//
// Giao nhận "ÍT NHẤT MỘT LẦN": chỉ đánh dấu `alerted_at` SAU KHI n8n trả lời đã gửi xong. n8n
// tắt, SMTP lỗi -> cột vẫn null -> lượt canh gác sau gửi lại. Không bao giờ có chuyện "tưởng
// đã báo" mà thật ra email chưa đi.
//
// Khi chính n8n chết thì kênh này cũng chết — trường hợp đó do canh gác từ bên ngoài
// (HEARTBEAT_URL, xem automation/watchdog.ts) báo, vì nó không đi qua n8n.

export type AlertResult = { status: "sent" | "none" | "skipped" | "error"; opened: number; resolved: number; detail?: string };

export async function sendPendingAlerts(): Promise<AlertResult> {
  const base = process.env.N8N_WEBHOOK_URL?.replace(/\/+$/, "");
  if (!base) return { status: "skipped", opened: 0, resolved: 0, detail: "Chưa đặt N8N_WEBHOOK_URL" };

  const kinds = [...ALERT_KINDS];
  const [opened, resolved] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(
        and(
          inArray(notifications.kind, kinds),
          eq(notifications.severity, "high"),
          isNull(notifications.resolvedAt),
          isNull(notifications.alertedAt),
        ),
      )
      .limit(50),
    // Chỉ báo "đã khắc phục" cho sự cố ĐÃ từng được báo — mở rồi tự đóng giữa hai lượt thì
    // người nhận chưa từng biết nó tồn tại, báo "đã xong" chỉ gây rối.
    db
      .select()
      .from(notifications)
      .where(
        and(
          inArray(notifications.kind, kinds),
          isNotNull(notifications.alertedAt),
          isNotNull(notifications.resolvedAt),
          isNull(notifications.resolveAlertedAt),
          inArray(notifications.resolution, ["verified", "auto"]),
        ),
      )
      .limit(50),
  ]);
  if (opened.length === 0 && resolved.length === 0) return { status: "none", opened: 0, resolved: 0 };

  const company = await getCompanySettings();
  const to = company.email || process.env.N8N_NOTIFY_EMAIL;
  if (!to) return { status: "skipped", opened: opened.length, resolved: resolved.length, detail: "Chưa có email nhận" };

  const email = buildAlertEmail({
    companyName: company.name,
    appUrl: process.env.APP_PUBLIC_URL ?? null,
    opened,
    resolved,
  });

  try {
    const res = await fetch(`${base}/incident-alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_TOKEN_HEADER]: process.env.N8N_INTERNAL_TOKEN ?? "",
      },
      body: JSON.stringify({ to, ...email }),
      // Workflow chỉ trả lời SAU khi node Gửi Email xong — SMTP chậm vài giây là thường.
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { status: "error", opened: opened.length, resolved: resolved.length, detail: `n8n trả HTTP ${res.status}` };
    }
  } catch (error) {
    return {
      status: "error",
      opened: opened.length,
      resolved: resolved.length,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const now = new Date();
  if (opened.length) {
    await db.update(notifications).set({ alertedAt: now }).where(inArray(notifications.id, opened.map((o) => o.id)));
  }
  if (resolved.length) {
    await db
      .update(notifications)
      .set({ resolveAlertedAt: now })
      .where(inArray(notifications.id, resolved.map((r) => r.id)));
  }
  return { status: "sent", opened: opened.length, resolved: resolved.length };
}
