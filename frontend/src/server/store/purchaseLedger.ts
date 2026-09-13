import { and, asc, desc, gte, ilike, inArray, lte, sql } from "drizzle-orm";
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

// --- Dùng cho workflow n8n (Kế toán) ---

// Phiếu mua hàng đã lập quá `days` ngày mà chưa nhận được hoá đơn đỏ — kế toán cần gọi lại
// nhà cung cấp để đòi, vì thiếu hoá đơn thì không khấu trừ được thuế GTGT đầu vào cho lô đó.
export async function listPendingInvoicePurchases(days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(purchaseLedger)
    .where(
      and(
        inArray(purchaseLedger.invoiceStatus, ["not_received", "none"]),
        lte(purchaseLedger.postingDate, cutoff),
      ),
    )
    .orderBy(asc(purchaseLedger.postingDate));
}

// Công nợ phải trả — gom theo nhà cung cấp những phiếu có `documentType` ghi rõ "chưa thanh
// toán" (đúng nhãn dữ liệu gốc từ phần mềm kế toán, không có cột trạng thái thanh toán riêng).
export async function listUnpaidPurchasesByPartner() {
  return db
    .select({
      partnerName: purchaseLedger.partnerName,
      count: sql<number>`count(*)`.mapWith(Number),
      totalOutstanding: sql<number>`sum(${purchaseLedger.totalAmount})`.mapWith(Number),
      oldestDate: sql<string>`min(${purchaseLedger.postingDate})`,
    })
    .from(purchaseLedger)
    .where(ilike(purchaseLedger.documentType, "%chưa thanh toán%"))
    .groupBy(purchaseLedger.partnerName)
    .orderBy(desc(sql`sum(${purchaseLedger.totalAmount})`));
}

// Nhà cung cấp mới xuất hiện trong `newDays` gần đây (lần mua đầu tiên nằm trong khoảng đó),
// và nhà cung cấp cũ đã lâu (> `staleDays`) không có giao dịch nào mới — cả hai đáng để quản
// lý xưởng để ý: NCC mới cần xác minh/đàm phán giá, NCC ngừng giao dịch có thể là dấu hiệu họ
// đóng cửa hoặc gara đã âm thầm chuyển nguồn hàng mà không ai ghi nhận chính thức.
export async function listSupplierActivity(options: { newDays: number; staleDays: number }) {
  const rows = await db
    .select({
      partnerName: purchaseLedger.partnerName,
      firstSeen: sql<string>`min(${purchaseLedger.postingDate})`,
      lastSeen: sql<string>`max(${purchaseLedger.postingDate})`,
      totalSpent: sql<number>`sum(${purchaseLedger.totalAmount})`.mapWith(Number),
    })
    .from(purchaseLedger)
    .groupBy(purchaseLedger.partnerName);

  const now = Date.now();
  const newCutoff = now - options.newDays * 24 * 60 * 60 * 1000;
  const staleCutoff = now - options.staleDays * 24 * 60 * 60 * 1000;

  const newSuppliers = rows.filter((r) => new Date(r.firstSeen).getTime() >= newCutoff);
  const staleSuppliers = rows.filter(
    (r) => new Date(r.lastSeen).getTime() < staleCutoff && new Date(r.firstSeen).getTime() < staleCutoff,
  );

  return { newSuppliers, staleSuppliers };
}
