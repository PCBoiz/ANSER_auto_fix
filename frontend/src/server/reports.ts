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
export async function getOverviewSummary(): Promise<OverviewSummary> {
  const todayStart = startOfDay();
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = startOfMonth();

  const [activeOrdersRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceOrders)
    .where(inArray(serviceOrders.status, ACTIVE_ORDER_STATUSES));

  const [deliveredTodayRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceOrders)
    .where(
      and(
        eq(serviceOrders.status, "delivered"),
        gte(serviceOrders.deliveredAt, todayStart),
        lte(serviceOrders.deliveredAt, todayEnd),
      ),
    );

  const [appointmentsTodayRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        gte(appointments.scheduledAt, todayStart),
        lte(appointments.scheduledAt, todayEnd),
        inArray(appointments.status, ["pending", "confirmed"]),
      ),
    );

  const [vehicleRow] = await db.select({ count: sql<number>`count(*)::int` }).from(vehicles);

  const [revenueRow] = await db
    .select({ total: sql<number>`coalesce(sum(${invoices.total}), 0)::int` })
    .from(invoices)
    .where(gte(invoices.issuedAt, monthStart));

  const [unpaidRow] = await db
    .select({ total: sql<number>`coalesce(sum(${invoices.total} - ${invoices.paidAmount}), 0)::int` })
    .from(invoices)
    .where(inArray(invoices.status, ["unpaid", "partial"]));

  const [lowStockParts, dueForService] = await Promise.all([
    listLowStockParts(),
    listVehiclesDueForService(),
  ]);

  return {
    activeOrders: activeOrdersRow?.count ?? 0,
    deliveredToday: deliveredTodayRow?.count ?? 0,
    appointmentsToday: appointmentsTodayRow?.count ?? 0,
    vehicleCount: vehicleRow?.count ?? 0,
    revenueThisMonth: revenueRow?.total ?? 0,
    unpaidAmount: unpaidRow?.total ?? 0,
    lowStockParts: lowStockParts.slice(0, 10),
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
