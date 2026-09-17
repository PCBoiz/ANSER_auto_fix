import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/server/rateLimit";

const rule = { name: "test", limit: 3, windowMs: 60_000 };

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

describe("checkRateLimit — cửa sổ trượt theo người gọi", () => {
  it("cho qua đúng `limit` lần, lần thứ limit+1 bị 429 kèm Retry-After", () => {
    expect(checkRateLimit(rule, "u1")).toBeNull();
    expect(checkRateLimit(rule, "u1")).toBeNull();
    expect(checkRateLimit(rule, "u1")).toBeNull();
    const blocked = checkRateLimit(rule, "u1");
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("người khác không bị ảnh hưởng — đếm theo user.id, không theo IP chung của gara", () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit(rule, "u1");
    expect(checkRateLimit(rule, "u2")).toBeNull();
  });

  it("hai endpoint khác tên không ăn chung hạn mức", () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit(rule, "u1");
    expect(checkRateLimit({ ...rule, name: "khac" }, "u1")).toBeNull();
  });

  it("hết cửa sổ thì được gọi lại", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T00:00:00Z"));
    for (let i = 0; i < 3; i += 1) checkRateLimit(rule, "u1");
    expect(checkRateLimit(rule, "u1")?.status).toBe(429);
    vi.setSystemTime(new Date("2026-09-18T00:01:01Z"));
    expect(checkRateLimit(rule, "u1")).toBeNull();
  });
});
