import { NextResponse } from "next/server";
import { apiError, forbidden, handle, unauthorized } from "@/server/api";
import { syncN8nWorkflows } from "@/server/automation/n8nSync";
import { runWatchdog } from "@/server/automation/watchdog";
import { isN8nApiConfigured } from "@/server/n8nApi";
import { checkRateLimit, RATE_LIMITS } from "@/server/rateLimit";
import { requireManager, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nút "Đồng bộ workflow" — phần "NGƯỜI quyết" của vòng lặp. Bộ canh gác tự động chỉ tạo
// workflow thiếu và tắt theo app; đè bản đã chỉnh tay và BẬT workflow gửi email cho khách
// thì phải có người bấm ở đây. Sau đó chạy ngay một lượt canh gác với chính kết quả này để
// các sự cố vừa được xử lý đóng luôn, không phải đợi 30 phút.
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    if (!user) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý mới đồng bộ được workflow n8n.");
    const limited = checkRateLimit(RATE_LIMITS.n8nSync, user.id);
    if (limited) return limited;

    if (!isN8nApiConfigured()) {
      return apiError("Chưa cấu hình N8N_API_URL / N8N_API_KEY — app không gọi được n8n.", 503);
    }

    const report = await syncN8nWorkflows({ trigger: "human" });
    if (!report.reachable) {
      return apiError("n8n không phản hồi — kiểm tra container n8n (docker compose up -d) và N8N_API_KEY.", 502);
    }
    const loop = await runWatchdog("manual", report);
    return NextResponse.json({ report, loop }, { status: report.ok ? 200 : 500 });
  });
}
