import { NextResponse } from "next/server";
import { handle, unauthorized } from "@/server/api";
import { globalSearch } from "@/server/search";
import { requireUser, resolveUserFlow } from "@/server/session";

export const dynamic = "force-dynamic";

// GET /api/search?q=... — ô tìm kiếm ở Topbar.
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (!user) return unauthorized();

    const q = new URL(request.url).searchParams.get("q") ?? "";
    // Giới hạn độ dài: chuỗi tìm dài vài nghìn ký tự chỉ để bắt DB chạy ILIKE vô ích.
    const hits = await globalSearch(q.slice(0, 100), await resolveUserFlow(user));
    return NextResponse.json({ hits });
  });
}
