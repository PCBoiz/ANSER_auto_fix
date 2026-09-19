import { after, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, notFound, unauthorized } from "@/server/api";
import { lineWarning } from "@/lib/revenueGuard";
import { requireUser } from "@/server/session";
import { syncRevenueIncidentsSafe } from "@/server/revenueGuard";
import { getServiceById } from "@/server/store/services";
import { addLabor, OrderLockedError, OrderNotFoundError } from "@/server/store/serviceOrders";
import {
  optionalNonNegativeInt,
  optionalText,
  optionalUuid,
  parseBody,
  positiveQuantity,
  vndAmount,
} from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  serviceId: optionalUuid,
  name: z.string().trim().max(300).optional(),
  // `.optional()` bọc ngoài — khác `serviceId`: không gửi `branchId` nghĩa là "để addLabor()
  // tự điền xưởng tiếp nhận", còn gửi "" là cố tình để trống. Ba trạng thái, không phải hai.
  branchId: optionalUuid.optional(),
  technicianId: optionalUuid,
  unitPrice: vndAmount.optional(),
  quantity: positiveQuantity.default(1),
  standardMinutes: optionalNonNegativeInt.optional(),
  note: optionalText(1000),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Chọn từ bảng giá thì lấy tên/giá/định mức từ đó và SNAPSHOT vào dòng công — sửa
    // bảng giá sau này không được làm đổi lệnh đã lập.
    let name = body.name ?? "";
    let unitPrice = body.unitPrice ?? 0;
    let standardMinutes = body.standardMinutes ?? null;

    if (body.serviceId) {
      const service = await getServiceById(body.serviceId);
      if (!service) return badRequest("Không tìm thấy hạng mục dịch vụ.");
      name = name || service.name;
      if (body.unitPrice === undefined) unitPrice = service.laborPrice;
      standardMinutes = standardMinutes ?? service.standardMinutes;
    }

    if (!name) return badRequest("Thiếu tên hạng mục công việc.");

    try {
      const labor = await addLabor(id, {
        serviceId: body.serviceId,
        name,
        branchId: body.branchId,
        technicianId: body.technicianId,
        unitPrice,
        quantity: body.quantity,
        standardMinutes,
        note: body.note,
      });
      const warning = lineWarning({ kind: "labor", name, unitPrice, unitCost: null, quantity: body.quantity });
      after(syncRevenueIncidentsSafe);
      return NextResponse.json({ labor, warning }, { status: 201 });
    } catch (error) {
      if (error instanceof OrderLockedError) return conflict(error.message);
      if (error instanceof OrderNotFoundError) return notFound(error.message);
      throw error;
    }
  });
}
