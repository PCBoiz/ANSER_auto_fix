import { and, desc, gte, ilike, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { purchaseLedger } from "@/server/db/schema";

export type PurchaseLedgerEntry = typeof purchaseLedger.$inferSelect;

export async function listPurchaseLedger(options?: {
  search?: string;
  from?: Date;
  to?: Date;
}) {
  const conditions = [];
  const term = options?.search?.trim();
  if (term) conditions.push(ilike(purchaseLedger.partnerName, `%${term}%`));
  if (options?.from) conditions.push(gte(purchaseLedger.postingDate, options.from));
  if (options?.to) conditions.push(lte(purchaseLedger.postingDate, options.to));

  return db
    .select()
    .from(purchaseLedger)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchaseLedger.postingDate));
}

export type PurchaseLedgerInput = {
  postingDate: Date;
  voucherDate?: Date | null;
  voucherNo?: string | null;
  invoiceNo?: string | null;
  partnerName: string;
  description?: string | null;
  amountBeforeTax?: number;
  discountAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
  purchaseCost?: number;
  inventoryValue?: number;
  invoiceStatus?: "not_received" | "received" | "none";
  isPurchaseCost?: boolean;
  documentType?: string | null;
  note?: string | null;
};

export async function createPurchaseLedgerEntry(input: PurchaseLedgerInput) {
  const [entry] = await db.insert(purchaseLedger).values(input).returning();
  return entry;
}
