import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { branches, parts, partTransactions, serviceOrders } from "@/server/db/schema";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/server/domain";

export type Part = typeof parts.$inferSelect;

export type PartListItem = Part & { branchName: string };

export type ListPartsOptions = {
  search?: string;
  branchId?: string;
  category?: string;
  /** Chỉ lấy phụ tùng đang để giá bán = 0 — 781 mã nhập từ Excel đều rơi vào nhóm này. */
  missingPrice?: boolean;
  /** Chỉ lấy phụ tùng chưa đặt ngưỡng tồn riêng (`minStock` null). */
  missingThreshold?: boolean;
  limit?: number;
  offset?: number;
};

function partConditions(options?: ListPartsOptions) {
  const conditions = [];
  const term = options?.search?.trim();
  if (term) {
    conditions.push(
      or(
        ilike(parts.name, `%${term}%`),
        ilike(parts.code, `%${term}%`),
        ilike(parts.oemNumber, `%${term}%`),
      )!,
    );
  }
  if (options?.branchId) conditions.push(eq(parts.branchId, options.branchId));
  if (options?.category) conditions.push(eq(parts.category, options.category));
  if (options?.missingPrice) conditions.push(eq(parts.price, 0));
  if (options?.missingThreshold) conditions.push(sql`${parts.minStock} is null`);
  return conditions;
}

/** Đếm tổng số dòng KHỚP BỘ LỌC (không phân trang) — để UI biết còn bao nhiêu trang. */
export async function countParts(options?: ListPartsOptions) {
  const conditions = partConditions(options);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(parts)
    .where(conditions.length ? and(...conditions) : undefined);
  return row?.n ?? 0;
}

/**
 * Mã phụ tùng kế tiếp theo quy ước "PT-###".
 *
 * Trước đây route `/api/parts` gọi `listParts()` lần thứ hai KHÔNG lọc, chỉ để lấy danh
 * sách mã rồi suy ra số kế tiếp — tức là kéo cả 788 dòng (đầy đủ mọi cột, kèm join
 * branches) qua mạng lần thứ hai ở mỗi lần mở trang Kho. Ở đây chỉ đọc đúng cột `code`.
 */
export async function listPartCodes(): Promise<string[]> {
  const rows = await db.select({ code: parts.code }).from(parts);
  return rows.map((r) => r.code);
}

export async function listParts(options?: ListPartsOptions): Promise<PartListItem[]> {
  const conditions = partConditions(options);

  const query = db
    .select({
      id: parts.id,
      code: parts.code,
      name: parts.name,
      category: parts.category,
      oemNumber: parts.oemNumber,
      unit: parts.unit,
      stock: parts.stock,
      price: parts.price,
      cost: parts.cost,
      minStock: parts.minStock,
      location: parts.location,
      branchId: parts.branchId,
      createdAt: parts.createdAt,
      updatedAt: parts.updatedAt,
      branchName: branches.name,
    })
    .from(parts)
    .innerJoin(branches, eq(parts.branchId, branches.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(parts.code))
    .$dynamic();

  // Không phân trang khi không yêu cầu: nhiều nơi trong app (báo cáo, gợi ý chọn phụ
  // tùng) vẫn cần cả danh sách, và đổi hành vi mặc định sẽ làm chúng thiếu dữ liệu một
  // cách âm thầm.
  if (options?.limit !== undefined) query.limit(options.limit);
  if (options?.offset !== undefined) query.offset(options.offset);

  return query;
}

export type BulkPartPatch = { id: string; price?: number; minStock?: number | null };

/**
 * Cập nhật giá bán / ngưỡng tồn cho NHIỀU phụ tùng trong một transaction.
 *
 * 781 mã phải điền giá bằng tay là công việc nhiều buổi, làm dở là chuyện đương nhiên.
 * Gộp mỗi lần lưu vào một transaction để một trang đã bấm "Lưu" thì hoặc vào hết, hoặc
 * không vào gì — chứ không phải 40/60 dòng rồi không biết dòng nào đã xong.
 *
 * KHÔNG đụng tới `stock`: tồn kho chỉ được đổi qua phiếu nhập/xuất, để mọi biến động đều
 * có dòng lịch sử đối chiếu (xem `createPart`).
 */
export async function bulkUpdateParts(patches: BulkPartPatch[]) {
  if (patches.length === 0) return 0;

  return db.transaction(async (tx) => {
    let updated = 0;
    for (const patch of patches) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.price !== undefined) set.price = patch.price;
      // `minStock` phân biệt rõ: `null` = dùng ngưỡng chung, `0` = cố ý không cảnh báo
      // (vật tư đặt theo xe, tồn 0 là bình thường). Hai giá trị này khác nhau về nghĩa.
      if (patch.minStock !== undefined) set.minStock = patch.minStock;
      if (Object.keys(set).length === 1) continue;

      const rows = await tx.update(parts).set(set).where(eq(parts.id, patch.id)).returning({ id: parts.id });
      updated += rows.length;
    }
    return updated;
  });
}

export async function getPartById(id: string): Promise<Part | undefined> {
  const rows = await db.select().from(parts).where(eq(parts.id, id)).limit(1);
  return rows[0];
}

export type PartInput = {
  code: string;
  name: string;
  category: string;
  branchId: string;
  oemNumber?: string | null;
  unit?: string;
  price?: number;
  cost?: number | null;
  minStock?: number | null;
  location?: string | null;
};

export class DuplicatePartCodeError extends Error {
  constructor(code: string) {
    super(`Mã phụ tùng ${code} đã tồn tại trong chi nhánh này.`);
    this.name = "DuplicatePartCodeError";
  }
}

// Unique là (branchId, code) chứ không phải code toàn cục — xem chú thích trong schema.
async function assertCodeFree(branchId: string, code: string, exceptId?: string) {
  const rows = await db
    .select()
    .from(parts)
    .where(and(eq(parts.branchId, branchId), eq(parts.code, code)))
    .limit(1);
  if (rows[0] && rows[0].id !== exceptId) throw new DuplicatePartCodeError(code);
}

export async function createPart(input: PartInput) {
  await assertCodeFree(input.branchId, input.code);
  // `stock` cố tình KHÔNG nhận từ form: tồn kho chỉ được thay đổi qua phiếu nhập/xuất, để
  // mọi biến động đều có dòng lịch sử đối chiếu. Phụ tùng mới bắt đầu từ 0, nhập kho sau.
  const [part] = await db.insert(parts).values({ ...input, stock: 0 }).returning();
  return part;
}

export async function updatePart(id: string, patch: Partial<PartInput>) {
  if (patch.code) {
    const current = await getPartById(id);
    if (!current) return undefined;
    await assertCodeFree(patch.branchId ?? current.branchId, patch.code, id);
  }
  const [part] = await db
    .update(parts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(parts.id, id))
    .returning();
  return part;
}

export async function deletePart(id: string) {
  await db.delete(parts).where(eq(parts.id, id));
}

// --- Nhập / xuất kho ---

export class InsufficientStockError extends Error {
  constructor(name: string, available: number, requested: number) {
    super(`"${name}" chỉ còn ${available} trong kho, không xuất được ${requested}.`);
    this.name = "InsufficientStockError";
  }
}

export type TransactionInput = {
  partId: string;
  type: "import" | "export";
  quantity: number;
  unitCost?: number | null;
  counterparty?: string | null;
  serviceOrderId?: string | null;
  note?: string | null;
};

// Ghi phiếu và cập nhật tồn kho trong CÙNG một transaction. Tách ra hai lệnh riêng là mở
// cửa cho trạng thái nửa vời: đã trừ kho nhưng không có phiếu (không ai truy được), hoặc
// có phiếu mà kho không đổi (kiểm kê lệch mà không rõ vì sao).
export async function createPartTransaction(input: TransactionInput) {
  return db.transaction(async (tx) => {
    const [part] = await tx
      .select()
      .from(parts)
      .where(eq(parts.id, input.partId))
      .limit(1)
      // Khoá dòng tới hết transaction: hai phiếu xuất đồng thời cùng đọc tồn = 5 rồi cùng
      // trừ 3 sẽ ra 2 thay vì âm 1 nếu không khoá.
      .for("update");

    if (!part) throw new Error("Không tìm thấy phụ tùng.");

    const delta = input.type === "import" ? input.quantity : -input.quantity;
    const nextStock = part.stock + delta;
    if (nextStock < 0) {
      throw new InsufficientStockError(part.name, part.stock, input.quantity);
    }

    const [transaction] = await tx
      .insert(partTransactions)
      .values({
        partId: input.partId,
        type: input.type,
        quantity: input.quantity,
        unitCost: input.unitCost ?? null,
        counterparty: input.counterparty ?? null,
        serviceOrderId: input.serviceOrderId ?? null,
        note: input.note ?? null,
      })
      .returning();

    // Giá vốn hiện hành chỉ cập nhật khi NHẬP có ghi giá: lấy giá của lô mới nhất. Bình
    // quân gia quyền chuẩn xác hơn nhưng cần cả lịch sử tồn theo lô — ngoài phạm vi hiện
    // tại, và lô mới nhất vẫn sát thực tế hơn nhiều so với giữ nguyên giá cũ.
    const patch: Record<string, unknown> = { stock: nextStock, updatedAt: new Date() };
    if (input.type === "import" && input.unitCost) patch.cost = input.unitCost;

    await tx.update(parts).set(patch).where(eq(parts.id, input.partId));

    return transaction;
  });
}

export async function listPartTransactions(options?: { partId?: string; limit?: number }) {
  const conditions = [];
  if (options?.partId) conditions.push(eq(partTransactions.partId, options.partId));

  return db
    .select({
      id: partTransactions.id,
      type: partTransactions.type,
      quantity: partTransactions.quantity,
      unitCost: partTransactions.unitCost,
      counterparty: partTransactions.counterparty,
      note: partTransactions.note,
      createdAt: partTransactions.createdAt,
      partCode: parts.code,
      partName: parts.name,
      unit: parts.unit,
      orderCode: serviceOrders.code,
    })
    .from(partTransactions)
    .innerJoin(parts, eq(partTransactions.partId, parts.id))
    .leftJoin(serviceOrders, eq(partTransactions.serviceOrderId, serviceOrders.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(partTransactions.createdAt))
    .limit(options?.limit ?? 100);
}

// --- Cảnh báo tồn thấp (dùng bởi trang Tổng quan và endpoint n8n) ---

export type LowStockPart = {
  id: string;
  code: string;
  name: string;
  category: string;
  oemNumber: string | null;
  unit: string;
  stock: number;
  threshold: number;
  location: string | null;
};

/**
 * Điều kiện "phụ tùng này đang dưới ngưỡng" — MỘT chỗ duy nhất, dùng chung cho cảnh báo
 * tồn kho, trang Tổng quan và bộ kiểm tra sẵn sàng vận hành.
 *
 * Ngữ nghĩa của `minStock`:
 *   - `null` -> dùng ngưỡng chung của quy tắc tự động (`fallback`)
 *   - `0`    -> CỐ Ý không cảnh báo (vật tư đặt theo từng xe, tồn 0 là bình thường)
 *   - `n > 0`-> cảnh báo khi tồn <= n
 *
 * Bẫy đã sửa (17/09/2026): điều kiện cũ là `stock <= coalesce(minStock, fallback)`. Với
 * `minStock = 0` và tồn 0, `0 <= 0` là đúng — tức là đặt ngưỡng 0 để TẮT cảnh báo lại
 * vẫn cảnh báo. Kho đồng-sơn có 587 mã tồn 0, nên cách duy nhất để dập 724 dòng cảnh báo
 * mỗi 6 giờ đã không hoạt động.
 */
export function belowThresholdSql(fallback: number) {
  return sql`(
    (${parts.minStock} is null and ${parts.stock} <= ${fallback})
    or (${parts.minStock} > 0 and ${parts.stock} <= ${parts.minStock})
  )`;
}

export async function listLowStockParts(options?: {
  branchId?: string;
  fallbackThreshold?: number;
  /** Chỉ lấy N dòng tồn thấp nhất — email cảnh báo không cần liệt kê cả kho. */
  limit?: number;
}): Promise<LowStockPart[]> {
  const fallback = options?.fallbackThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  const conditions = [belowThresholdSql(fallback)];
  if (options?.branchId) conditions.push(eq(parts.branchId, options.branchId));

  const rows = await db
    .select({
      id: parts.id,
      code: parts.code,
      name: parts.name,
      category: parts.category,
      oemNumber: parts.oemNumber,
      unit: parts.unit,
      stock: parts.stock,
      minStock: parts.minStock,
      location: parts.location,
    })
    .from(parts)
    .where(and(...conditions))
    .orderBy(asc(parts.stock), asc(parts.code))
    .limit(options?.limit ?? 100_000);

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    oemNumber: row.oemNumber,
    unit: row.unit,
    stock: row.stock,
    threshold: row.minStock ?? fallback,
    location: row.location,
  }));
}

/** Đếm số phụ tùng dưới ngưỡng mà không kéo dữ liệu về — cho số tổng trong email/thông báo. */
export async function countLowStockParts(options?: { branchId?: string; fallbackThreshold?: number }) {
  const fallback = options?.fallbackThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const conditions = [belowThresholdSql(fallback)];
  if (options?.branchId) conditions.push(eq(parts.branchId, options.branchId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(parts)
    .where(and(...conditions));
  return row?.n ?? 0;
}
