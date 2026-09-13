import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { salesLedger } from "@/server/db/schema";

export type SalesLedgerEntry = typeof salesLedger.$inferSelect;

export async function listSalesLedger(options?: {
  search?: string;
  from?: Date;
  to?: Date;
}) {
  const conditions = [];
  const term = options?.search?.trim();
  if (term) conditions.push(ilike(salesLedger.partnerName, `%${term}%`));
  if (options?.from) conditions.push(gte(salesLedger.voucherDate, options.from));
  if (options?.to) conditions.push(lte(salesLedger.voucherDate, options.to));

  return db
    .select()
    .from(salesLedger)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(salesLedger.voucherDate));
}

export type SalesLedgerInput = {
  voucherDate: Date;
  voucherNo?: string | null;
  invoiceNo?: string | null;
  partnerName: string;
  amountBeforeTax?: number;
  vatAmount?: number;
  totalAmount?: number;
  invoiceIssued?: boolean;
  goodsDelivered?: boolean;
  note?: string | null;
};

export async function createSalesLedgerEntry(input: SalesLedgerInput) {
  const [entry] = await db.insert(salesLedger).values(input).returning();
  return entry;
}

// --- Dùng cho workflow n8n (Kế toán) ---

// Đã xuất hàng cho khách nhưng chưa lập hoá đơn — rủi ro thất thu: hàng đã ra khỏi kho mà
// chưa có chứng từ thu tiền tương ứng, kế toán cần rà lại trước khi khách quên/khất nợ.
export async function listDeliveredNotInvoiced() {
  return db
    .select()
    .from(salesLedger)
    .where(and(eq(salesLedger.goodsDelivered, true), eq(salesLedger.invoiceIssued, false)))
    .orderBy(desc(salesLedger.voucherDate));
}
