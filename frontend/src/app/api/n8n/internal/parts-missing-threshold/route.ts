import { NextResponse } from "next/server";
import { handle, notFound } from "@/server/api";
import { checkInternalToken } from "@/server/internalAuth";
import { getBranchById } from "@/server/store/branches";
import { listPartsMissingThreshold } from "@/server/store/parts";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/parts-missing-threshold?branchId=...&limit=20
// Phụ tùng chưa đặt ngưỡng tồn kho tối thiểu riêng — báo NỘI BỘ cho quản lý xưởng, ưu tiên
// đặt ngưỡng cho các mã đang tồn thấp trước (sắp theo stock tăng dần).
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 20);

    let branchName: string | null = null;
    if (branchId) {
      const branch = await getBranchById(branchId);
      if (!branch) return notFound("Không tìm thấy chi nhánh.");
      branchName = branch.name;
    }

    const [result, company] = await Promise.all([
      listPartsMissingThreshold({ branchId, limit: Number.isFinite(limit) ? limit : 20 }),
      getCompanySettings(),
    ]);

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      branch_id: branchId ?? null,
      branch_name: branchName,
      count: result.count,
      sample: result.sample,
    });
  });
}
