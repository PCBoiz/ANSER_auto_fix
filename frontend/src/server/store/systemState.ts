import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { systemState } from "@/server/db/schema";

// Trạng thái vận hành dạng khoá–giá trị: nhịp của bộ canh gác, khe lịch nào đã chạy. Mấy thứ
// nhỏ như vậy không đáng một bảng riêng mỗi thứ, nhưng PHẢI nằm trong DB chứ không trong RAM:
// RAM mất khi khởi động lại, và hai tiến trình không nhìn thấy RAM của nhau.

export async function getSystemState<T>(key: string): Promise<{ value: T; updatedAt: Date } | null> {
  const [row] = await db.select().from(systemState).where(eq(systemState.key, key)).limit(1);
  return row ? { value: row.value as T, updatedAt: row.updatedAt } : null;
}

export async function setSystemState(key: string, value: unknown) {
  await db
    .insert(systemState)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Giành quyền chạy khe `slot` của việc `key` — trả `true` cho ĐÚNG MỘT bên gọi mỗi khe.
 *
 * Một câu lệnh duy nhất (upsert có điều kiện), không "đọc rồi ghi": hai tiến trình cùng tỉnh
 * dậy lúc 7h00 thì cả hai đọc thấy "chưa chạy" và cùng gửi bản tin. Ở đây bên thua nhận về 0
 * dòng vì điều kiện `slot khác` đã sai với dòng bên thắng vừa ghi.
 */
export async function claimSlot(key: string, slot: string): Promise<boolean> {
  const rows = await db
    .insert(systemState)
    .values({ key, value: { slot } })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: { slot }, updatedAt: new Date() },
      setWhere: sql`${systemState.value}->>'slot' is distinct from ${slot}`,
    })
    .returning({ key: systemState.key });
  return rows.length > 0;
}
