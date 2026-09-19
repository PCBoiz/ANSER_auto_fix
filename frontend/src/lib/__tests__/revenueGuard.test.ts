import { describe, expect, it } from "vitest";
import {
  DISCOUNT_REVIEW,
  detectRevenueLeaks,
  lineWarning,
  needsDiscountApproval,
  type GuardLine,
  type GuardOrder,
} from "@/lib/revenueGuard";

const now = new Date("2026-09-20T10:00:00Z");
const part = (name: string, unitPrice: number, unitCost: number | null = null): GuardLine => ({
  kind: "part",
  name,
  unitPrice,
  unitCost,
  quantity: 1,
});
const order = (over: Partial<GuardOrder> = {}): GuardOrder => ({
  id: "o1",
  code: "RO-2026-0001",
  plate: "51A-123.45",
  status: "in_progress",
  subtotal: 2_000_000,
  discount: 0,
  discountApprovedAmount: null,
  deliveredAt: null,
  lines: [],
  ...over,
});
const keys = (o: GuardOrder) => detectRevenueLeaks([o], now).map((i) => i.key);

describe("dòng 0đ và dưới giá vốn", () => {
  it("lệnh sạch -> không sự cố nào", () => {
    expect(keys(order({ lines: [part("Lọc dầu", 120_000, 80_000)] }))).toEqual([]);
  });

  it("dòng 0đ (phụ tùng HOẶC công) -> một sự cố mức cao cho cả lệnh, liệt kê tên", () => {
    const leaks = detectRevenueLeaks(
      [order({ lines: [part("Kính chắn gió", 0), { ...part("Công thay kính", 0), kind: "labor" }] })],
      now,
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({ key: "revenue:order:o1:zero", severity: "high" });
    expect(leaks[0].title).toContain("2 dòng 0đ");
    expect(leaks[0].body).toContain("Kính chắn gió; Công thay kính");
  });

  it("bán dưới giá vốn -> mức thường; giá vốn chưa biết (null) thì KHÔNG coi là lỗ", () => {
    expect(keys(order({ lines: [part("Má phanh", 300_000, 350_000)] }))).toEqual(["revenue:order:o1:below-cost"]);
    expect(keys(order({ lines: [part("Má phanh", 300_000, null)] }))).toEqual([]);
  });

  it("lệnh đã huỷ -> bỏ qua", () => {
    expect(keys(order({ status: "cancelled", lines: [part("X", 0)] }))).toEqual([]);
  });
});

describe("giảm giá lớn cần quản lý duyệt", () => {
  const base = { subtotal: 10_000_000, discountApprovedAmount: null };

  it("phải VỪA đủ tỷ lệ VỪA đủ số tiền", () => {
    // 20% nhưng chỉ 80.000đ: không đáng làm phiền.
    expect(needsDiscountApproval({ subtotal: 400_000, discount: 80_000, discountApprovedAmount: null })).toBe(false);
    // 4% của 30 triệu = 1,2 triệu nhưng dưới 10%: không.
    expect(needsDiscountApproval({ subtotal: 30_000_000, discount: 1_200_000, discountApprovedAmount: null })).toBe(false);
    // 12% của 10 triệu: có.
    expect(needsDiscountApproval({ ...base, discount: 1_200_000 })).toBe(true);
  });

  it("đã duyệt đúng số tiền -> hết; sửa số tiền sau khi duyệt -> phải duyệt lại", () => {
    expect(needsDiscountApproval({ ...base, discount: 1_200_000, discountApprovedAmount: 1_200_000 })).toBe(false);
    expect(needsDiscountApproval({ ...base, discount: 2_000_000, discountApprovedAmount: 1_200_000 })).toBe(true);
  });

  it("sự cố có khoá riêng và nói rõ ngưỡng", () => {
    const leaks = detectRevenueLeaks([order({ ...base, discount: 1_500_000 })], now);
    expect(leaks.map((l) => l.key)).toEqual(["revenue:order:o1:discount"]);
    expect(leaks[0].title).toContain("15%");
    expect(leaks[0].body).toContain(`${DISCOUNT_REVIEW.percent}%`);
  });
});

describe("đã giao xe mà chưa lập hoá đơn", () => {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  it("trong 24 giờ đầu -> chưa báo; quá 24 giờ -> mức cao", () => {
    expect(keys(order({ status: "delivered", deliveredAt: hoursAgo(23) }))).toEqual([]);
    const leaks = detectRevenueLeaks([order({ status: "delivered", deliveredAt: hoursAgo(50) })], now);
    expect(leaks[0]).toMatchObject({ key: "revenue:order:o1:not-invoiced", severity: "high" });
    expect(leaks[0].title).toContain("2 ngày");
  });

  it("chỉ lệnh đã giao — lệnh hoàn tất chưa giao thì chưa tới lúc lập hoá đơn", () => {
    expect(keys(order({ status: "completed", deliveredAt: null }))).toEqual([]);
  });
});

describe("cảnh báo tức thời khi thêm một dòng", () => {
  it("0đ và dưới giá vốn có cảnh báo; dòng bình thường thì không", () => {
    expect(lineWarning(part("Kính", 0))).toContain("0đ");
    expect(lineWarning(part("Má phanh", 300_000, 350_000))).toContain("thấp hơn giá vốn");
    expect(lineWarning(part("Lọc dầu", 120_000, 80_000))).toBeNull();
  });
});
