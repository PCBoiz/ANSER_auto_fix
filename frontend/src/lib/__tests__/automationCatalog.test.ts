import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOMATION_CATALOG, applyAutomationSection, renderAutomationSection } from "@/lib/automationDoc";
import { AUTOMATION_RULE_TYPES } from "@/server/domain";
import { CRON_JOBS } from "@/server/automation/cron";
import { INCIDENT_KINDS } from "@/lib/opsLoop";

// Khoá BA chiều: mã ↔ kiểm kê ↔ tài liệu.
//
// Thêm một quy tắc, một workflow, một việc theo lịch mà quên ghi vào kiểm kê -> đỏ.
// Sửa kiểm kê mà quên chạy `npm run docs:automation` -> đỏ.
// Nhờ vậy docs/TONG_HOP_TU_DONG_HOA.md không bao giờ nói sai về hệ thống.

const entries = AUTOMATION_CATALOG.entries;
// vitest chạy với cwd = frontend/; tài liệu nằm ở thư mục gốc repo.
const repoRoot = dirname(process.cwd());

describe("Kiểm kê tự động hoá bao phủ mã nguồn", () => {
  it("mọi loại quy tắc trong AUTOMATION_RULE_TYPES đều có trong kiểm kê", () => {
    const covered = new Set(entries.map((e) => e.ruleType).filter(Boolean));
    expect([...AUTOMATION_RULE_TYPES].filter((t) => !covered.has(t))).toEqual([]);
  });

  it("mọi file workflow trong n8n-workflows/ đều có trong kiểm kê", () => {
    const files = readdirSync(join(process.cwd(), "n8n-workflows")).filter((f) => f.endsWith(".json"));
    const covered = new Set(entries.map((e) => e.workflow).filter(Boolean));
    expect(files.filter((f) => !covered.has(f))).toEqual([]);
  });

  it("mọi việc chạy theo lịch (CRON_JOBS) đều có trong kiểm kê", () => {
    const covered = new Set(entries.flatMap((e) => [e.cronJob, e.ruleType]).filter(Boolean));
    expect([...CRON_JOBS].filter((j) => !covered.has(j))).toEqual([]);
  });

  it("mọi loại sự cố (INCIDENT_KINDS) đều có ít nhất một quy trình sinh ra nó", () => {
    const keys = entries.flatMap((e) => e.incidentKeys ?? []);
    expect([...INCIDENT_KINDS].filter((kind) => !keys.some((k) => k.startsWith(`${kind}:`)))).toEqual([]);
  });

  it("mỗi mục có đủ trường bắt buộc, id không trùng, nhóm có thật", () => {
    const ids = new Set<string>();
    for (const e of entries) {
      expect(e.id, `thiếu id: ${JSON.stringify(e)}`).toBeTruthy();
      expect(ids.has(e.id), `id trùng: ${e.id}`).toBe(false);
      ids.add(e.id);
      for (const field of ["name", "trigger", "does", "where"] as const) {
        expect(e[field], `${e.id} thiếu ${field}`).toBeTruthy();
      }
      expect(Object.keys(AUTOMATION_CATALOG.groups)).toContain(e.group);
    }
  });

  it("biến môi trường nhắc trong kiểm kê đều thật sự được mã đọc", () => {
    const sources = [
      "src/server",
      "src/lib",
      "src/instrumentation.ts",
      "src/app/api",
    ];
    const read = (dir: string): string => {
      const full = join(process.cwd(), dir);
      const stack = [full];
      let text = "";
      while (stack.length) {
        const cur = stack.pop()!;
        for (const entry of readdirSync(cur, { withFileTypes: true })) {
          const p = join(cur, entry.name);
          if (entry.isDirectory()) stack.push(p);
          else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) text += readFileSync(p, "utf-8");
        }
      }
      return text;
    };
    const code = sources
      .map((s) => (s.endsWith(".ts") ? readFileSync(join(process.cwd(), s), "utf-8") : read(s)))
      .join("");
    const missing = [...new Set(entries.flatMap((e) => e.env ?? []))].filter((v) => !code.includes(`process.env.${v}`));
    expect(missing).toEqual([]);
  });
});

describe("Tài liệu khớp kiểm kê", () => {
  it("docs/TONG_HOP_TU_DONG_HOA.md đã được sinh lại sau lần sửa kiểm kê gần nhất", () => {
    const file = join(repoRoot, "docs", "TONG_HOP_TU_DONG_HOA.md");
    const doc = readFileSync(file, "utf-8");
    // Đỏ ở đây nghĩa là: chạy `npm run docs:automation` rồi commit lại tài liệu.
    expect(applyAutomationSection(doc, renderAutomationSection())).toBe(doc);
  });
});
