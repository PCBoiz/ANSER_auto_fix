import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, unauthorized } from "@/server/api";
import { APPOINTMENT_STATUSES } from "@/server/domain";
import { requireUser } from "@/server/session";
import { dateField, optionalText, optionalUuid, parseBody, uuidField } from "@/server/validation";
import { createAppointment, listAppointments } from "@/server/store/appointments";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    return NextResponse.json({
      appointments: await listAppointments({
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        status: url.searchParams.get("status") ?? undefined,
      }),
    });
  });
}

const createSchema = z
  .object({
    branchId: uuidField,
    scheduledAt: dateField,
    customerId: optionalUuid,
    vehicleId: optionalUuid,
    contactName: optionalText(200),
    contactPhone: optionalText(30),
    plateText: optionalText(20),
    source: z.enum(["phone", "web", "walk_in", "reminder"], { message: "Nguồn lịch hẹn không hợp lệ." }).default("phone"),
    requestNote: optionalText(2000),
    status: z.enum(APPOINTMENT_STATUSES, { message: "Trạng thái không hợp lệ." }).default("pending"),
  })
  // Khách chưa có hồ sơ vẫn đặt lịch được, nhưng phải có ÍT NHẤT một cách liên hệ lại.
  .refine((v) => v.customerId || v.contactName || v.contactPhone, {
    message: "Cần chọn khách hàng hoặc nhập tên/số điện thoại liên hệ.",
    path: ["contactPhone"],
  });

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;

    const appointment = await createAppointment(parsed.data);
    return NextResponse.json({ appointment }, { status: 201 });
  });
}
