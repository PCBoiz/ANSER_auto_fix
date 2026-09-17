import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { optionalEmail, optionalText, parseBody, requiredText } from "@/server/validation";
import { createCustomer, listCustomers } from "@/server/store/customers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const search = new URL(request.url).searchParams.get("search") ?? undefined;
    return NextResponse.json({ customers: await listCustomers(search) });
  });
}

const createSchema = z.object({
  name: requiredText("Tên khách hàng", 200),
  type: z.enum(["individual", "company"], { message: "Loại khách hàng phải là cá nhân hoặc công ty." }).default("individual"),
  phone: optionalText(30),
  email: optionalEmail,
  address: optionalText(300),
  taxCode: optionalText(30),
  note: optionalText(2000),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;

    const customer = await createCustomer(parsed.data);
    return NextResponse.json({ customer }, { status: 201 });
  });
}
