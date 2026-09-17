import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handle, notFound, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { optionalEmail, optionalText, parseBody, pickDefined, requiredText } from "@/server/validation";
import {
  deleteCustomer,
  getCustomerById,
  listCustomerVehicles,
  updateCustomer,
} from "@/server/store/customers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    const customer = await getCustomerById(id);
    if (!customer) return notFound("Không tìm thấy khách hàng.");
    return NextResponse.json({ customer, vehicles: await listCustomerVehicles(id) });
  });
}

const patchSchema = z.object({
  name: requiredText("Tên khách hàng", 200).optional(),
  type: z.enum(["individual", "company"], { message: "Loại khách hàng phải là cá nhân hoặc công ty." }).optional(),
  phone: optionalText(30).optional(),
  email: optionalEmail.optional(),
  address: optionalText(300).optional(),
  taxCode: optionalText(30).optional(),
  note: optionalText(2000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const patch = pickDefined(parsed.data);
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    const customer = await updateCustomer(id, patch);
    if (!customer) return notFound("Không tìm thấy khách hàng.");
    return NextResponse.json({ customer });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    if (!(await getCustomerById(id))) return notFound("Không tìm thấy khách hàng.");
    await deleteCustomer(id);
    return new NextResponse(null, { status: 204 });
  });
}
