import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, badRequest, handle } from "@/server/api";
import { CRON_JOBS, runCronJobs, type CronJob } from "@/server/automation/cron";

export const dynamic = "force-dynamic";
// Bản tin quét nhiều bảng; mặc định 10 giây của serverless có thể không đủ ở lần chạy lạnh.
export const maxDuration = 60;

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Xác thực bộ gọi lịch. Nhận hai kiểu, vì app có hai cách deploy thật:
//   - Vercel Cron: tự gửi `Authorization: Bearer <CRON_SECRET>`.
//   - Máy chủ tự quản (Windows Task Scheduler, crontab, n8n): gửi header `X-Cron-Secret`.
// Thiếu CRON_SECRET ở production thì CHẶN (503) — cùng nguyên tắc với N8N_INTERNAL_TOKEN:
// thiếu cấu hình phải nổ ra, không được âm thầm biến thành endpoint ai cũng gọi được.
function checkCronSecret(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return apiError("Chưa cấu hình CRON_SECRET — bộ lập lịch nội bộ bị khoá ở production.", 503);
    }
    return null;
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  if (safeEqual(bearer, expected) || safeEqual(header, expected)) return null;
  return apiError("Sai CRON_SECRET.", 401);
}

/**
 * GET /api/cron/automation?job=morning_brief&job=readiness
 *
 * Không truyền `job` thì chạy tất cả. Lịch mặc định nằm trong `vercel.json`.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkCronSecret(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const requested = url.searchParams.getAll("job");
    const unknown = requested.filter((j) => !CRON_JOBS.includes(j as CronJob));
    if (unknown.length > 0) {
      return badRequest(`Việc không hợp lệ: ${unknown.join(", ")}. Hợp lệ: ${CRON_JOBS.join(", ")}.`);
    }

    const jobs = (requested.length > 0 ? requested : [...CRON_JOBS]) as CronJob[];
    const results = await runCronJobs(jobs, "cron");
    const failed = results.filter((r) => r.status === "error");

    // Trả 500 khi có việc lỗi để Vercel Cron / Task Scheduler ghi nhận lần chạy thất bại,
    // thay vì một 200 xanh lè che mất lỗi.
    return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 500 : 200 });
  });
}
