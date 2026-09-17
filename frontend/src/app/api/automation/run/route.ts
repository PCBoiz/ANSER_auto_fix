import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, handle, unauthorized } from "@/server/api";
import { CRON_JOBS, runCronJobs } from "@/server/automation/cron";
import { requireManager, requireUser } from "@/server/session";
import { parseBody } from "@/server/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ job: z.enum(CRON_JOBS) });

// Nút "Chạy ngay" trên trang Tự động hoá — chạy bộ lập lịch nội bộ theo yêu cầu, để kiểm tra
// bản tin mà không phải đợi tới 7 giờ sáng hôm sau. Ghi nguồn `manual`, nên KHÔNG được tính
// là bằng chứng "lịch tự động đang chạy" ở trang Kiểm tra vận hành.
export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý mới chạy tay được quy tắc tự động.");

    const parsed = await parseBody(request, schema);
    if (!parsed.ok) return parsed.response;

    const [result] = await runCronJobs([parsed.data.job], "manual");
    return NextResponse.json({ result }, { status: result.status === "error" ? 500 : 200 });
  });
}
