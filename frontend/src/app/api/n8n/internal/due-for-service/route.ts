import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { getCompanySettings } from "@/server/store/settings";
import { listVehiclesDueForService } from "@/server/store/vehicles";

export const dynamic = "force-dynamic";

const DUE_REASON_LABELS = {
  date: "tới hạn theo thời gian",
  odometer: "tới hạn theo số km",
  both: "tới hạn theo cả thời gian và số km",
} as const;

// GET /api/n8n/internal/due-for-service
//
// Ngưỡng ngày/km đọc từ quy tắc `maintenance_reminder` trong DB — tham số `?days=&km=` trên
// URL chỉ có tác dụng khi kèm `override=1` (xem automation/rules.ts). Trước đây workflow
// truyền cứng `?days=7&km=500`, nên sửa ngưỡng trên trang Tự động hoá không có tác dụng.
//
// Trả kèm `contactable` (có email để nhắc được hay không) để workflow lọc thẳng, và để email
// tổng gửi cho gara nói rõ còn bao nhiêu khách phải gọi điện tay.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("maintenance_reminder", request, { days: 7, km: 500 });
    if (!rule.enabled) {
      await recordRuleRun("maintenance_reminder", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json(skippedPayload("maintenance_reminder"));
    }

    const [vehicles, company] = await Promise.all([
      listVehiclesDueForService({
        withinDays: rule.thresholdDays ?? 7,
        withinKm: rule.thresholdKm ?? 500,
      }),
      getCompanySettings(),
    ]);

    const items = vehicles.map((vehicle) => ({
      license_plate: vehicle.licensePlate,
      vehicle: `${vehicle.make} ${vehicle.model}`,
      odometer: vehicle.odometer,
      next_service_at: vehicle.nextServiceAt,
      next_service_odometer: vehicle.nextServiceOdometer,
      due_reason: vehicle.dueReason,
      due_reason_label: DUE_REASON_LABELS[vehicle.dueReason],
      customer_name: vehicle.customerName,
      customer_phone: vehicle.customerPhone,
      customer_email: vehicle.customerEmail,
      contactable: Boolean(vehicle.customerEmail),
    }));

    const contactableCount = items.filter((item) => item.contactable).length;
    await recordRuleRun("maintenance_reminder", {
      status: "fetched",
      summary: `${items.length} xe tới hạn (${contactableCount} có email) — ngưỡng ${rule.thresholdDays} ngày / ${rule.thresholdKm} km`,
      source,
    });

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      threshold_days: rule.thresholdDays,
      threshold_km: rule.thresholdKm,
      count: items.length,
      contactable_count: contactableCount,
      items,
    });
  });
}
