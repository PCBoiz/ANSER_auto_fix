import { describe, expect, it } from "vitest";
import { buildAlertEmail } from "@/lib/incidentAlerts";
import { heartbeatPingUrl } from "@/lib/opsLoop";

const t0 = new Date("2026-09-20T01:00:00Z");
const item = (title: string, extra: Partial<{ body: string; href: string; resolvedAt: Date; resolution: string }> = {}) => ({
  title,
  body: extra.body ?? null,
  href: extra.href ?? null,
  createdAt: t0,
  resolvedAt: extra.resolvedAt ?? null,
  resolution: extra.resolution ?? null,
});

describe("email báo nhanh", () => {
  it("gom sự cố mới + đã khắc phục vào MỘT email, tiêu đề nói đủ cả hai", () => {
    const email = buildAlertEmail({
      companyName: "Gara A",
      appUrl: null,
      opened: [item("RO-1: 2 dòng 0đ"), item("Sao lưu lỗi")],
      resolved: [item("n8n không trả lời", { resolvedAt: new Date(t0.getTime() + 90 * 60_000), resolution: "verified" })],
    });
    expect(email.subject).toBe("🔴 Gara A: 2 sự cố mới, 1 đã khắc phục");
    expect(email.html).toContain("RO-1: 2 dòng 0đ");
    expect(email.html).toContain("đã khắc phục sau 2 giờ");
  });

  it("chỉ có việc đã xong -> tiêu đề xanh; hệ thống tự sửa thì nói rõ", () => {
    const email = buildAlertEmail({
      companyName: "Gara A",
      appUrl: null,
      opened: [],
      resolved: [item("Workflow thiếu", { resolvedAt: t0, resolution: "auto" })],
    });
    expect(email.subject.startsWith("🟢")).toBe(true);
    expect(email.html).toContain("hệ thống tự khắc phục");
  });

  it("có APP_PUBLIC_URL -> link thẳng tới trang xử lý; nội dung được escape", () => {
    const email = buildAlertEmail({
      companyName: "Gara <A>",
      appUrl: "http://192.168.1.10:3000/",
      opened: [item("x", { href: "/dashboard/orders/1", body: "<script>" })],
      resolved: [],
    });
    expect(email.html).toContain('href="http://192.168.1.10:3000/dashboard/orders/1"');
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Gara &lt;A&gt;");
  });
});

describe("nhịp ra canh gác bên ngoài", () => {
  it("khoẻ -> URL gốc; hỏng hoặc chết DB -> /fail; bỏ dấu / thừa", () => {
    expect(heartbeatPingUrl("https://hc-ping.com/abc/", "ok")).toBe("https://hc-ping.com/abc");
    expect(heartbeatPingUrl("https://hc-ping.com/abc", "degraded")).toBe("https://hc-ping.com/abc/fail");
    expect(heartbeatPingUrl(" https://hc-ping.com/abc ", "down")).toBe("https://hc-ping.com/abc/fail");
  });
});
