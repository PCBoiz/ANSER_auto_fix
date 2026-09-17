import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { createServiceOrder, listServiceOrders } from "@/server/store/serviceOrders";
import { optionalDate, optionalNonNegativeInt, optionalText, optionalUuid, parseBody, uuidField } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    return NextResponse.json({
      orders: await listServiceOrders({
        search: url.searchParams.get("search") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        activeOnly: url.searchParams.get("activeOnly") === "1",
      }),
    });
  });
}

const createSchema = z.object({
  branchId: uuidField,
  vehicleId: uuidField,
  customerId: optionalUuid,
  advisorId: optionalUuid,
  // Số km: nguyên không âm. Số âm hay "12.5" từ ô nhập là lỗi gõ, không phải dữ liệu.
  odometerIn: optionalNonNegativeInt.optional(),
  customerComplaint: optionalText(2000),
  promisedAt: optionalDate,
  note: optionalText(2000),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const order = await createServiceOrder({
      branchId: body.branchId,
      vehicleId: body.vehicleId,
      customerId: body.customerId,
      advisorId: body.advisorId,
      odometerIn: body.odometerIn ?? null,
      customerComplaint: body.customerComplaint,
      promisedAt: body.promisedAt,
      note: body.note,
    });

    return NextResponse.json({ order }, { status: 201 });
  });
}
