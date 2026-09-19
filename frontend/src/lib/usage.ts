// Theo dõi MỨC SỬ DỤNG sau go-live — logic thuần, có test (`__tests__/usage.test.ts`).
//
// Câu hỏi chủ gara muốn được trả lời (20/09/2026): "app có THẬT SỰ được dùng không?". Phần
// mềm quản lý xưởng thất bại lặng lẽ theo một kiểu quen thuộc: tuần đầu nhập đủ, tuần thứ ba
// quay lại sổ tay, và không ai nói với chủ. Ở đây đo bằng dữ liệu thay vì hỏi.

import type { IncidentInput } from "@/lib/opsLoop";

const DAY = 24 * 60 * 60 * 1000;
const VN_OFFSET = 7 * 60 * 60 * 1000;

/** Ngày theo giờ Việt Nam, dạng số ngày kể từ epoch — để đếm ngày không lệch múi giờ. */
function vnDayIndex(date: Date): number {
  return Math.floor((date.getTime() + VN_OFFSET) / DAY);
}

/**
 * Số ngày làm việc ĐÃ TRỌN VẸN trôi qua kể từ ngày của `from` (không tính chính ngày đó, không
 * tính hôm nay vì hôm nay chưa hết), bỏ Chủ nhật.
 *
 * Lệnh cuối lập thứ Sáu: thứ Bảy (1), Chủ nhật bỏ, thứ Hai (2) — tới sáng thứ Ba mới đủ 2 ngày.
 * Đếm cả hôm nay thì 0h30 thứ Hai đã báo "không có lệnh" trước khi xưởng kịp mở cửa.
 */
export function completedWorkingDaysSince(from: Date, now: Date): number {
  const start = vnDayIndex(from);
  const today = vnDayIndex(now);
  let count = 0;
  for (let d = start + 1; d < today; d += 1) {
    // 1/1/1970 là thứ Năm: (d + 4) % 7 === 0 là Chủ nhật.
    if ((d + 4) % 7 !== 0) count += 1;
  }
  return count;
}

export const DEFAULT_IDLE_WORKING_DAYS = 2;

/**
 * Xưởng ngừng lập lệnh. CHỈ báo sau khi đã từng có lệnh: trước go-live thì 0 lệnh là bình
 * thường (lúc viết, DB thật có đúng 0 lệnh), báo lúc đó là tiếng ồn.
 */
export function detectUsageIssues(
  input: { firstOrderAt: Date | null; lastOrderAt: Date | null },
  now: Date,
  idleWorkingDays = DEFAULT_IDLE_WORKING_DAYS,
): IncidentInput[] {
  if (!input.firstOrderAt || !input.lastOrderAt) return [];
  const idle = completedWorkingDaysSince(input.lastOrderAt, now);
  if (idle < idleWorkingDays) return [];
  return [
    {
      key: "usage:no-orders",
      severity: "normal",
      title: `${idle} ngày làm việc liền không có lệnh sửa chữa mới`,
      body: `Lệnh gần nhất lập ngày ${input.lastOrderAt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}. Xưởng nghỉ, hay mọi người đang ghi sổ tay thay vì nhập vào app? Thông báo tự đóng khi có lệnh mới.`,
      href: "/dashboard/orders",
    },
  ];
}

export type AccountActivity = { name: string; email: string; role: string; lastLoginAt: Date | null; createdAt: Date };

export const INACTIVE_ACCOUNT_DAYS = 14;

/** Trạng thái dùng của một tài khoản — cho bảng trong báo cáo tuần. */
export function accountStatus(a: AccountActivity, now: Date): { label: string; flagged: boolean } {
  if (!a.lastLoginAt) return { label: "Chưa từng đăng nhập", flagged: true };
  const days = Math.floor((now.getTime() - a.lastLoginAt.getTime()) / DAY);
  if (days >= INACTIVE_ACCOUNT_DAYS) return { label: `${days} ngày chưa đăng nhập`, flagged: true };
  if (days === 0) return { label: "Hôm nay", flagged: false };
  return { label: `${days} ngày trước`, flagged: false };
}

/** Cửa sổ "7 ngày qua" kết thúc ở 0h hôm nay (giờ VN), và 7 ngày liền trước để so sánh. */
export function weekWindows(now: Date): { current: { from: Date; to: Date }; previous: { from: Date; to: Date } } {
  const todayStart = new Date(vnDayIndex(now) * DAY - VN_OFFSET);
  const weekAgo = new Date(todayStart.getTime() - 7 * DAY);
  const twoWeeksAgo = new Date(todayStart.getTime() - 14 * DAY);
  return { current: { from: weekAgo, to: todayStart }, previous: { from: twoWeeksAgo, to: weekAgo } };
}

/** "12 (tuần trước 9, +3)" — con số một mình không nói được tuần này tốt hay xấu. */
export function withDelta(current: number, previous: number, format: (n: number) => string = String): string {
  const diff = current - previous;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  return `${format(current)} (tuần trước ${format(previous)}, ${sign}${format(Math.abs(diff))})`;
}
