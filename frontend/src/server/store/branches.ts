import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appointments, branches, employees, parts, serviceOrders } from "@/server/db/schema";

export type Branch = typeof branches.$inferSelect;

export async function listBranches() {
  return db.select().from(branches).orderBy(asc(branches.name));
}

export async function getBranchById(id: string): Promise<Branch | undefined> {
  const rows = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  return rows[0];
}

export async function createBranch(input: {
  name: string;
  address?: string | null;
  phone?: string | null;
  specialty?: string | null;
  notificationEmail?: string | null;
}) {
  const [existing] = await db.select().from(branches).where(eq(branches.name, input.name)).limit(1);
  if (existing) throw new Error("Tên chi nhánh đã tồn tại.");
  const [branch] = await db.insert(branches).values(input).returning();
  return branch;
}

// Xoá chi nhánh CHỈ khi nó chưa dính gì tới nghiệp vụ. Chi nhánh đóng luôn vai trò kho
// phụ tùng và là nơi tiếp nhận xe, nên xoá một chi nhánh đã hoạt động là xoá theo cả kho
// lẫn lịch sử tiếp nhận của nó. Trả về danh sách vướng mắc thay vì chỉ true/false —
// người dùng cần biết vướng ở đâu để dọn.
export async function findBranchBlockers(id: string) {
  const [row] = await db
    .select({
      parts: sql<number>`(select count(*) from ${parts} where ${parts.branchId} = ${id})::int`,
      orders: sql<number>`(select count(*) from ${serviceOrders} where ${serviceOrders.branchId} = ${id})::int`,
      employees: sql<number>`(select count(*) from ${employees} where ${employees.branchId} = ${id})::int`,
      appointments: sql<number>`(select count(*) from ${appointments} where ${appointments.branchId} = ${id})::int`,
    })
    .from(sql`(select 1) as _`);

  const blockers: string[] = [];
  if (row.parts > 0) blockers.push(`${row.parts} phụ tùng trong kho`);
  if (row.orders > 0) blockers.push(`${row.orders} lệnh sửa chữa`);
  if (row.employees > 0) blockers.push(`${row.employees} hồ sơ nhân sự`);
  if (row.appointments > 0) blockers.push(`${row.appointments} lịch hẹn`);
  return blockers;
}

export async function deleteBranch(id: string) {
  await db.delete(branches).where(eq(branches.id, id));
}

export async function updateBranch(
  id: string,
  patch: Partial<{
    name: string;
    address: string | null;
    phone: string | null;
    specialty: string | null;
    notificationEmail: string | null;
  }>,
) {
  const [branch] = await db.update(branches).set(patch).where(eq(branches.id, id)).returning();
  return branch;
}
