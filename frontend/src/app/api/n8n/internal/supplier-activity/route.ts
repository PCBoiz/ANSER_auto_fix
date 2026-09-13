import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { listSupplierActivity } from "@/server/store/purchaseLedger";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/supplier-activity?newDays=30&staleDays=60
// NCC mới xuất hiện trong `newDays` gần đây, và NCC cũ đã lâu (> `staleDays`) không có giao
// dịch nào mới — báo NỘI BỘ cho quản lý xưởng.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const newDays = Number(url.searchParams.get("newDays") ?? 30);
    const staleDays = Number(url.searchParams.get("staleDays") ?? 60);

    const [result, company] = await Promise.all([
      listSupplierActivity({
        newDays: Number.isFinite(newDays) ? newDays : 30,
        staleDays: Number.isFinite(staleDays) ? staleDays : 60,
      }),
      getCompanySettings(),
    ]);

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      new_days: newDays,
      stale_days: staleDays,
      new_suppliers: result.newSuppliers.map((s) => ({
        partner_name: s.partnerName,
        first_seen: s.firstSeen,
        total_spent: s.totalSpent,
      })),
      stale_suppliers: result.staleSuppliers.map((s) => ({
        partner_name: s.partnerName,
        last_seen: s.lastSeen,
        total_spent: s.totalSpent,
      })),
    });
  });
}
