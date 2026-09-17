import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, notFound, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import {
  optionalDate,
  optionalNonNegativeInt,
  optionalText,
  optionalUuid,
  parseBody,
  pickDefined,
  requiredText,
} from "@/server/validation";
import {
  deleteVehicle,
  DuplicatePlateError,
  getVehicleById,
  listVehicleHistory,
  updateVehicle,
  type VehicleInput,
} from "@/server/store/vehicles";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    const vehicle = await getVehicleById(id);
    if (!vehicle) return notFound("Không tìm thấy xe.");
    return NextResponse.json({ vehicle, history: await listVehicleHistory(id) });
  });
}

// Mọi trường `.optional()` bọc ngoài: không gửi = giữ nguyên (xem BẪY KHI DÙNG CHO PATCH
// trong validation.ts).
const patchSchema = z.object({
  licensePlate: requiredText("Biển số", 20).optional(),
  make: requiredText("Hãng xe", 50).optional(),
  model: requiredText("Dòng xe", 50).optional(),
  customerId: optionalUuid.optional(),
  vin: optionalText(30).optional(),
  year: z
    .union([z.coerce.number().int().min(1950, "Năm sản xuất không hợp lệ.").max(new Date().getFullYear() + 1, "Năm sản xuất không hợp lệ."), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "" || v === null ? null : v)),
  color: optionalText(50).optional(),
  engineNumber: optionalText(50).optional(),
  fuelType: optionalText(20).optional(),
  transmission: optionalText(20).optional(),
  odometer: optionalNonNegativeInt.optional(),
  nextServiceAt: optionalDate.optional(),
  nextServiceOdometer: optionalNonNegativeInt.optional(),
  note: optionalText(2000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const patch: Partial<VehicleInput> = pickDefined(parsed.data);
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    try {
      const vehicle = await updateVehicle(id, patch);
      if (!vehicle) return notFound("Không tìm thấy xe.");
      return NextResponse.json({ vehicle });
    } catch (error) {
      if (error instanceof DuplicatePlateError) return conflict(error.message);
      throw error;
    }
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    if (!(await getVehicleById(id))) return notFound("Không tìm thấy xe.");

    // Xe đã từng vào xưởng thì không cho xoá: `service_orders.vehicleId` là NOT NULL nên
    // xoá sẽ lỗi FK ở tầng DB — chặn ở đây để trả thông báo người dùng hiểu được thay vì
    // một lỗi Postgres thô.
    const history = await listVehicleHistory(id);
    if (history.length > 0) {
      return conflict(
        `Xe này có ${history.length} lệnh sửa chữa trong lịch sử nên không xoá được. Hãy sửa lại thông tin xe thay vì xoá.`,
      );
    }

    await deleteVehicle(id);
    return new NextResponse(null, { status: 204 });
  });
}
