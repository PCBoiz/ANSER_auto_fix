import { NextResponse } from "next/server";
import { handle, notFound } from "@/server/api";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getBranchById } from "@/server/store/branches";
import { countLowStockParts, listLowStockParts } from "@/server/store/parts";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/low-stock?branchId=...&limit=30
//
// `limit` (tuỳ chọn): chỉ trả N dòng tồn thấp nhất, kèm `total` là con số thật. Trên dữ
// liệu thật hôm 17/09/2026 kho đồng-sơn có 724 mặt hàng dưới ngưỡng mặc định — một email
// 724 dòng mỗi 6 giờ chỉ dạy người nhận lọc thẳng vào thùng rác. Workflow mẫu mới gửi
// `limit=30`.
//
// Vì sao KHÔNG cắt mặc định: workflow đã import từ trước tính số lượng bằng
// `items.length` ("Có N mã phụ tùng..."). Cắt ngầm thì email đó sẽ báo "30 phụ tùng sắp
// hết" trong khi thật là 724 — báo THIẾU còn nguy hiểm hơn báo ồn. Cách dập tiếng ồn
// đúng là đặt ngưỡng (ngưỡng 0 = không cảnh báo) ở trang Nhập giá hàng loạt.
//
// Ngưỡng chung đọc từ quy tắc `low_stock_alert`. Phụ tùng có `min_stock` riêng dùng ngưỡng
// riêng; `min_stock = 0` là CỐ Ý không cảnh báo (vật tư đặt theo xe) — xem belowThresholdSql.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? undefined;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("low_stock_alert", request, { qty: 5 });
    if (!rule.enabled) {
      await recordRuleRun("low_stock_alert", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json({ ...skippedPayload("low_stock_alert"), branch_id: branchId ?? null, branch_name: null });
    }

    let branchName: string | null = null;
    if (branchId) {
      const branch = await getBranchById(branchId);
      if (!branch) return notFound("Không tìm thấy chi nhánh.");
      branchName = branch.name;
    }

    const fallbackThreshold = rule.thresholdQty ?? 5;
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : undefined;

    const [items, total] = await Promise.all([
      listLowStockParts({ branchId, fallbackThreshold, limit }),
      countLowStockParts({ branchId, fallbackThreshold }),
    ]);

    await recordRuleRun("low_stock_alert", {
      status: "fetched",
      summary: `${branchName ?? "Toàn bộ chi nhánh"}: ${total} mặt hàng dưới ngưỡng (ngưỡng chung ${fallbackThreshold})`,
      source,
    });

    return NextResponse.json({
      branch_id: branchId ?? null,
      branch_name: branchName,
      threshold: fallbackThreshold,
      // `count` giữ nghĩa cũ (số dòng trong `items`) để workflow đã import không đổi hành vi;
      // `total` là con số thật, `truncated` báo email đang chỉ hiện một phần.
      count: items.length,
      total,
      truncated: total > items.length,
      items: items.map((part) => ({
        code: part.code,
        name: part.name,
        category: part.category,
        oem_number: part.oemNumber,
        unit: part.unit,
        stock: part.stock,
        threshold: part.threshold,
        location: part.location,
      })),
    });
  });
}
