import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handle, notFound, unauthorized } from "@/server/api";
import { APPOINTMENT_STATUSES } from "@/server/domain";
import { requireUser } from "@/server/session";
import { dateField, optionalText, optionalUuid, parseBody, pickDefined, uuidField } from "@/server/validation";
import {
  deleteAppointment,
  getAppointmentById,
  updateAppointment,
  type AppointmentInput,
} from "@/server/store/appointments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES, { message: "Trạng thái không hợp lệ." }).optional(),
  scheduledAt: dateField.optional(),
  branchId: uuidField.optional(),
  customerId: optionalUuid.optional(),
  vehicleId: optionalUuid.optional(),
  contactName: optionalText(200).optional(),
  contactPhone: optionalText(30).optional(),
  plateText: optionalText(20).optional(),
  requestNote: optionalText(2000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const patch: Partial<AppointmentInput> = pickDefined(parsed.data);
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const appointment = await updateAppointment(id, patch);
    if (!appointment) return notFound("Không tìm thấy lịch hẹn.");
    return NextResponse.json({ appointment });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    if (!(await getAppointmentById(id))) return notFound("Không tìm thấy lịch hẹn.");
    await deleteAppointment(id);
    return new NextResponse(null, { status: 204 });
  });
}
