import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, notFound, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { optionalText, parseBody, pickDefined, requiredText, vndAmount } from "@/server/validation";
import {
  deleteService,
  DuplicateServiceCodeError,
  getServiceById,
  updateService,
  type ServiceInput,
} from "@/server/store/services";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  code: requiredText("Mã dịch vụ", 30).transform((v) => v.toUpperCase()).optional(),
  name: requiredText("Tên hạng mục", 200).optional(),
  category: requiredText("Nhóm dịch vụ", 100).optional(),
  standardMinutes: z.coerce
    .number({ message: "Giờ công định mức không hợp lệ." })
    .int("Giờ công định mức tính bằng phút, số nguyên.")
    .positive("Giờ công định mức phải lớn hơn 0.")
    .optional(),
  laborPrice: vndAmount.optional(),
  description: optionalText(2000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const patch: Partial<ServiceInput> = pickDefined(parsed.data);
    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    try {
      const service = await updateService(id, patch);
      if (!service) return notFound("Không tìm thấy hạng mục.");
      return NextResponse.json({ service });
    } catch (error) {
      if (error instanceof DuplicateServiceCodeError) return conflict(error.message);
      throw error;
    }
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { id } = await params;
    if (!(await getServiceById(id))) return notFound("Không tìm thấy hạng mục.");
    await deleteService(id);
    return new NextResponse(null, { status: 204 });
  });
}
