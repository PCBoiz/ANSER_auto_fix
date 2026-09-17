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

export async function getSalesLedgerEntryById(id: string) {
  const [entry] = await db.select().from(salesLedger).where(eq(salesLedger.id, id)).limit(1);
  return entry;
}

// Sửa chứng từ. Nhận `Partial` và chỉ ghi đúng những trường có mặt — route đã validate
// bằng lược đồ PATCH không có default (xem ledgerSchemas.ts), nên trường không gửi lên
// sẽ không xuất hiện ở đây và giữ nguyên giá trị trong DB.
export async function updateSalesLedgerEntry(id: string, patch: Partial<SalesLedgerInput>) {
  if (Object.keys(patch).length === 0) return getSalesLedgerEntryById(id);
  const [entry] = await db.update(salesLedger).set(patch).where(eq(salesLedger.id, id)).returning();
  return entry;
}

export async function deleteSalesLedgerEntry(id: string) {
  const rows = await db.delete(salesLedger).where(eq(salesLedger.id, id)).returning({ id: salesLedger.id });
  return rows.length > 0;
}
