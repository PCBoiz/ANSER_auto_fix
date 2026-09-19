import { and, eq, isNull, sql } from "drizzle-orm";
import { overallHealth, watchdogCheck, type HealthCheck, type HealthStatus } from "@/lib/opsLoop";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { getSystemState } from "@/server/store/systemState";

// Phép đo sức khoẻ dùng chung cho `/api/health` (n8n hỏi mỗi 30 phút) và nhịp gửi ra canh gác
// bên ngoài (HEARTBEAT_URL, trong automation/watchdog.ts) — hai nơi phải nói cùng một câu.

/** Nhịp của bộ canh gác trong app — ghi ở automation/watchdog.ts, đọc ở đây. */
export const WATCHDOG_TICK_KEY = "watchdog:lastTick";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`quá ${ms / 1000} giây không trả lời`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type HealthReport = { status: HealthStatus; checkedAt: Date; dbOk: boolean; checks: HealthCheck[] };

export async function computeHealth(now = new Date()): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  let dbOk = false;
  try {
    await withTimeout(db.execute(sql`select 1`), 8000);
    dbOk = true;
    checks.push({ name: "Cơ sở dữ liệu", ok: true, detail: "Kết nối được." });
  } catch (error) {
    checks.push({
      name: "Cơ sở dữ liệu",
      ok: false,
      fatal: true,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (dbOk) {
    try {
      const tick = await getSystemState<{ at: string }>(WATCHDOG_TICK_KEY);
      checks.push(watchdogCheck(tick ? new Date(tick.value.at) : null, now));

      // Chỉ sự cố CANH GÁC mức cao (hồi quy: lịch chết, n8n không trả lời, sao lưu hỏng). Việc
      // chặn go-live là việc cài đặt; thất thoát doanh thu là việc nghiệp vụ — cả hai có chuông
      // và email riêng, không làm app "hỏng".
      const open = await db
        .select({ title: notifications.title })
        .from(notifications)
        .where(
          and(
            eq(notifications.kind, "watchdog"),
            eq(notifications.severity, "high"),
            isNull(notifications.resolvedAt),
          ),
        )
        .limit(10);
      checks.push({
        name: "Sự cố vòng tự động",
        ok: open.length === 0,
        detail: open.length === 0 ? "Không có sự cố nào đang mở." : open.map((o) => o.title).join("; "),
      });
    } catch (error) {
      checks.push({
        name: "Trạng thái canh gác",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { status: overallHealth(checks), checkedAt: now, dbOk, checks };
}
