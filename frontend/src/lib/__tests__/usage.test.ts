import { describe, expect, it } from "vitest";
import {
  accountStatus,
  completedWorkingDaysSince,
  detectUsageIssues,
  weekWindows,
  withDelta,
} from "@/lib/usage";

// Mốc theo giờ Việt Nam (UTC+7). 18/09/2026 là thứ Sáu, 20/09 Chủ nhật, 21/09 thứ Hai.
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("ngày làm việc đã trọn vẹn", () => {
  it("lệnh cuối thứ Sáu: sáng thứ Hai mới 1 ngày (thứ Bảy), sáng thứ Ba đủ 2 (bỏ Chủ nhật)", () => {
    const friday = vn("2026-09-18T16:00:00");
    expect(completedWorkingDaysSince(friday, vn("2026-09-21T08:00:00"))).toBe(1);
    expect(completedWorkingDaysSince(friday, vn("2026-09-22T00:30:00"))).toBe(2);
  });

  it("không tính chính hôm nay (chưa hết ngày), kể cả lúc 23h59", () => {
    expect(completedWorkingDaysSince(vn("2026-09-21T09:00:00"), vn("2026-09-21T23:59:00"))).toBe(0);
  });

  it("đúng theo ngày VIỆT NAM, không theo UTC: 06h sáng VN là ngày hôm đó, dù UTC còn hôm trước", () => {
    // 22/09 06:00 VN = 21/09 23:00 UTC.
    expect(completedWorkingDaysSince(vn("2026-09-18T10:00:00"), vn("2026-09-22T06:00:00"))).toBe(2);
  });
});

describe("xưởng ngừng lập lệnh", () => {
  const now = vn("2026-09-22T09:00:00"); // thứ Ba

  it("chưa từng có lệnh (trước go-live) -> KHÔNG báo", () => {
    expect(detectUsageIssues({ firstOrderAt: null, lastOrderAt: null }, now)).toEqual([]);
  });

  it("dưới ngưỡng -> im; đủ ngưỡng -> báo, tự đóng khi có lệnh mới", () => {
    expect(detectUsageIssues({ firstOrderAt: vn("2026-09-01T08:00:00"), lastOrderAt: vn("2026-09-21T08:00:00") }, now)).toEqual([]);
    const hit = detectUsageIssues({ firstOrderAt: vn("2026-09-01T08:00:00"), lastOrderAt: vn("2026-09-18T08:00:00") }, now);
    expect(hit.map((i) => i.key)).toEqual(["usage:no-orders"]);
    expect(hit[0].title).toContain("2 ngày làm việc");
  });

  it("ngưỡng chỉnh được (quy tắc Báo cáo tuần → Ngưỡng)", () => {
    const input = { firstOrderAt: vn("2026-09-01T08:00:00"), lastOrderAt: vn("2026-09-18T08:00:00") };
    expect(detectUsageIssues(input, now, 3)).toEqual([]);
  });
});

describe("tài khoản", () => {
  const now = vn("2026-09-22T09:00:00");
  const acc = (lastLoginAt: Date | null) => ({ name: "A", email: "a@x", role: "staff", lastLoginAt, createdAt: vn("2026-09-01T08:00:00") });

  it("chưa từng đăng nhập / bỏ dùng 14 ngày -> đánh dấu; dùng gần đây -> không", () => {
    expect(accountStatus(acc(null), now)).toEqual({ label: "Chưa từng đăng nhập", flagged: true });
    expect(accountStatus(acc(vn("2026-09-07T09:00:00")), now).flagged).toBe(true);
    expect(accountStatus(acc(vn("2026-09-20T09:00:00")), now)).toEqual({ label: "2 ngày trước", flagged: false });
  });
});

describe("cửa sổ tuần", () => {
  it("7 ngày kết thúc ở 0h hôm nay giờ VN, và 7 ngày liền trước", () => {
    const w = weekWindows(vn("2026-09-21T08:00:00"));
    expect(w.current.from.toISOString()).toBe(vn("2026-09-14T00:00:00").toISOString());
    expect(w.current.to.toISOString()).toBe(vn("2026-09-21T00:00:00").toISOString());
    expect(w.previous.from.toISOString()).toBe(vn("2026-09-07T00:00:00").toISOString());
  });

  it("so sánh với tuần trước có dấu", () => {
    expect(withDelta(12, 9)).toBe("12 (tuần trước 9, +3)");
    expect(withDelta(0, 4)).toBe("0 (tuần trước 4, −4)");
  });
});
