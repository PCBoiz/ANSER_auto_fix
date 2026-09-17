import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  appointments,
  invoices,
  serviceOrderLabors,
  serviceOrderParts,
  serviceOrders,
  vehicles,
} from "@/server/db/schema";
import { ACTIVE_ORDER_STATUSES } from "@/server/domain";
import { listLowStockParts, type LowStockPart } from "@/server/store/parts";
import { listVehiclesDueForService, type VehicleDueForService } from "@/server/store/vehicles";

export type OverviewSummary = {
  activeOrders: number;
  deliveredToday: number;
  appointmentsToday: number;
  vehicleCount: number;
  revenueThisMonth: number;
  unpaidAmount: number;
  lowStockParts: LowStockPart[];
  dueForService: VehicleDueForService[];
};

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date = new Date()) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Tổng hợp cho trang Tổng quan. Dùng chung với endpoint n8n để hai nơi không bao giờ
// báo hai con số khác nhau cho cùng một chỉ số.
//
// MỘT round-trip cho 6 con số KPI, thay vì 6 truy vấn tuần tự như trước. Đo trước khi sửa
// (ARCHITECTURE.md §10): ~3,4 giây ở lần tải đầu từ Việt Nam — mỗi truy vấn tới Neon là một
// vòng WebSocket ~250–400ms, và chúng chạy nối đuôi nhau dù không phụ thuộc gì nhau. Hai
// danh sách (tồn thấp, xe tới hạn) chạy song song với câu KPI, nên tổng còn 1 vòng thay vì 8.
export async function getOverviewSummary(): Promise<OverviewSummary> {
  const todayStart = startOfDay();
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = startOfMonth();

  const kpiQuery = db
    .select({
      activeOrders: sql<number>`(
        select count(*) from ${serviceOrders}
        where ${inArray(serviceOrders.status, ACTIVE_ORDER_STATUSES)}
      )::int`,
      deliveredToday: sql<number>`(
        select count(*) from ${serviceOrders}
        where ${eq(serviceOrders.status, "delivered")}
          and ${gte(serviceOrders.deliveredAt, todayStart)}
          and ${lte(serviceOrders.deliveredAt, todayEnd)}
      )::int`,
      appointmentsToday: sql<number>`(
        select count(*) from ${appointments}
        where ${gte(appointments.scheduledAt, todayStart)}
          and ${lte(appointments.scheduledAt, todayEnd)}
          and ${inArray(appointments.status, ["pending", "confirmed"])}
      )::int`,
      vehicleCount: sql<number>`(select count(*) from ${vehicles})::int`,
      revenueThisMonth: sql<number>`(
        select coalesce(sum(${invoices.total}), 0) from ${invoices}
        where ${gte(invoices.issuedAt, monthStart)}
      )::int`,
      unpaidAmount: sql<number>`(
        select coalesce(sum(${invoices.total} - ${invoices.paidAmount}), 0) from ${invoices}
        where ${inArray(invoices.status, ["unpaid", "partial"])}
      )::int`,
    })
    .from(sql`(select 1) as _`);

  const [[kpi], lowStockParts, dueForService] = await Promise.all([
    kpiQuery,
    // Trang chỉ hiện 10 dòng — không kéo cả 724 dòng tồn thấp về rồi cắt ở JS.
    listLowStockParts({ limit: 10 }),
    listVehiclesDueForService(),
  ]);

  return {
    activeOrders: kpi?.activeOrders ?? 0,
    deliveredToday: kpi?.deliveredToday ?? 0,
    appointmentsToday: kpi?.appointmentsToday ?? 0,
    vehicleCount: kpi?.vehicleCount ?? 0,
    revenueThisMonth: kpi?.revenueThisMonth ?? 0,
    unpaidAmount: kpi?.unpaidAmount ?? 0,
    lowStockParts,
    dueForService: dueForService.slice(0, 10),
  };
}

// --- Báo cáo doanh thu theo kỳ (dùng bởi workflow n8n "Báo cáo doanh thu") ---

export const REPORT_PERIODS = ["day", "week", "month"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  day: "hôm nay",
  week: "7 ngày qua",
  month: "30 ngày qua",
};

export type RevenueReport = {
  period: ReportPeriod;
  periodLabel: string;
  from: Date;
  to: Date;
  invoiceCount: number;
  revenue: number;
  collected: number;
  outstanding: number;
  laborRevenue: number;
  partsRevenue: number;
  ordersDelivered: number;
  topServices: Array<{ name: string; quantity: number; revenue: number }>;
  topParts: Array<{ name: string; quantity: number; revenue: number }>;
};

function periodStart(period: ReportPeriod): Date {
  if (period === "day") return startOfDay();
  const days = period === "week" ? 7 : 30;
  return new Date(startOfDay().getTime() - days * 24 * 60 * 60 * 1000);
}

// Doanh thu tính theo NGÀY XUẤT HOÁ ĐƠN (`invoices.issuedAt`), không theo ngày lập lệnh
// sửa chữa: một lệnh mở tháng trước và thanh toán tháng này thuộc doanh thu tháng này.
export async function getRevenueReport(period: ReportPeriod): Promise<RevenueReport> {
  const from = periodStart(period);
  const to = new Date();

  const inPeriod = and(gte(invoices.issuedAt, from), lte(invoices.issuedAt, to));

  const [totals] = await db
    .select({
      invoiceCount: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${invoices.total}), 0)::int`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::int`,
    })
    .from(invoices)
    .where(inPeriod);

  const [orderTotals] = await db
    .select({
      laborRevenue: sql<number>`coalesce(sum(${serviceOrders.laborTotal}), 0)::int`,
      partsRevenue: sql<number>`coalesce(sum(${serviceOrders.partsTotal}), 0)::int`,
      ordersDelivered: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .innerJoin(serviceOrders, eq(invoices.serviceOrderId, serviceOrders.id))
    .where(inPeriod);

  const topServices = await db
    .select({
      name: serviceOrderLabors.name,
      quantity: sql<number>`coalesce(sum(${serviceOrderLabors.quantity}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${serviceOrderLabors.lineTotal}), 0)::int`,
    })
    .from(serviceOrderLabors)
    .innerJoin(invoices, eq(invoices.serviceOrderId, serviceOrderLabors.serviceOrderId))
    .where(inPeriod)
    .groupBy(serviceOrderLabors.name)
    .orderBy(desc(sql`sum(${serviceOrderLabors.lineTotal})`))
    .limit(5);

  const topParts = await db
    .select({
      name: serviceOrderParts.name,
      quantity: sql<number>`coalesce(sum(${serviceOrderParts.quantity}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${serviceOrderParts.lineTotal}), 0)::int`,
    })
    .from(serviceOrderParts)
    .innerJoin(invoices, eq(invoices.serviceOrderId, serviceOrderParts.serviceOrderId))
    .where(inPeriod)
    .groupBy(serviceOrderParts.name)
    .orderBy(desc(sql`sum(${serviceOrderParts.lineTotal})`))
    .limit(5);

  const revenue = totals?.revenue ?? 0;
  const collected = totals?.collected ?? 0;

  return {
    period,
    periodLabel: REPORT_PERIOD_LABELS[period],
    from,
    to,
    invoiceCount: totals?.invoiceCount ?? 0,
    revenue,
    collected,
    outstanding: revenue - collected,
    laborRevenue: orderTotals?.laborRevenue ?? 0,
    partsRevenue: orderTotals?.partsRevenue ?? 0,
    ordersDelivered: orderTotals?.ordersDelivered ?? 0,
    topServices,
    topParts,
  };
}
