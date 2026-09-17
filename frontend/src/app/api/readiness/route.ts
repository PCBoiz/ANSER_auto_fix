import { NextResponse } from "next/server";
import { forbidden, handle, unauthorized } from "@/server/api";
import { getReadinessReport } from "@/server/readiness";
import { requireManager, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

// Chỉ quản lý trở lên: báo cáo này liệt kê đúng những chỗ hệ thống đang yếu (tài khoản
// mật khẩu đã lộ, endpoint thiếu token, đăng ký công khai còn mở). Đó là bản đồ tấn công
// gọn gàng cho bất kỳ ai đọc được nó.
export async function GET() {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý mới xem được báo cáo này.");

    return NextResponse.json(await getReadinessReport());
  });
}
