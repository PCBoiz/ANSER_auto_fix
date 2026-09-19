import { and, desc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import type { UserFlow } from "@/server/session";
import { INCIDENT_KINDS, planIncidents, type IncidentInput } from "@/lib/opsLoop";

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
  // Sự cố ĐANG MỞ lên đầu (việc cần làm), rồi mới tới thông báo mới nhất. Sự cố đã đóng
  // vẫn hiện (mờ, kèm "đã khắc phục") để người dùng thấy vòng lặp có khép thật.
  return db
    .select()
    .from(notifications)
    .where(
      and(
        inArray(notifications.audience, audiencesFor(flow)),
        // Bản có-ngày kiểu cũ bị thay bằng sự cố không-ngày: không phải việc đã làm xong, chỉ
        // là đổi cách ghi — hiện ra sẽ trông như vòng lặp vừa "khắc phục" 5 việc.
        sql`coalesce(${notifications.resolution}, '') <> 'superseded'`,
      ),
    )
    .orderBy(sql`(${notifications.resolvedAt} is null) desc`, desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnreadFor(flow: UserFlow, seenAt: Date | null) {
  // Sự cố đã đóng không tính là chưa đọc — không ai cần được gọi dậy vì một việc đã xong.
  const conditions = [inArray(notifications.audience, audiencesFor(flow)), isNull(notifications.resolvedAt)];
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

/**
 * Xoá thông báo cũ hơn N ngày — chuông chỉ cần việc gần đây, không phải nhật ký vĩnh viễn.
 *
 * KHÔNG BAO GIỜ xoá sự cố đang mở, dù đã mở bao lâu: xoá nó là vòng lặp "quên" một việc chưa
 * xong — lần đo sau sẽ mở lại nó như việc mới, mất luôn mốc "đã tồn đọng từ ngày nào".
 */
export async function pruneNotifications(olderThanDays = 30) {
  await db
    .delete(notifications)
    .where(
      and(
        sql`${notifications.createdAt} < now() - (${olderThanDays} || ' days')::interval`,
        sql`not (${notifications.resolvedAt} is null and ${notifications.kind} in ${[...INCIDENT_KINDS]})`,
      ),
    );
}

export type IncidentSyncResult = { opened: number; stillOpen: number; resolved: number };

/**
 * Đồng bộ MỘT loại sự cố với kết quả đo mới nhất — trái tim của vòng lặp khép kín.
 *
 * - Có trong lần đo, chưa có trong DB        -> mở mới.
 * - Có trong lần đo, đang mở                 -> cập nhật `lastSeenAt` (+ nội dung mới).
 * - Có trong lần đo, ĐÃ ĐÓNG trước đó        -> MỞ LẠI (tái phát), `createdAt` = bây giờ để
 *                                               hiện lại là chưa đọc.
 * - Đang mở, lần đo không còn thấy           -> ĐÓNG, ghi `resolution`.
 *
 * Việc đóng do CHÍNH lần đo quyết định, không do ai bấm nút "đã xong": xác nhận phải đến từ
 * dữ liệu. Chỉ động tới sự cố cùng `kind` — bộ canh gác không đóng nhầm việc của bộ kiểm tra.
 */
export async function syncIncidents(
  kind: string,
  audience: NotificationInput["audience"],
  current: IncidentInput[],
  resolution: "verified" | "auto" = "verified",
): Promise<IncidentSyncResult> {
  const openRows = await db
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(and(eq(notifications.kind, kind), isNull(notifications.resolvedAt)));
  const plan = planIncidents(openRows.map((r) => r.key), current);

  let opened = 0;
  for (const incident of plan.upsert) {
    const [row] = await db
      .insert(notifications)
      .values({
        kind,
        severity: incident.severity,
        audience,
        title: incident.title,
        body: incident.body,
        href: incident.href,
        dedupeKey: incident.key,
      })
      .onConflictDoUpdate({
        target: notifications.dedupeKey,
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          href: sql`excluded.href`,
          severity: sql`excluded.severity`,
          lastSeenAt: sql`now()`,
          // Tái phát: đưa lại lên đầu như thông báo mới.
          createdAt: sql`case when ${notifications.resolvedAt} is not null then now() else ${notifications.createdAt} end`,
          resolvedAt: sql`null`,
          resolution: sql`null`,
          // Tái phát là chuyện mới — email báo nhanh phải báo lại (automation/incidentAlerts).
          alertedAt: sql`case when ${notifications.resolvedAt} is not null then null else ${notifications.alertedAt} end`,
          resolveAlertedAt: sql`case when ${notifications.resolvedAt} is not null then null else ${notifications.resolveAlertedAt} end`,
        },
      })
      // `xmax = 0` chỉ đúng với dòng vừa INSERT (không phải UPDATE) — cách Postgres cho biết
      // dòng nào mới tạo mà không cần đọc trước.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (row?.inserted) opened += 1;
  }

  let resolved = 0;
  if (plan.resolveKeys.length > 0) {
    const rows = await db
      .update(notifications)
      .set({ resolvedAt: new Date(), resolution })
      .where(
        and(
          eq(notifications.kind, kind),
          isNull(notifications.resolvedAt),
          inArray(notifications.dedupeKey, plan.resolveKeys),
        ),
      )
      .returning({ id: notifications.id });
    resolved = rows.length;
  }

  return { opened, stillOpen: plan.upsert.length - opened, resolved };
}

/**
 * Ghi lại một việc máy ĐÃ TỰ SỬA — mở và đóng trong cùng một lần (`resolution = "auto"`).
 *
 * Tự sửa mà không để lại dấu vết thì người vận hành không bao giờ biết hệ thống đã phải can
 * thiệp, và không thấy được một lỗi cứ tái diễn (workflow bị ai đó xoá mỗi tuần). Bản ghi hiện
 * mờ trên chuông, không tính chưa đọc, và được đếm vào "tự khắc phục" ở trang Kiểm tra vận hành.
 */
export async function recordAutoFix(kind: string, audience: NotificationInput["audience"], fix: IncidentInput) {
  const now = new Date();
  await db
    .insert(notifications)
    .values({
      kind,
      severity: fix.severity,
      audience,
      title: fix.title,
      body: fix.body,
      href: fix.href,
      dedupeKey: fix.key,
      lastSeenAt: now,
      resolvedAt: now,
      resolution: "auto",
    })
    .onConflictDoUpdate({
      target: notifications.dedupeKey,
      set: {
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        createdAt: now,
        lastSeenAt: now,
        resolvedAt: now,
        resolution: "auto",
      },
    });
}

/** Đóng các thông báo cũ dạng có-ngày của một loại, khi loại đó chuyển sang khoá không-ngày. */
export async function supersedeDatedNotifications(kind: string, keepKeys: string[]) {
  await db
    .update(notifications)
    .set({ resolvedAt: new Date(), resolution: "superseded" })
    .where(
      and(
        eq(notifications.kind, kind),
        isNull(notifications.resolvedAt),
        sql`${notifications.dedupeKey} ~ ':[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
        keepKeys.length ? notInArray(notifications.dedupeKey, keepKeys) : sql`true`,
      ),
    );
}

export type LoopStats = {
  open: number;
  resolved7d: number;
  autoResolved7d: number;
  medianHoursToResolve: number | null;
};

/** Số liệu của vòng lặp — cho bảng điều khiển: bao nhiêu việc tự khép, mất bao lâu. */
export async function getLoopStats(): Promise<LoopStats> {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${notifications.resolvedAt} is null and ${notifications.kind} in ${[...INCIDENT_KINDS]})::int`,
      resolved7d: sql<number>`count(*) filter (where ${notifications.resolvedAt} > now() - interval '7 days' and ${notifications.resolution} in ('verified','auto'))::int`,
      autoResolved7d: sql<number>`count(*) filter (where ${notifications.resolvedAt} > now() - interval '7 days' and ${notifications.resolution} = 'auto')::int`,
      // Chỉ tính việc đóng nhờ ĐO LẠI ("verified"). Việc tự sửa mở-và-đóng cùng lúc (0 giờ)
      // sẽ kéo trung vị về 0 và che mất việc cần người mất bao lâu mới xong.
      medianHours: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${notifications.resolvedAt} - ${notifications.createdAt})) / 3600) filter (where ${notifications.resolution} = 'verified')`,
    })
    .from(notifications);
  return {
    open: row?.open ?? 0,
    resolved7d: row?.resolved7d ?? 0,
    autoResolved7d: row?.autoResolved7d ?? 0,
    medianHoursToResolve: row?.medianHours === null || row?.medianHours === undefined ? null : Number(row.medianHours),
  };
}
