import { NextResponse } from "next/server";
import { handle, unauthorized } from "@/server/api";
import { requireUser, resolveUserFlow } from "@/server/session";
import {
  countUnreadFor,
  listNotificationsFor,
  markNotificationsSeen,
} from "@/server/store/notifications";

export const dynamic = "force-dynamic";

// GET: thông báo gần đây theo luồng của người đang đăng nhập + số chưa đọc.
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    if (!user) return unauthorized();

    const flow = await resolveUserFlow(user);
    const [items, unread] = await Promise.all([
      listNotificationsFor(flow),
      countUnreadFor(flow, user.notificationsSeenAt),
    ]);

    return NextResponse.json({
      unread,
      seenAt: user.notificationsSeenAt,
      items,
    });
  });
}

// POST: đánh dấu đã xem tới thời điểm hiện tại (khi người dùng mở chuông).
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    if (!user) return unauthorized();
    await markNotificationsSeen(user.id);
    return NextResponse.json({ ok: true });
  });
}
