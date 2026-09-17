import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { detectRunSource, recordRuleRun, resolveRuleConfig, skippedPayload } from "@/server/automation/rules";
import { checkInternalToken } from "@/server/internalAuth";
import { listUpcomingAppointments } from "@/server/store/appointments";
import { getCompanySettings } from "@/server/store/settings";

export const dynamic = "force-dynamic";

// GET /api/n8n/internal/appointments
//
// Khung thời gian đọc từ quy tắc `appointment_reminder`: `threshold_days` = nhắc trước bao
// nhiêu NGÀY (DB lưu 1 = 24 giờ tới). `?hours=` trên URL chỉ có tác dụng kèm `override=1`.
export async function GET(request: Request) {
  return handle(async () => {
    const denied = checkInternalToken(request);
    if (denied) return denied;

    const source = detectRunSource(request);
    const rule = await resolveRuleConfig("appointment_reminder", request, { days: 1 });
    if (!rule.enabled) {
      await recordRuleRun("appointment_reminder", { status: "skipped", summary: "Quy tắc đang tắt", source });
      return NextResponse.json(skippedPayload("appointment_reminder"));
    }

    // Chế độ thử tay (`override=1&hours=`) truyền thẳng số giờ; từ DB thì là số ngày.
    const url = new URL(request.url);
    const hoursOverride = rule.source === "override" ? Number(url.searchParams.get("hours")) : NaN;
    const hours = Number.isFinite(hoursOverride) && hoursOverride > 0 ? hoursOverride : (rule.thresholdDays ?? 1) * 24;

    const [appointments, company] = await Promise.all([
      listUpcomingAppointments(hours),
      getCompanySettings(),
    ]);

    const items = appointments.map((appointment) => ({
      id: appointment.id,
      scheduled_at: appointment.scheduledAt,
      // Định dạng sẵn giờ Việt Nam ở server: node Code trong n8n chạy theo timezone của
      // container, để nó tự format là mở đường cho email báo sai giờ hẹn.
      scheduled_at_text: appointment.scheduledAt.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      }),
      status: appointment.status,
      request_note: appointment.requestNote,
      branch_name: appointment.branchName,
      branch_phone: appointment.branchPhone,
      customer_name: appointment.contactName,
      customer_phone: appointment.contactPhone,
      customer_email: appointment.contactEmail,
      plate: appointment.plate,
      vehicle: appointment.vehicleLabel,
      contactable: Boolean(appointment.contactEmail),
    }));

    const contactableCount = items.filter((item) => item.contactable).length;
    await recordRuleRun("appointment_reminder", {
      status: "fetched",
      summary: `${items.length} lịch hẹn trong ${hours} giờ tới (${contactableCount} có email)`,
      source,
    });

    return NextResponse.json({
      company_name: company.name,
      company_email: company.email ?? process.env.N8N_NOTIFY_EMAIL ?? null,
      window_hours: hours,
      count: items.length,
      contactable_count: contactableCount,
      items,
    });
  });
}
