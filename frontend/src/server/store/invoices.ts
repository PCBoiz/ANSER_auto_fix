import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  branches,
  customers,
  employees,
  invoices,
  serviceOrderLabors,
  serviceOrderParts,
  serviceOrders,
  vehicles,
} from "@/server/db/schema";
import { nextInvoiceCode } from "@/server/store/codes";
import { getCompanySettings } from "@/server/store/settings";

export type Invoice = typeof invoices.$inferSelect;

export class InvoiceExistsError extends Error {
  constructor(code: string) {
    super(`Lệnh sửa chữa này đã có hoá đơn ${code}.`);
    this.name = "InvoiceExistsError";
  }
}

export class OrderNotReadyError extends Error {
  constructor() {
    super("Chỉ xuất hoá đơn cho lệnh đã hoàn tất hoặc đã giao xe.");
    this.name = "OrderNotReadyError";
  }
}

// Trạng thái thanh toán suy ra từ số tiền, không cho người dùng tự chọn: chọn tay là mở
// cửa cho hoá đơn ghi "đã thanh toán" mà số tiền thu vẫn bằng 0.
function derivePaymentStatus(total: number, paid: number) {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

export type InvoiceListItem = Invoice & { orderCode: string; orderStatus: string };

export async function listInvoices(options?: {
  search?: string;
  status?: string;
  from?: Date;
  to?: Date;
}): Promise<InvoiceListItem[]> {
  const conditions = [];
  const term = options?.search?.trim();
  if (term) {
    conditions.push(
      or(
        ilike(invoices.code, `%${term}%`),
        ilike(invoices.customerName, `%${term}%`),
        ilike(invoices.plateSnapshot, `%${term.replace(/[\s.\-_]/g, "").toUpperCase()}%`),
      )!,
    );
  }
  if (options?.status) conditions.push(eq(invoices.status, options.status));
  if (options?.from) conditions.push(gte(invoices.issuedAt, options.from));
  if (options?.to) conditions.push(lte(invoices.issuedAt, options.to));

  return db
    .select({
      id: invoices.id,
      code: invoices.code,
      serviceOrderId: invoices.serviceOrderId,
      customerId: invoices.customerId,
      customerName: invoices.customerName,
      plateSnapshot: invoices.plateSnapshot,
      subtotal: invoices.subtotal,
      discount: invoices.discount,
      taxRate: invoices.taxRate,
      taxAmount: invoices.taxAmount,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
      status: invoices.status,
      paymentMethod: invoices.paymentMethod,
      insuranceAmount: invoices.insuranceAmount,
      insuranceProvider: invoices.insuranceProvider,
      issuedAt: invoices.issuedAt,
      note: invoices.note,
      orderCode: serviceOrders.code,
      orderStatus: serviceOrders.status,
    })
    .from(invoices)
    .innerJoin(serviceOrders, eq(invoices.serviceOrderId, serviceOrders.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invoices.issuedAt));
}

export type UnpaidInvoiceItem = {
  code: string;
  customerName: string;
  plateSnapshot: string;
  total: number;
  paidAmount: number;
  outstanding: number;
  daysOld: number;
  status: string;
  customerPhone: string | null;
};

// Hoá đơn "unpaid"/"partial" đã phát hành quá `minDays` ngày — báo cáo NỘI BỘ cho quản lý,
// không gửi khách (quyết định nghiệp vụ: nhắc nợ qua email tự động dễ sai giọng, quản lý tự
// quyết cách đòi — gọi điện, nhắn riêng). Mốc tính là `issuedAt`, không đổi khi thu thêm tiền
// (khác `updatedAt` kiểu cột, ở đây bảng không có cột đó) nên "số ngày" luôn phản ánh đúng
// tuổi của hoá đơn, không bị reset mỗi lần khách trả một phần.
export async function listUnpaidInvoicesOlderThan(minDays: number): Promise<UnpaidInvoiceItem[]> {
  const rows = await db
    .select({
      code: invoices.code,
      customerName: invoices.customerName,
      plateSnapshot: invoices.plateSnapshot,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
      status: invoices.status,
      customerPhone: customers.phone,
      daysOld: sql<number>`floor(extract(epoch from (now() - ${invoices.issuedAt})) / 86400)::int`,
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      and(
        or(eq(invoices.status, "unpaid"), eq(invoices.status, "partial"))!,
        sql`${invoices.issuedAt} <= now() - (${minDays} || ' days')::interval`,
      ),
    )
    .orderBy(desc(invoices.issuedAt));

  return rows.map((r) => ({ ...r, outstanding: r.total - r.paidAmount }));
}

/**
 * Mọi thứ cần để IN một hoá đơn, trong một lần gọi.
 *
 * Dòng chi tiết đọc từ `service_order_labors`/`service_order_parts` — đúng thiết kế đã
 * có (hoá đơn không có bảng dòng riêng, vì hai bảng đó đã là snapshot bất biến). Tên
 * khách và biển số lấy từ SNAPSHOT trên chính hoá đơn, không join lại hồ sơ khách: khách
 * đổi tên hay xe đổi biển sau này không được làm tờ hoá đơn cũ in ra khác đi.
 */
export async function getInvoiceDetail(id: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!invoice) return undefined;

  const [order] = await db
    .select({
      code: serviceOrders.code,
      odometerIn: serviceOrders.odometerIn,
      receivedAt: serviceOrders.receivedAt,
      deliveredAt: serviceOrders.deliveredAt,
      customerComplaint: serviceOrders.customerComplaint,
      diagnosis: serviceOrders.diagnosis,
      laborTotal: serviceOrders.laborTotal,
      partsTotal: serviceOrders.partsTotal,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehicleYear: vehicles.year,
      vehicleVin: vehicles.vin,
      branchName: branches.name,
      branchAddress: branches.address,
      branchPhone: branches.phone,
      advisorName: employees.name,
    })
    .from(serviceOrders)
    .innerJoin(vehicles, eq(serviceOrders.vehicleId, vehicles.id))
    .innerJoin(branches, eq(serviceOrders.branchId, branches.id))
    .leftJoin(employees, eq(serviceOrders.advisorId, employees.id))
    .where(eq(serviceOrders.id, invoice.serviceOrderId))
    .limit(1);

  const [customer] = invoice.customerId
    ? await db
        .select({
          phone: customers.phone,
          address: customers.address,
          taxCode: customers.taxCode,
          type: customers.type,
        })
        .from(customers)
        .where(eq(customers.id, invoice.customerId))
        .limit(1)
    : [];

  const [labors, partLines] = await Promise.all([
    db
      .select({
        name: serviceOrderLabors.name,
        quantity: serviceOrderLabors.quantity,
        unitPrice: serviceOrderLabors.unitPrice,
        lineTotal: serviceOrderLabors.lineTotal,
      })
      .from(serviceOrderLabors)
      .where(eq(serviceOrderLabors.serviceOrderId, invoice.serviceOrderId))
      .orderBy(serviceOrderLabors.createdAt),
    db
      .select({
        name: serviceOrderParts.name,
        unit: serviceOrderParts.unit,
        quantity: serviceOrderParts.quantity,
        unitPrice: serviceOrderParts.unitPrice,
        lineTotal: serviceOrderParts.lineTotal,
      })
      .from(serviceOrderParts)
      .where(eq(serviceOrderParts.serviceOrderId, invoice.serviceOrderId))
      .orderBy(serviceOrderParts.createdAt),
  ]);

  return { invoice, order, customer, labors, parts: partLines };
}

export async function getInvoiceByOrderId(orderId: string): Promise<Invoice | undefined> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.serviceOrderId, orderId))
    .limit(1);
  return rows[0];
}

// Lệnh đã hoàn tất nhưng chưa có hoá đơn — nguồn cho dropdown "xuất hoá đơn cho lệnh nào".
export async function listInvoiceableOrders() {
  return db
    .select({
      id: serviceOrders.id,
      code: serviceOrders.code,
      plateSnapshot: serviceOrders.plateSnapshot,
      total: serviceOrders.total,
      status: serviceOrders.status,
      customerName: customers.name,
    })
    .from(serviceOrders)
    .leftJoin(customers, eq(serviceOrders.customerId, customers.id))
    .where(
      and(
        sql`${serviceOrders.status} in ('completed', 'delivered')`,
        sql`not exists (select 1 from ${invoices} where ${invoices.serviceOrderId} = ${serviceOrders.id})`,
      ),
    )
    .orderBy(desc(serviceOrders.receivedAt));
}

export async function createInvoice(input: {
  serviceOrderId: string;
  taxRate?: number;
  paidAmount?: number;
  paymentMethod?: string | null;
  insuranceAmount?: number;
  insuranceProvider?: string | null;
  note?: string | null;
}) {
  const [order] = await db
    .select()
    .from(serviceOrders)
    .where(eq(serviceOrders.id, input.serviceOrderId))
    .limit(1);
  if (!order) throw new Error("Không tìm thấy lệnh sửa chữa.");
  if (order.status !== "completed" && order.status !== "delivered") throw new OrderNotReadyError();

  const existing = await getInvoiceByOrderId(input.serviceOrderId);
  if (existing) throw new InvoiceExistsError(existing.code);

  const customer = order.customerId
    ? (await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1))[0]
    : undefined;

  const settings = await getCompanySettings();
  const taxRate = input.taxRate ?? settings.defaultTaxRate;

  // Tổng của lệnh (`order.total`) ĐÃ trừ giảm giá. Thuế tính trên số sau giảm giá — tính
  // trên số trước giảm giá sẽ thu thuế cho phần tiền khách không hề trả.
  const subtotal = order.laborTotal + order.partsTotal;
  const afterDiscount = order.total;
  const taxAmount = Math.round((afterDiscount * taxRate) / 100);
  const total = afterDiscount + taxAmount;
  const paidAmount = input.paidAmount ?? 0;

  const code = await nextInvoiceCode();

  const [invoice] = await db
    .insert(invoices)
    .values({
      code,
      serviceOrderId: input.serviceOrderId,
      customerId: order.customerId,
      // Snapshot để in hoá đơn không phụ thuộc hồ sơ khách còn tồn tại hay không.
      customerName: customer?.name ?? "Khách vãng lai",
      plateSnapshot: order.plateSnapshot,
      subtotal,
      discount: order.discount,
      taxRate,
      taxAmount,
      total,
      paidAmount,
      status: derivePaymentStatus(total, paidAmount),
      paymentMethod: input.paymentMethod ?? null,
      insuranceAmount: input.insuranceAmount ?? 0,
      insuranceProvider: input.insuranceProvider ?? null,
      note: input.note ?? null,
    })
    .returning();

  return invoice;
}

// Ghi nhận thanh toán. Nhận SỐ TIỀN ĐÃ THU LUỸ KẾ, không phải số cộng thêm — gửi lại cùng
// một request hai lần (mạng chập chờn, người dùng bấm đúp) không được cộng tiền hai lần.
export async function recordPayment(
  id: string,
  input: { paidAmount: number; paymentMethod?: string | null },
) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!invoice) return undefined;

  const paidAmount = Math.max(0, Math.min(input.paidAmount, invoice.total));

  const [updated] = await db
    .update(invoices)
    .set({
      paidAmount,
      status: derivePaymentStatus(invoice.total, paidAmount),
      paymentMethod: input.paymentMethod ?? invoice.paymentMethod,
    })
    .where(eq(invoices.id, id))
    .returning();

  return updated;
}
