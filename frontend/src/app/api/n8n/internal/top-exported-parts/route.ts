import { NextResponse } from "next/server";
import { handle, notFound } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { getBranchById } from "@/server/store/branches";
import { listTopExportedParts } from "@/server/store/parts";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/top-exported-parts?days=30&limit=10&branchId=...
// Phụ tùng xuất kho nhiều nhất trong kỳ — báo NỘI BỘ cho quản lý xưởng, hỗ trợ quyết định
// nhập hàng gì nhiều thay vì suy đoán cảm tính.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? 30);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const branchId = url.searchParams.get("branchId") ?? undefined;

    let branchName: string | null = null;
    if (branchId) {
      const branch = await getBranchById(branchId);
      if (!branch) return notFound("Không tìm thấy chi nhánh.");
      branchName = branch.name;
    }

    const [items, company] = await Promise.all([
      listTopExportedParts({
        days: Number.isFinite(days) ? days : 30,
        limit: Number.isFinite(limit) ? limit : 10,
        branchId,
      }),
      getCompanySettings(),
    ]);

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      branch_id: branchId ?? null,
      branch_name: branchName,
      days,
      items: items.map((i) => ({
        code: i.code,
        name: i.name,
        unit: i.unit,
        category: i.category,
        total_quantity: i.totalQuantity,
        transaction_count: i.transactionCount,
      })),
    });
  });
}
