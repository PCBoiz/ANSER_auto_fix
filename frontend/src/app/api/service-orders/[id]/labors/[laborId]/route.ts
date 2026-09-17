import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, unauthorized } from "@/server/api";
import { LABOR_STATUSES } from "@/server/domain";
import { requireUser } from "@/server/session";
import { OrderLockedError, removeLabor, updateLabor } from "@/server/store/serviceOrders";
import {
  optionalNonNegativeInt,
  optionalText,
  optionalUuid,
  parseBody,
  positiveQuantity,
  vndAmount,
} from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; laborId: string }> };

const patchSchema = z.object({
  branchId: optionalUuid.optional(),
  technicianId: optionalUuid.optional(),
  note: optionalText(1000).optional(),
  status: z.enum(LABOR_STATUSES, { message: "Trạng thái công việc không hợp lệ." }).optional(),
  actualMinutes: optionalNonNegativeInt.optional(),
  unitPrice: vndAmount.optional(),
  quantity: positiveQuantity.optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { laborId } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const patch: Parameters<typeof updateLabor>[1] = {};
    if (body.branchId !== undefined) patch.branchId = body.branchId;
    if (body.technicianId !== undefined) patch.technicianId = body.technicianId;
    if (body.note !== undefined) patch.note = body.note;
    if (body.status !== undefined) patch.status = body.status;
    if (body.actualMinutes !== undefined) patch.actualMinutes = body.actualMinutes;
    if (body.unitPrice !== undefined) patch.unitPrice = body.unitPrice;
    if (body.quantity !== undefined) patch.quantity = body.quantity;

    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    try {
      return NextResponse.json({ labor: await updateLabor(laborId, patch) });
    } catch (error) {
      if (error instanceof OrderLockedError) return conflict(error.message);
      throw error;
    }
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { laborId } = await params;
    try {
      await removeLabor(laborId);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      if (error instanceof OrderLockedError) return conflict(error.message);
      throw error;
    }
  });
}
