import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  appointments,
  invoices,
  purchaseLedger,
  salesLedger,
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

// --- Sổ kế toán (bán/mua hàng hoá) — dùng bởi workflow n8n (Kế toán) ---
// Tách khỏi getRevenueReport() ở trên vì nguồn hoàn toàn khác: doanh thu sửa xe tính từ
// `invoices`/`service_orders`, còn 3 hàm dưới đây đọc `sales_ledger`/`purchase_ledger` — sổ
// kế toán độc lập, không gắn lệnh sửa chữa (xem lý do tách bảng trong schema.ts).

// Doanh thu bán hàng gom theo đối tác (phần lớn là công ty bảo hiểm) — xem đối tác nào
// đóng góp doanh thu nhiều nhất trong kỳ, phục vụ đàm phán hợp tác lâu dài.
export async function getSalesByPartnerReport(period: ReportPeriod, limit = 10) {
  const from = periodStart(period);
  const to = new Date();
  const inPeriod = and(gte(salesLedger.voucherDate, from), lte(salesLedger.voucherDate, to));

  const partners = await db
    .select({
      partnerName: salesLedger.partnerName,
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${salesLedger.totalAmount}), 0)::int`,
    })
    .from(salesLedger)
    .where(inPeriod)
    .groupBy(salesLedger.partnerName)
    .orderBy(desc(sql`sum(${salesLedger.totalAmount})`))
    .limit(limit);

  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${salesLedger.totalAmount}), 0)::int`,
    })
    .from(salesLedger)
    .where(inPeriod);

  return {
    period,
    periodLabel: REPORT_PERIOD_LABELS[period],
    from,
    to,
    totalCount: totals?.count ?? 0,
    totalAmount: totals?.totalAmount ?? 0,
    partners,
  };
}

// Thuế GTGT đầu ra (bán hàng) trừ đầu vào (mua hàng) trong kỳ — số dương là số ước tính phải
// nộp thêm, số âm là số được khấu trừ/kết chuyển. CHỈ mang tính tham khảo nhanh cho kế toán,
// không thay thế tờ khai thuế thật (còn phụ thuộc hoá đơn đã nhận đủ hay chưa — xem
// listPendingInvoicePurchases() ở purchaseLedger.ts).
export async function getVatSummaryReport(period: ReportPeriod) {
  const from = periodStart(period);
  const to = new Date();

  const [salesTotals] = await db
    .select({
      vatOutput: sql<number>`coalesce(sum(${salesLedger.vatAmount}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${salesLedger.totalAmount}), 0)::int`,
    })
    .from(salesLedger)
    .where(and(gte(salesLedger.voucherDate, from), lte(salesLedger.voucherDate, to)));

  const [purchaseTotals] = await db
    .select({
      vatInput: sql<number>`coalesce(sum(${purchaseLedger.vatAmount}), 0)::int`,
      spend: sql<number>`coalesce(sum(${purchaseLedger.totalAmount}), 0)::int`,
    })
    .from(purchaseLedger)
    .where(and(gte(purchaseLedger.postingDate, from), lte(purchaseLedger.postingDate, to)));

  const vatOutput = salesTotals?.vatOutput ?? 0;
  const vatInput = purchaseTotals?.vatInput ?? 0;

  return {
    period,
    periodLabel: REPORT_PERIOD_LABELS[period],
    from,
    to,
    vatOutput,
    vatInput,
    vatPayable: vatOutput - vatInput,
    revenue: salesTotals?.revenue ?? 0,
    spend: purchaseTotals?.spend ?? 0,
  };
}

export type LedgerAnomaly = {
  source: "sales" | "purchase";
  partnerName: string;
  voucherNo: string | null;
  date: Date;
  totalAmount: number;
  average: number;
  multiple: number;
};

// Chứng từ có giá trị vượt trội hẳn so với trung bình lịch sử — không khẳng định là sai, chỉ
// gắn cờ để kế toán liếc lại (khả năng gõ nhầm thêm số 0, hoặc đơn thật sự lớn cần xác nhận
// lại). `multiplier` mặc định 5 lần trung bình — ngưỡng tuỳ chỉnh được qua query string.
export async function getLedgerAnomalies(options: { days: number; multiplier: number }) {
  const cutoff = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);

  const [salesAvg] = await db
    .select({ avg: sql<number>`coalesce(avg(${salesLedger.totalAmount}), 0)::float` })
    .from(salesLedger);
  const [purchaseAvg] = await db
    .select({ avg: sql<number>`coalesce(avg(${purchaseLedger.totalAmount}), 0)::float` })
    .from(purchaseLedger);

  // Làm tròn về nguyên trước khi đưa vào so sánh — `total_amount` là cột `integer`, Postgres
  // từ chối bind tham số thập phân dù chỉ để so sánh lớn hơn (lỗi 22P02, không tự ép kiểu).
  const salesThreshold = Math.round((salesAvg?.avg ?? 0) * options.multiplier);
  const purchaseThreshold = Math.round((purchaseAvg?.avg ?? 0) * options.multiplier);

  const salesRows = salesThreshold > 0
    ? await db
        .select()
        .from(salesLedger)
        .where(and(gte(salesLedger.voucherDate, cutoff), sql`${salesLedger.totalAmount} > ${salesThreshold}`))
        .orderBy(desc(salesLedger.totalAmount))
    : [];
  const purchaseRows = purchaseThreshold > 0
    ? await db
        .select()
        .from(purchaseLedger)
        .where(
          and(gte(purchaseLedger.postingDate, cutoff), sql`${purchaseLedger.totalAmount} > ${purchaseThreshold}`),
        )
        .orderBy(desc(purchaseLedger.totalAmount))
    : [];

  const anomalies: LedgerAnomaly[] = [
    ...salesRows.map((r) => ({
      source: "sales" as const,
      partnerName: r.partnerName,
      voucherNo: r.voucherNo,
      date: r.voucherDate,
      totalAmount: r.totalAmount,
      average: Math.round(salesAvg?.avg ?? 0),
      multiple: Math.round((r.totalAmount / (salesAvg?.avg || 1)) * 10) / 10,
    })),
    ...purchaseRows.map((r) => ({
      source: "purchase" as const,
      partnerName: r.partnerName,
      voucherNo: r.voucherNo,
      date: r.postingDate,
      totalAmount: r.totalAmount,
      average: Math.round(purchaseAvg?.avg ?? 0),
      multiple: Math.round((r.totalAmount / (purchaseAvg?.avg || 1)) * 10) / 10,
    })),
  ].sort((a, b) => b.multiple - a.multiple);

  return { days: options.days, multiplier: options.multiplier, anomalies };
}
