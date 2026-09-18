import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { overallHealth, watchdogCheck, type HealthCheck } from "@/lib/opsLoop";
import { WATCHDOG_TICK_KEY, type WatchdogTick } from "@/server/automation/watchdog";
import { INTERNAL_TOKEN_HEADER } from "@/server/internalAuth";
import { getSystemState } from "@/server/store/systemState";

export const dynamic = "force-dynamic";

// Sức khoẻ SÂU — thứ mà workflow "Canh gác app" trong n8n hỏi mỗi 30 phút.
//
// Trước đây route này luôn trả `{ status: "ok" }` — tiến trình còn sống là "ok", kể cả khi DB
// không kết nối được hay bộ canh gác đã ngừng từ ba ngày trước. Một phép đo không bao giờ
// báo hỏng thì không đo gì cả.
//
//   ok        mọi thứ chạy
//   degraded  app dùng được nhưng VÒNG TỰ ĐỘNG đang hỏng (sự cố canh gác mức cao đang mở,
//             hoặc chính bộ canh gác im lặng quá lâu) -> 503 để n8n báo
//   down      DB không trả lời -> 503
//
// Ai cũng gọi được (Docker healthcheck, uptime monitor) nhưng chỉ nhận trạng thái. Chi tiết
// (tên sự cố, lỗi DB) chỉ trả khi có token nội bộ — không lộ tình trạng hệ thống cho người lạ.

function canSeeDetails(request: Request) {
  const expected = process.env.N8N_INTERNAL_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get(INTERNAL_TOKEN_HEADER) === expected;
}

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  // `?live=1`: chỉ hỏi "tiến trình còn trả lời không" — cho healthcheck của Docker. Không
  // chạm DB: Neon ngủ đông hay mạng chập chờn không được làm Docker coi app là hỏng.
  if (url.searchParams.get("live") === "1") {
    return NextResponse.json({ status: "ok" });
  }

  const now = new Date();
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
      const tick = await getSystemState<WatchdogTick>(WATCHDOG_TICK_KEY);
      checks.push(watchdogCheck(tick ? new Date(tick.value.at) : null, now));

      // Chỉ sự cố CANH GÁC mức cao (hồi quy: lịch chết, n8n không trả lời). Việc chặn go-live
      // là việc cài đặt — nằm ở trang Kiểm tra vận hành, không làm app "hỏng".
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

  const status = overallHealth(checks);
  const body = canSeeDetails(request)
    ? { status, checkedAt: now.toISOString(), checks }
    : { status };
  return NextResponse.json(body, {
    status: status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
