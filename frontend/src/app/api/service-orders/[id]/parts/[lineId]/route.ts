import { after, NextResponse } from "next/server";
import { conflict, handle, unauthorized } from "@/server/api";
import { requireUser } from "@/server/session";
import { syncRevenueIncidentsSafe } from "@/server/revenueGuard";
import { OrderLockedError, removePart } from "@/server/store/serviceOrders";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const { lineId } = await params;
    try {
      await removePart(lineId);
      after(syncRevenueIncidentsSafe);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      if (error instanceof OrderLockedError) return conflict(error.message);
      throw error;
    }
  });
}
