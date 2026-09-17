import { apiError } from "@/server/api";

// Giới hạn tần suất cho endpoint NẶNG mà người đã đăng nhập gọi được (import Excel, nhập giá
// hàng loạt, chạy tay quy tắc tự động).
//
// Khác `loginThrottle.ts` (đếm trong DB): ở đây đếm trong RAM là đủ, vì mục tiêu không phải
// chặn kẻ dò mật khẩu từ ngoài — họ chưa qua được `requireUser()`. Mục tiêu là một tài khoản
// thật (hoặc một script lỗi bấm lặp) không ép server parse 5 MB Excel 50 lần một phút. Trên
// deploy nhiều instance mỗi instance có bộ đếm riêng, nghĩa là giới hạn thực tế lỏng hơn N
// lần — chấp nhận được cho mục tiêu này, và không đáng một round-trip DB mỗi request.
//
// Bộ đếm theo cửa sổ trượt đơn giản: mảng mốc thời gian, cắt bỏ mốc quá hạn mỗi lần gọi.

type Bucket = number[];
const buckets = new Map<string, Bucket>();

// Mỗi 5 phút dọn khoá không còn mốc nào trong cửa sổ, để map không lớn mãi theo số tài khoản
// từng gọi. Không dùng setInterval: trên serverless module có thể bị nạp lại bất kỳ lúc nào,
// dọn lười khi có request là đủ và không để lại timer treo.
let lastSweep = Date.now();
const SWEEP_EVERY_MS = 5 * 60 * 1000;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.every((t) => now - t > windowMs)) buckets.delete(key);
  }
}

export type RateLimitRule = {
  /** Tên nhóm — mỗi endpoint một tên, để giới hạn của import không ăn vào giới hạn của bulk. */
  name: string;
  /** Số lần tối đa trong cửa sổ. */
  limit: number;
  windowMs: number;
};

/**
 * Trả `null` nếu được phép, hoặc một `NextResponse` 429 để route trả về ngay.
 *
 * `subject` là định danh người gọi — dùng `user.id`, không dùng IP: cả gara ngồi sau một
 * router thì chung IP, một người spam sẽ khoá cả xưởng.
 */
export function checkRateLimit(rule: RateLimitRule, subject: string) {
  const now = Date.now();
  sweep(now, rule.windowMs);

  const key = `${rule.name}:${subject}`;
  const bucket = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);

  if (bucket.length >= rule.limit) {
    const retryAfterSec = Math.ceil((bucket[0] + rule.windowMs - now) / 1000);
    const response = apiError(
      `Thao tác này bị giới hạn ${rule.limit} lần mỗi ${Math.round(rule.windowMs / 60000)} phút. Thử lại sau ${retryAfterSec} giây.`,
      429,
    );
    response.headers.set("Retry-After", String(retryAfterSec));
    return response;
  }

  bucket.push(now);
  buckets.set(key, bucket);
  return null;
}

/** Xoá toàn bộ bộ đếm — chỉ dùng trong test. */
export function resetRateLimits() {
  buckets.clear();
  lastSweep = Date.now();
}

// Các mức đang dùng. Con số chọn theo việc thật: nhập kho là vài lần một buổi, không phải
// vài lần một phút.
export const RATE_LIMITS = {
  /** Import Excel: parse tới 5 MB ở server. */
  partsImport: { name: "parts-import", limit: 10, windowMs: 10 * 60 * 1000 },
  /** Nhập giá hàng loạt: tối đa 500 dòng/transaction. */
  partsBulk: { name: "parts-bulk", limit: 30, windowMs: 10 * 60 * 1000 },
  /** Chạy tay bản tin — mỗi lần là 8 truy vấn tổng hợp. */
  automationRun: { name: "automation-run", limit: 10, windowMs: 10 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;
