import { NextResponse } from "next/server";
import { N8N_WATCHDOG_SEEN_KEY } from "@/server/automation/watchdog";
import { computeHealth } from "@/server/health";
import { INTERNAL_TOKEN_HEADER } from "@/server/internalAuth";
import { setSystemState } from "@/server/store/systemState";

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
// Phép đo nằm ở `server/health.ts`, dùng chung với nhịp gửi ra canh gác bên ngoài.
//
// Ai cũng gọi được (Docker healthcheck, uptime monitor) nhưng chỉ nhận trạng thái. Chi tiết
// (tên sự cố, lỗi DB) chỉ trả khi có token nội bộ — không lộ tình trạng hệ thống cho người lạ.

function canSeeDetails(request: Request) {
  const expected = process.env.N8N_INTERNAL_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get(INTERNAL_TOKEN_HEADER) === expected;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // `?live=1`: chỉ hỏi "tiến trình còn trả lời không" — cho healthcheck của Docker. Không
  // chạm DB: Neon ngủ đông hay mạng chập chờn không được làm Docker coi app là hỏng.
  if (url.searchParams.get("live") === "1") {
    return NextResponse.json({ status: "ok" });
  }

  const health = await computeHealth();
  const trusted = canSeeDetails(request);

  // Nhịp của workflow "Canh gác app" bên n8n: có token + gọi theo LỊCH (không phải bấm
  // Execute thử). Bộ canh gác trong app đọc mốc này để biết người canh gác còn canh không.
  if (health.dbOk && trusted && request.headers.get("x-anser-trigger") === "schedule") {
    await setSystemState(N8N_WATCHDOG_SEEN_KEY, { at: health.checkedAt.toISOString() }).catch(() => {});
  }

  const body = trusted
    ? { status: health.status, checkedAt: health.checkedAt.toISOString(), checks: health.checks }
    : { status: health.status };
  return NextResponse.json(body, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
