import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_BASE,
  decideActivation,
  decideSync,
  fingerprint,
  lacksSmtpCredential,
  renderTemplate,
  TOKEN_PLACEHOLDER,
  type WorkflowTemplate,
} from "@/lib/n8nTemplates";

const DIR = join(process.cwd(), "n8n-workflows");
const templates: Array<[string, WorkflowTemplate]> = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f, JSON.parse(readFileSync(join(DIR, f), "utf-8")) as WorkflowTemplate]);

const opts = {
  internalToken: "tok-123",
  appBaseUrl: "http://app:3000/",
  smtpCredential: { id: "c1", name: "MailHog" },
  alertEmail: "chu@gara.vn",
};

describe("Mọi file mẫu trong n8n-workflows/ (kiểm tra cả bộ, không chỉ một file)", () => {
  it("có ít nhất 12 mẫu (10 nghiệp vụ + canh gác app + báo nhanh sự cố)", () => {
    expect(templates.length).toBeGreaterThanOrEqual(12);
  });

  it.each(templates)("%s: đồ thị nối đúng node có thật", (_file, wf) => {
    const names = new Set(wf.nodes.map((n) => n.name));
    const targets = Object.values(wf.connections as Record<string, { main: Array<Array<{ node: string }>> }>)
      .flatMap((c) => c.main.flat().map((t) => t.node));
    for (const t of targets) expect(names.has(t)).toBe(true);
  });

  it.each(templates)("%s: sau khi render không còn placeholder token, không còn host.docker.internal", (_file, wf) => {
    const out = JSON.stringify(renderTemplate(wf, opts));
    expect(out).not.toContain(TOKEN_PLACEHOLDER);
    expect(out).not.toContain(DEFAULT_APP_BASE);
    expect(out).not.toContain("REPLACE_WITH_ALERT_EMAIL");
  });

  it.each(templates)("%s: mọi node Gửi Email được gán credential SMTP", (_file, wf) => {
    const rendered = renderTemplate(wf, opts);
    for (const n of rendered.nodes.filter((x) => x.type === "n8n-nodes-base.emailSend")) {
      expect(n.credentials?.smtp).toEqual({ id: "c1", name: "MailHog" });
    }
  });
});

describe("renderTemplate", () => {
  const wf: WorkflowTemplate = {
    name: "t",
    nodes: [
      {
        name: "Gọi",
        type: "n8n-nodes-base.httpRequest",
        parameters: {
          url: `={{ '${DEFAULT_APP_BASE}/api/n8n/internal/low-stock?branchId=' + $json.id }}`,
          headerParameters: { parameters: [{ name: "X-Internal-Token", value: TOKEN_PLACEHOLDER }] },
        },
      },
    ],
    connections: {},
  };

  it("thay cả URL nằm TRONG biểu thức n8n, không chỉ URL trơn", () => {
    const out = renderTemplate(wf, opts);
    expect(out.nodes[0].parameters.url).toBe("={{ 'http://app:3000/api/n8n/internal/low-stock?branchId=' + $json.id }}");
  });

  it("không sửa bản gốc (mẫu dùng lại cho lần đồng bộ sau)", () => {
    renderTemplate(wf, opts);
    expect(JSON.stringify(wf)).toContain(TOKEN_PLACEHOLDER);
  });

  it("thiếu token -> dừng hẳn, không đẩy placeholder lên n8n", () => {
    expect(() => renderTemplate(wf, { ...opts, internalToken: "" })).toThrow(/N8N_INTERNAL_TOKEN/);
  });
});

describe("fingerprint — phát hiện lệch mẫu, bỏ qua khác biệt vô nghĩa", () => {
  const [, base] = templates.find(([f]) => f === "morning_brief.json")!;

  it("n8n thêm id/position/credential và đảo thứ tự node -> vẫn coi là KHỚP", () => {
    const fromN8n = {
      ...base,
      nodes: [...base.nodes].reverse().map((n, i) => ({
        ...n,
        id: `uuid-${i}`,
        position: [0, i],
        credentials: { smtp: { id: "x", name: "y" } },
      })),
    };
    expect(fingerprint(fromN8n)).toBe(fingerprint(base));
  });

  it("đổi một tham số thật (giờ chạy) -> LỆCH", () => {
    const edited = structuredClone(base);
    (edited.nodes[0].parameters as { rule: { interval: Array<{ triggerAtHour: number }> } }).rule.interval[0].triggerAtHour = 6;
    expect(fingerprint(edited)).not.toBe(fingerprint(base));
  });
});

describe("decideSync — ranh giới tự sửa / hỏi người", () => {
  it("chưa có -> tạo; khớp -> giữ", () => {
    expect(decideSync(null, "a", false).action).toBe("create");
    expect(decideSync("a", "a", false).action).toBe("keep");
  });
  it("lệch mà không force -> KHÔNG đè (có thể ai đó đã chỉnh tay)", () => {
    expect(decideSync("b", "a", false).action).toBe("skip-drift");
  });
  it("lệch và force (người bấm Đồng bộ lại) -> cập nhật", () => {
    expect(decideSync("b", "a", true).action).toBe("update");
  });
});

describe("decideActivation — bộ canh gác không tự bật workflow gửi cho khách", () => {
  const base = { isActive: false, wantActive: true, trigger: "watchdog" as const, infra: false };

  it("canh gác thấy quy tắc bật mà workflow tắt -> KHÔNG tự bật, chờ người", () => {
    expect(decideActivation(base)).toBe("needs-human");
  });
  it("người bấm Đồng bộ -> bật", () => {
    expect(decideActivation({ ...base, trigger: "human" })).toBe("activate");
  });
  it("workflow hạ tầng (canh gác app) -> canh gác được tự bật", () => {
    expect(decideActivation({ ...base, infra: true })).toBe("activate");
  });
  it("app tắt quy tắc mà n8n còn bật -> tự tắt, kể cả khi không có người", () => {
    expect(decideActivation({ ...base, isActive: true, wantActive: false })).toBe("deactivate");
  });
  it("quy tắc chưa có dòng trong DB -> không đụng (đừng làm im workflow đang chạy)", () => {
    expect(decideActivation({ ...base, isActive: true, wantActive: null, trigger: "human" })).toBe("none");
  });
  it("đã khớp -> không làm gì", () => {
    expect(decideActivation({ ...base, isActive: true })).toBe("none");
  });
});

describe("lacksSmtpCredential — workflow tạo lúc n8n chưa có SMTP", () => {
  const [, base] = templates.find(([f]) => f === "morning_brief.json")!;

  it("mẫu gốc (chưa render) thiếu SMTP; render có SMTP thì đủ", () => {
    expect(lacksSmtpCredential(base)).toBe(true);
    expect(lacksSmtpCredential(renderTemplate(base, opts))).toBe(false);
  });

  it("đã gán một credential SMTP KHÁC (người chọn Gmail thay MailHog) -> không coi là thiếu", () => {
    const rendered = renderTemplate(base, { ...opts, smtpCredential: { id: "gmail", name: "Gmail" } });
    expect(lacksSmtpCredential(rendered)).toBe(false);
  });

  it("thiếu credential không làm vân tay lệch — đó là lý do cần kiểm tra riêng", () => {
    expect(fingerprint(base)).toBe(fingerprint(renderTemplate(base, { ...opts, internalToken: TOKEN_PLACEHOLDER, appBaseUrl: DEFAULT_APP_BASE, alertEmail: "REPLACE_WITH_ALERT_EMAIL" })));
  });
});

