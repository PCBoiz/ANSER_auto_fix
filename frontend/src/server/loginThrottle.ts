import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { loginAttempts } from "@/server/db/schema";

// Chống dò mật khẩu ở `/api/auth/login`.
//
// Vì sao đếm trong DB chứ không trong RAM: bộ đếm trong RAM chỉ đúng khi có đúng MỘT tiến
// trình Node sống mãi. Deploy thật thì hoặc nhiều instance (mỗi cái một bộ đếm riêng, chia
// 5 lần thử thành 5×N lần), hoặc serverless khởi động lại liên tục (đợi vài phút là bộ đếm
// về 0). Cả hai đều biến rate-limit thành thứ trông-thì-có. Một bảng nhỏ + 1 câu đếm đã
// được đánh index đổi lấy giới hạn đúng ở mọi kiểu deploy.
//
// Chặn theo HAI trục, vì chúng là hai kiểu tấn công khác nhau:
//   - theo EMAIL: nhắm một tài khoản, thử nhiều mật khẩu (dò mật khẩu của chủ gara).
//   - theo IP: nhắm nhiều tài khoản, mỗi cái vài mật khẩu phổ biến (password spraying) —
//     kiểu này lách được giới hạn theo email vì mỗi email chỉ sai 2-3 lần.
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

// Giữ 30 ngày để còn soi lại khi nghi có người dò mật khẩu; cũ hơn thì xoá, bảng này
// không phải sổ kiểm toán.
const RETENTION_DAYS = 30;

export type ThrottleVerdict = { blocked: false } | { blocked: true; retryAfterSeconds: number };

// Lấy IP thật của client. Sau proxy/CDN (Vercel, Cloudflare, nginx) thì `request` không
// còn biết IP gốc — nó nằm trong header do proxy gắn vào.
//
// CẢNH BÁO: các header này do client gửi lên nên GIẢ ĐƯỢC nếu app chạy trần không qua
// proxy. Vì vậy giới hạn theo IP chỉ là lớp phụ; lớp chính là giới hạn theo email, vốn
// không giả được. Đừng bao giờ dùng riêng IP làm hàng rào duy nhất.
export function clientIpOf(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? null;
}

function windowStart() {
  return new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
}

/**
 * Gọi TRƯỚC khi so mật khẩu. Trả về `blocked: true` thì route phải trả 429 ngay và
 * KHÔNG được chạm tới bcrypt — so hash là thao tác cố tình chậm (~100ms), để kẻ tấn
 * công ép server chạy nó hàng nghìn lần cũng chính là một kiểu làm nghẽn dịch vụ.
 */
export async function checkLoginAllowed(
  email: string,
  ip: string | null,
): Promise<ThrottleVerdict> {
  const since = windowStart();
  const normalizedEmail = email.toLowerCase();

  const [byEmail] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, normalizedEmail),
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, since),
      ),
    );

  if ((byEmail?.n ?? 0) >= MAX_FAILURES_PER_EMAIL) {
    return { blocked: true, retryAfterSeconds: WINDOW_MINUTES * 60 };
  }

  if (ip) {
    const [byIp] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.success, false),
          gte(loginAttempts.attemptedAt, since),
        ),
      );
    if ((byIp?.n ?? 0) >= MAX_FAILURES_PER_IP) {
      return { blocked: true, retryAfterSeconds: WINDOW_MINUTES * 60 };
    }
  }

  return { blocked: false };
}

/**
 * Ghi lại kết quả một lần thử. Đăng nhập THÀNH CÔNG sẽ xoá sạch các lần sai trước đó của
 * email này — người gõ nhầm mật khẩu 4 lần rồi nhớ ra không được phép bị khoá ở lần sai
 * thứ 5 vào tuần sau.
 */
export async function recordLoginAttempt(email: string, ip: string | null, success: boolean) {
  const normalizedEmail = email.toLowerCase();

  if (success) {
    await db.delete(loginAttempts).where(eq(loginAttempts.email, normalizedEmail));
    return;
  }

  await db.insert(loginAttempts).values({ email: normalizedEmail, ip, success: false });

  // Dọn rác ngẫu nhiên ~2% số lần gọi, thay vì dựng một cron riêng chỉ để xoá một bảng
  // nhỏ. Bảng này chỉ lớn lên khi có người gõ sai mật khẩu, nên tốc độ phình rất chậm.
  if (Math.random() < 0.02) {
    await db
      .delete(loginAttempts)
      .where(
        sql`${loginAttempts.attemptedAt} < now() - (${RETENTION_DAYS} || ' days')::interval`,
      );
  }
}
