import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, handle, unauthorized } from "@/server/api";
import { requireManager, requireUser } from "@/server/session";
import { getCompanySettings, updateCompanySettings } from "@/server/store/settings";
import { optionalEmail, optionalText, parseBody, requiredText, vndAmount } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    return NextResponse.json({ settings: await getCompanySettings() });
  });
}

const patchSchema = z.object({
  name: requiredText("Tên doanh nghiệp", 200).optional(),
  address: optionalText(300).optional(),
  phone: optionalText(30).optional(),
  email: optionalEmail.optional(),
  taxCode: optionalText(30).optional(),
  currency: z.enum(["VND", "USD"], { message: "Đơn vị tiền tệ phải là VND hoặc USD." }).optional(),
  defaultTaxRate: z.coerce
    .number({ message: "Thuế suất không hợp lệ." })
    .int("Thuế suất là số nguyên phần trăm.")
    .min(0, "Thuế suất phải trong khoảng 0–100.")
    .max(100, "Thuế suất phải trong khoảng 0–100.")
    .optional(),
  defaultLaborRate: vndAmount.optional(),
  maintenanceIntervalDays: z.coerce
    .number({ message: "Chu kỳ bảo dưỡng không hợp lệ." })
    .int()
    .positive("Chu kỳ bảo dưỡng phải lớn hơn 0.")
    .optional(),
  maintenanceIntervalKm: z.coerce
    .number({ message: "Chu kỳ bảo dưỡng theo km không hợp lệ." })
    .int()
    .positive("Chu kỳ bảo dưỡng theo km phải lớn hơn 0.")
    .optional(),
});

export async function PATCH(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireManager())) return forbidden("Chỉ quản lý trở lên mới sửa được cài đặt.");

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;

    const patch: Parameters<typeof updateCompanySettings>[0] = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    return NextResponse.json({ settings: await updateCompanySettings(patch) });
  });
}
