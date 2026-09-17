import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { optionalNonNegativeInt, optionalText, optionalUuid, parseBody, requiredText } from "@/server/validation";
import { createVehicle, DuplicatePlateError, listVehicles } from "@/server/store/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const search = new URL(request.url).searchParams.get("search") ?? undefined;
    return NextResponse.json({ vehicles: await listVehicles(search) });
  });
}

const createSchema = z.object({
  licensePlate: requiredText("Biển số", 20),
  make: requiredText("Hãng xe", 50),
  model: requiredText("Dòng xe", 50),
  customerId: optionalUuid,
  vin: optionalText(30),
  // Năm sản xuất: từ 1950 tới năm sau hiện tại (xe đời mới đăng ký trước). Gõ 2 chữ số
  // ("24") hay nhầm số km vào ô năm là lỗi thật đã gặp ở form.
  year: z
    .union([z.coerce.number().int().min(1950, "Năm sản xuất không hợp lệ.").max(new Date().getFullYear() + 1, "Năm sản xuất không hợp lệ."), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  color: optionalText(50),
  engineNumber: optionalText(50),
  fuelType: optionalText(20),
  transmission: optionalText(20),
  odometer: optionalNonNegativeInt.optional(),
  note: optionalText(2000),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    try {
      const vehicle = await createVehicle({ ...body, odometer: body.odometer ?? null });
      return NextResponse.json({ vehicle }, { status: 201 });
    } catch (error) {
      if (error instanceof DuplicatePlateError) return conflict(error.message);
      throw error;
    }
  });
}
