import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { services } from "@/server/db/schema";

export type Service = typeof services.$inferSelect;

export async function listServices(options?: { search?: string; activeOnly?: boolean }) {
  const conditions = [];
  const term = options?.search?.trim();
  if (term) {
    conditions.push(
      or(ilike(services.name, `%${term}%`), ilike(services.code, `%${term}%`))!,
    );
  }
  if (options?.activeOnly) conditions.push(eq(services.active, true));

  return db
    .select()
    .from(services)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(services.code));
}

export async function getServiceById(id: string): Promise<Service | undefined> {
  const rows = await db.select().from(services).where(eq(services.id, id)).limit(1);
  return rows[0];
}

export type ServiceInput = {
  code: string;
  name: string;
  category: string;
  standardMinutes: number;
  laborPrice: number;
  description?: string | null;
  active?: boolean;
};

export class DuplicateServiceCodeError extends Error {
  constructor(code: string) {
    super(`Mã dịch vụ ${code} đã tồn tại.`);
    this.name = "DuplicateServiceCodeError";
  }
}

async function assertCodeFree(code: string, exceptId?: string) {
  const rows = await db.select().from(services).where(eq(services.code, code)).limit(1);
  if (rows[0] && rows[0].id !== exceptId) throw new DuplicateServiceCodeError(code);
}

export async function createService(input: ServiceInput) {
  await assertCodeFree(input.code);
  const [service] = await db.insert(services).values(input).returning();
  return service;
}

export async function updateService(id: string, patch: Partial<ServiceInput>) {
  if (patch.code) await assertCodeFree(patch.code, id);
  const [service] = await db
    .update(services)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(services.id, id))
    .returning();
  return service;
}

// Hạng mục đã dùng trong lệnh sửa chữa vẫn xoá được: `service_order_labors.serviceId` là
// `set null` và dòng công đã snapshot tên + giá. Bỏ một hạng mục khỏi bảng giá không được
// làm sai lệnh cũ, cũng không được buộc gara giữ mãi hạng mục không còn bán.
export async function deleteService(id: string) {
  await db.delete(services).where(eq(services.id, id));
}

export function formatMinutes(minutes: number | null | undefined) {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} phút`;
  if (m === 0) return `${h} giờ`;
  return `${h}g${String(m).padStart(2, "0")}`;
}

/** Chỉ cột `code` — cho gợi ý mã kế tiếp, không kéo cả bảng giá lần thứ hai. */
export async function listServiceCodes(): Promise<string[]> {
  const rows = await db.select({ code: services.code }).from(services);
  return rows.map((r) => r.code);
}
