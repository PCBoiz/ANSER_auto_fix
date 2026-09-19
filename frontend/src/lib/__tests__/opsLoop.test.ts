import { describe, expect, it } from "vitest";
import {
  dueScheduledJobs,
  findSilentRules,
  formatDuration,
  n8nIncidents,
  n8nWatchdogSilence,
  overallHealth,
  type SyncSummary,
  planIncidents,
  watchdogCheck,
  type IncidentInput,
} from "@/lib/opsLoop";

const inc = (key: string): IncidentInput => ({ key, severity: "high", title: key, body: null, href: null });

describe("planIncidents — mở, giữ, đóng", () => {
  it("sự cố mới -> upsert; sự cố đang mở mà lần đo không còn -> đóng", () => {
    const plan = planIncidents(["readiness:a", "readiness:b"], [inc("readiness:b"), inc("readiness:c")]);
    expect(plan.upsert.map((i) => i.key)).toEqual(["readiness:b", "readiness:c"]);
    expect(plan.resolveKeys).toEqual(["readiness:a"]);
  });

  it("lần đo sạch -> đóng hết những gì đang mở (vòng lặp tự khép)", () => {
    expect(planIncidents(["x", "y"], []).resolveKeys).toEqual(["x", "y"]);
  });

  it("khoá trùng trong cùng một lần đo chỉ giữ bản đầu — tránh nổ unique giữa chừng", () => {
    const plan = planIncidents([], [{ ...inc("k"), title: "đầu" }, { ...inc("k"), title: "sau" }]);
    expect(plan.upsert).toHaveLength(1);
    expect(plan.upsert[0].title).toBe("đầu");
  });
});

describe("findSilentRules — canh lịch đã chết", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  it("lịch 6 giờ: im 7 giờ chưa báo, im 9 giờ thì báo", () => {
    const base = { type: "low_stock_alert", name: "Tồn kho", enabled: true };
    expect(findSilentRules([{ ...base, lastScheduledRunAt: hoursAgo(7) }], now)).toHaveLength(0);
    const hit = findSilentRules([{ ...base, lastScheduledRunAt: hoursAgo(9) }], now);
    expect(hit).toHaveLength(1);
    expect(hit[0].key).toBe("watchdog:rule:low_stock_alert");
    expect(hit[0].body).toContain("9 giờ");
  });

  it("lịch ngày: im 25 giờ chưa báo (trễ vài chục phút là bình thường), 27 giờ thì báo", () => {
    const base = { type: "morning_brief", name: "Bản tin", enabled: true };
    expect(findSilentRules([{ ...base, lastScheduledRunAt: hoursAgo(25) }], now)).toHaveLength(0);
    expect(findSilentRules([{ ...base, lastScheduledRunAt: hoursAgo(27) }], now)).toHaveLength(1);
  });

  it("lịch tuần: im 6 ngày là bình thường", () => {
    const r = { type: "accounting_digest", name: "Kế toán", enabled: true, lastScheduledRunAt: hoursAgo(6 * 24) };
    expect(findSilentRules([r], now)).toHaveLength(0);
  });

  it("CHƯA TỪNG chạy theo lịch -> không báo (đó là việc cài đặt, không phải hồi quy)", () => {
    expect(findSilentRules([{ type: "low_stock_alert", name: "x", enabled: true, lastScheduledRunAt: null }], now)).toHaveLength(0);
  });

  it("quy tắc đang tắt -> không canh", () => {
    expect(findSilentRules([{ type: "low_stock_alert", name: "x", enabled: false, lastScheduledRunAt: hoursAgo(100) }], now)).toHaveLength(0);
  });

  it("quy tắc theo sự kiện (không lịch) -> không canh bằng thời gian", () => {
    expect(findSilentRules([{ type: "order_status_update", name: "x", enabled: true, lastScheduledRunAt: hoursAgo(1000) }], now)).toHaveLength(0);
  });

  it("im nhiều ngày thì nói bằng ngày", () => {
    const hit = findSilentRules([{ type: "low_stock_alert", name: "x", enabled: true, lastScheduledRunAt: hoursAgo(72) }], now);
    expect(hit[0].body).toContain("3 ngày");
  });
});

describe("formatDuration", () => {
  it.each([
    [30_000, "1 phút"],
    [45 * 60_000, "45 phút"],
    [5 * 3600_000, "5 giờ"],
    [3 * 24 * 3600_000, "3 ngày"],
  ])("%i ms -> %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("dueScheduledJobs — lịch nội bộ, có bắt kịp", () => {
  // Giờ Việt Nam = UTC+7.
  const jobs = (iso: string) => dueScheduledJobs(new Date(iso));
  const find = (iso: string, job: string) => jobs(iso).find((j) => j.job === job);

  it("canh gác luôn đến hạn, khe đổi mỗi 30 phút", () => {
    expect(find("2026-09-18T03:00:00Z", "watchdog")?.slot).toBe(find("2026-09-18T03:29:59Z", "watchdog")?.slot);
    expect(find("2026-09-18T03:00:00Z", "watchdog")?.slot).not.toBe(find("2026-09-18T03:30:00Z", "watchdog")?.slot);
  });

  it("bản tin sáng: 6h59 VN chưa, 7h00 VN có, khe theo NGÀY VIỆT NAM", () => {
    expect(find("2026-09-17T23:59:00Z", "morning_brief")).toBeUndefined(); // 06:59 ngày 18
    expect(find("2026-09-18T00:00:00Z", "morning_brief")?.slot).toBe("2026-09-18"); // 07:00
    // 23h VN ngày 18 = 16h UTC ngày 18 — vẫn là khe ngày 18 (bắt kịp khi máy bật muộn).
    expect(find("2026-09-18T16:00:00Z", "morning_brief")?.slot).toBe("2026-09-18");
    // 01h VN ngày 19 = 18h UTC ngày 18: đã sang ngày mới nhưng chưa tới 7h -> chưa đến hạn.
    expect(find("2026-09-18T18:00:00Z", "morning_brief")).toBeUndefined();
  });

  it("sao lưu: từ 2h sáng VN, mỗi ngày một khe", () => {
    expect(find("2026-09-17T18:59:00Z", "backup")).toBeUndefined(); // 01:59 ngày 18
    expect(find("2026-09-17T19:00:00Z", "backup")?.slot).toBe("2026-09-18"); // 02:00 ngày 18
  });

  it("tổng hợp tuần: thứ Hai 7h59 VN chưa, 8h có; thứ Tư vẫn cùng khe thứ Hai", () => {
    // 21/09/2026 là thứ Hai.
    expect(find("2026-09-21T00:59:00Z", "accounting_digest")).toBeUndefined();
    expect(find("2026-09-21T01:00:00Z", "accounting_digest")?.slot).toBe("2026-09-21");
    expect(find("2026-09-21T01:00:00Z", "owner_weekly_report")?.slot).toBe("2026-09-21");
    expect(find("2026-09-23T10:00:00Z", "accounting_digest")?.slot).toBe("2026-09-21");
    // Chủ nhật 27/09 23h VN vẫn thuộc tuần của thứ Hai 21/09.
    expect(find("2026-09-27T16:00:00Z", "accounting_digest")?.slot).toBe("2026-09-21");
  });
});

describe("sức khoẻ — ok / degraded / down", () => {
  const now = new Date("2026-09-18T12:00:00Z");

  it("DB chết là down; vòng tự động hỏng là degraded; còn lại ok", () => {
    expect(overallHealth([{ name: "db", ok: false, detail: "", fatal: true }])).toBe("down");
    expect(overallHealth([{ name: "db", ok: true, detail: "" }, { name: "x", ok: false, detail: "" }])).toBe("degraded");
    expect(overallHealth([{ name: "db", ok: true, detail: "" }])).toBe("ok");
  });

  it("canh gác chưa chạy lần nào: KHÔNG tính là hỏng (việc cài đặt, không phải hồi quy)", () => {
    expect(watchdogCheck(null, now).ok).toBe(true);
  });

  it("canh gác im quá 26 giờ: hỏng", () => {
    expect(watchdogCheck(new Date(now.getTime() - 25 * 3600_000), now).ok).toBe(true);
    expect(watchdogCheck(new Date(now.getTime() - 27 * 3600_000), now).ok).toBe(false);
  });
});

describe("n8nIncidents — việc cần người vs việc đã tự sửa", () => {
  const item = (over: Partial<SyncSummary["items"][number]>): SyncSummary["items"][number] => ({
    file: "x.json",
    name: "ANSER Auto — X",
    action: "unchanged",
    toggled: null,
    needsActivation: false,
    credentialFixed: false,
    ...over,
  });
  const ok: SyncSummary = { reachable: true, smtpCredentialFound: true, alertEmailSet: true, items: [] };

  it("mọi thứ khớp -> không sự cố nào (các sự cố cũ sẽ tự đóng)", () => {
    expect(n8nIncidents({ ...ok, items: [item({})] })).toEqual({ incidents: [], autoFixes: [] });
  });

  it("n8n không trả lời -> CHỈ báo đúng việc đó, không đoán thêm", () => {
    const out = n8nIncidents({ ...ok, reachable: false, smtpCredentialFound: false, alertEmailSet: false });
    expect(out.incidents.map((i) => i.key)).toEqual(["watchdog:n8n:unreachable"]);
  });

  it("lệch mẫu và chờ bật -> sự cố cần người; tạo mới và tắt theo app -> đã tự sửa", () => {
    const out = n8nIncidents({
      ...ok,
      items: [
        item({ file: "a.json", action: "drift-skipped" }),
        item({ file: "b.json", needsActivation: true }),
        item({ file: "c.json", action: "created" }),
        item({ file: "d.json", toggled: "deactivated" }),
      ],
    });
    expect(out.incidents.map((i) => i.key)).toEqual(["watchdog:n8n:drift", "watchdog:n8n:inactive"]);
    expect(out.autoFixes.map((i) => i.key)).toEqual(["watchdog:autofix:created", "watchdog:autofix:deactivated"]);
  });

  it("tự sửa nhiều workflow cùng loại -> GỘP một dòng (lần đầu nối n8n tạo cả 9)", () => {
    const out = n8nIncidents({
      ...ok,
      items: [
        item({ file: "a.json", name: "ANSER Auto — A", action: "updated", credentialFixed: true }),
        item({ file: "b.json", name: "ANSER Auto — B", action: "updated", credentialFixed: true }),
      ],
    });
    expect(out.autoFixes).toHaveLength(1);
    expect(out.autoFixes[0].title).toBe("Đã tự gán SMTP cho 2 workflow");
    expect(out.autoFixes[0].body).toContain("A; B");
  });

  it("thiếu SMTP là việc gấp; tên workflow bỏ tiền tố cho gọn", () => {
    const out = n8nIncidents({ ...ok, smtpCredentialFound: false, items: [item({ action: "error", detail: "401" })] });
    expect(out.incidents.find((i) => i.key === "watchdog:n8n:no-smtp")?.severity).toBe("high");
    expect(out.incidents.find((i) => i.key === "watchdog:n8n:sync-error")?.body).toContain("X. Lỗi đầu tiên: 401");
  });
});

describe("n8nWatchdogSilence — canh người canh gác", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("chưa từng thấy n8n hỏi -> không báo (việc cài đặt, không phải hồi quy)", () => {
    expect(n8nWatchdogSilence(null, now)).toBeNull();
  });
  it("lỡ 1–3 lần (tới 2 giờ) -> chưa báo; quá 2 giờ -> báo mức cao", () => {
    expect(n8nWatchdogSilence(minutesAgo(120), now)).toBeNull();
    const hit = n8nWatchdogSilence(minutesAgo(125), now);
    expect(hit?.severity).toBe("high");
    expect(hit?.body).toContain("2 giờ");
  });
});

