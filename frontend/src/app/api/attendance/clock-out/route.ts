import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, handle, unauthorized } from "@/server/api";
import { requireEmployeeLink } from "@/server/session";
import { optionalText, parseBody } from "@/server/validation";
import { clockOut, NotClockedInError } from "@/server/store/attendance";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    const link = await requireEmployeeLink();
    if (!link) return unauthorized();
    if (!link.employee) return badRequest("Tài khoản chưa liên kết hồ sơ nhân sự.");

    // Body có thể rỗng (nút "Ra ca" không kèm ghi chú) — chấp nhận cả JSON rỗng.
    const parsed = await parseBody(request, z.object({ note: optionalText(1000).optional() }).default({}));
    if (!parsed.ok) return parsed.response;
    const note = parsed.data.note;

    try {
      const log = await clockOut(link.employee.id, note);
      return NextResponse.json({ log });
    } catch (error) {
      if (error instanceof NotClockedInError) return conflict(error.message);
      throw error;
    }
  });
}
