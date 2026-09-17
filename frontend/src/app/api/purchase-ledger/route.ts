import { NextResponse } from "next/server";
import { handle, unauthorized } from "@/server/api";
import { purchaseLedgerSchema } from "@/server/ledgerSchemas";
import { parseBody } from "@/server/validation";
import { requireUser } from "@/server/session";
import { createPurchaseLedgerEntry, listPurchaseLedger } from "@/server/store/purchaseLedger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const entries = await listPurchaseLedger({
      search: url.searchParams.get("search") ?? undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return NextResponse.json({ entries });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();

    const parsed = await parseBody(request, purchaseLedgerSchema);
    if (!parsed.ok) return parsed.response;

    const entry = await createPurchaseLedgerEntry(parsed.data);
    return NextResponse.json({ entry }, { status: 201 });
  });
}
