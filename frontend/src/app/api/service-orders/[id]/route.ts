import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, notFound, unauthorized } from "@/server/api";
import {
  REVERTIBLE_FROM,
  SERVICE_ORDER_STATUS_LABELS,
  SERVICE_ORDER_STATUSES,
  type ServiceOrderStatus,
} from "@/server/domain";
import { notifyOrderStatusChanged } from "@/server/n8n";
import { requireUser } from "@/server/session";
import { getServiceOrderById, updateServiceOrder } from "@/server/store/serviceOrders";
import { optionalDate, optionalText, optionalUuid, parseBody, vndAmount } from "@/server/validation";

// Thứ tự luồng thật, KHÔNG gồm "cancelled" — huỷ là một nhánh riêng cho phép từ bất kỳ
// trạng thái chưa chốt nào, không phải bước kế tiếp của bước nào cả.
const FLOW = SERVICE_ORDER_STATUSES.filter((s) => s !== "cancelled");

// Chỉ cho phép: đi tiếp đúng 1 bước trong FLOW, lùi đúng bước đã khai trong
// REVERTIBLE_FROM (hiện chỉ "chờ nghiệm thu" → "đang sửa chữa" khi khách không đồng ý),
// hoặc huỷ. Chặn nhảy cóc (vd "đã tiếp nhận" → "đã giao xe") vì mỗi bước bỏ qua là một
// việc thật chưa chắc đã làm (chưa báo giá, chưa khách duyệt...).
function validateTransition(current: ServiceOrderStatus, target: ServiceOrderStatus): string | null {
  if (current === "delivered" || current === "cancelled") {
    return "Lệnh đã ở trạng thái chốt, không đổi trạng thái được nữa.";
  }
  if (target === "cancelled") return null;
  if (REVERTIBLE_FROM[current] === target) return null;

  const currentIndex = FLOW.indexOf(current);
  const targetIndex = FLOW.indexOf(target);
  if (targetIndex === currentIndex + 1) return null;

  return `Không thể chuyển thẳng từ "${SERVICE_ORDER_STATUS_LABELS[current]}" sang "${SERVICE_ORDER_STATUS_LABELS[target]}".`;
}

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    const detail = await getServiceOrderById(id);
    if (!detail) return notFound("Không tìm thấy lệnh sửa chữa.");
    return NextResponse.json(detail);
  });
}

// Mọi trường đều `.optional()` bọc ngoài: không gửi = giữ nguyên (xem ghi chú BẪY KHI DÙNG
// CHO PATCH trong validation.ts).
const patchSchema = z.object({
  status: z.enum(SERVICE_ORDER_STATUSES, { message: "Trạng thái không hợp lệ." }).optional(),
  advisorId: optionalUuid.optional(),
  diagnosis: optionalText(4000).optional(),
  customerComplaint: optionalText(2000).optional(),
  note: optionalText(2000).optional(),
  promisedAt: optionalDate.optional(),
  discount: vndAmount.optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const before = await getServiceOrderById(id);
    if (!before) return notFound("Không tìm thấy lệnh sửa chữa.");

    const patch: Parameters<typeof updateServiceOrder>[1] = {};

    if (body.status !== undefined) {
      const transitionError = validateTransition(before.order.status as ServiceOrderStatus, body.status);
      if (transitionError) return conflict(transitionError);

      patch.status = body.status;
      // Đóng dấu thời điểm ngay tại đây thay vì bắt người dùng nhập: hai mốc này là cơ sở
      // tính KPI "đã giao xe hôm nay" và thời gian lưu xưởng.
      if (body.status === "completed" && !before.order.completedAt) patch.completedAt = new Date();
      if (body.status === "delivered" && !before.order.deliveredAt) patch.deliveredAt = new Date();
    }
    if (body.advisorId !== undefined) patch.advisorId = body.advisorId;
    if (body.diagnosis !== undefined) patch.diagnosis = body.diagnosis;
    if (body.customerComplaint !== undefined) patch.customerComplaint = body.customerComplaint;
    if (body.note !== undefined) patch.note = body.note;
    if (body.promisedAt !== undefined) patch.promisedAt = body.promisedAt;
    if (body.discount !== undefined) patch.discount = body.discount;

    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const order = await updateServiceOrder(id, patch);
    if (!order) return notFound("Không tìm thấy lệnh sửa chữa.");

    // Báo khách SAU khi commit, không gọi trong transaction: webhook chậm/lỗi không được
    // giữ transaction mở hay làm rollback việc đã ghi xong. `notifyOrderStatusChanged` tự
    // lọc mốc đáng báo và tự bỏ qua nếu khách không có email; bản thân nó không throw.
    if (patch.status && patch.status !== before.order.status) {
      await notifyOrderStatusChanged({
        orderCode: order.code,
        status: patch.status,
        licensePlate: order.plateSnapshot,
        vehicle: before.vehicle ? `${before.vehicle.make} ${before.vehicle.model}` : null,
        customerName: before.customer?.name ?? null,
        customerEmail: before.customer?.email ?? null,
        customerPhone: before.customer?.phone ?? null,
        branchName: before.branch?.name ?? null,
        branchPhone: before.branch?.phone ?? null,
        promisedAt: order.promisedAt,
        total: order.total,
        note: order.note,
      });
    }

    return NextResponse.json({ order });
  });
}
