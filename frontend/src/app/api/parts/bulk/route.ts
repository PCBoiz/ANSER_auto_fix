import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, handle, unauthorized } from "@/server/api";
import { checkRateLimit, RATE_LIMITS } from "@/server/rateLimit";
import { requireManager, requireUser } from "@/server/session";
import { optionalNonNegativeInt, parseBody, uuidField, vndAmount } from "@/server/validation";
import { bulkUpdateParts } from "@/server/store/parts";

export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  // 500 dòng một lần: đủ để lưu trọn một trang của bảng nhập giá, và đủ nhỏ để một
  // transaction không giữ khoá quá lâu trên bảng `parts` mà cả xưởng đang dùng.
  patches: z
    .array(
      z.object({
        id: uuidField,
        price: vndAmount.optional(),
        // `null` là giá trị HỢP LỆ và có nghĩa riêng: quay về dùng ngưỡng chung. Khác
        // với 0 (cố ý không cảnh báo) và khác với không gửi (giữ nguyên).
        minStock: z.union([optionalNonNegativeInt, z.null()]).optional(),
      }),
    )
    .min(1, "Không có dòng nào để lưu.")
    .max(500, "Mỗi lần lưu tối đa 500 dòng."),
});

/**
 * Sửa giá bán / ngưỡng tồn hàng loạt.
 *
 * Sinh ra cho đúng một việc có thật: 781 phụ tùng đồng-sơn nhập từ Excel đều có giá bán
 * 0đ và không có ngưỡng tồn. Sửa từng mã qua modal là 781 lần mở-gõ-đóng; và tới khi
 * chưa điền xong thì mọi dòng phụ tùng trên lệnh sửa chữa đều ra 0đ.
 *
 * `requireManager()` chứ không phải `requireUser()`: đây là thao tác đổi giá bán hàng
 * loạt, không phải việc của mọi nhân viên.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (!user) return unauthorized();
    if (!(await requireManager())) {
      return forbidden("Chỉ quản lý trở lên mới sửa được giá bán hàng loạt.");
    }
    const limited = checkRateLimit(RATE_LIMITS.partsBulk, user.id);
    if (limited) return limited;

    const parsed = await parseBody(request, bulkSchema);
    if (!parsed.ok) return parsed.response;

    const updated = await bulkUpdateParts(parsed.data.patches);
    return NextResponse.json({ updated });
  });
}
