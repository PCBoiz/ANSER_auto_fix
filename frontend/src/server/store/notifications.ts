import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import type { UserFlow } from "@/server/session";

export type Notification = typeof notifications.$inferSelect;

export type NotificationInput = {
  kind: string;
  severity: "high" | "normal";
  audience: "manager" | "accountant" | "all";
  title: string;
  body?: string | null;
  href?: string | null;
  dedupeKey: string;
};

/**
 * Tạo thông báo, bỏ qua cái đã có cùng `dedupeKey`.
 *
 * `on conflict do nothing` chứ không phải "đọc trước rồi mới ghi": cron có thể bị gọi hai
 * lần gần như cùng lúc (Vercel Cron retry, hoặc người bấm "Chạy ngay" trùng giờ lịch). Đọc
 * rồi ghi thì cả hai cùng thấy "chưa có" và cùng chèn; ràng buộc unique ở DB mới chặn được.
 */
export async function createNotifications(inputs: NotificationInput[]) {
  if (inputs.length === 0) return 0;
  const rows = await db
    .insert(notifications)
    .values(inputs)
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });
  return rows.length;
}

// Luồng giao diện -> tập `audience` được thấy. KTV không nhận thông báo quản trị nào: họ không
// có quyền xử lý các việc này, và chuông đầy việc của người khác chỉ là tiếng ồn.
function audiencesFor(flow: UserFlow): Array<NotificationInput["audience"]> {
  if (flow === "manager") return ["manager", "accountant", "all"];
  if (flow === "accountant") return ["accountant", "all"];
  return ["all"];
}

export async function listNotificationsFor(flow: UserFlow, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(inArray(notifications.audience, audiencesFor(flow)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnreadFor(flow: UserFlow, seenAt: Date | null) {
  const conditions = [inArray(notifications.audience, audiencesFor(flow))];
  if (seenAt) conditions.push(gt(notifications.createdAt, seenAt));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(...conditions));
  return row?.n ?? 0;
}

export async function markNotificationsSeen(userId: string) {
  await db.update(users).set({ notificationsSeenAt: new Date() }).where(eq(users.id, userId));
}

/** Xoá thông báo cũ hơn N ngày — chuông chỉ cần việc gần đây, không phải nhật ký vĩnh viễn. */
export async function pruneNotifications(olderThanDays = 30) {
  await db
    .delete(notifications)
    .where(sql`${notifications.createdAt} < now() - (${olderThanDays} || ' days')::interval`);
}
