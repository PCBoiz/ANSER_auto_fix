// Sinh phần KIỂM KÊ trong docs/TONG_HOP_TU_DONG_HOA.md từ `automationCatalog.json`.
//
// Vì sao sinh thay vì viết tay: tài liệu về tự động hoá là thứ lệch nhanh nhất — thêm một quy
// tắc, đổi một giờ chạy, tài liệu vẫn nói như cũ và không ai biết. Ở đây kiểm kê là DỮ LIỆU
// trong mã, tài liệu chỉ là bản in của nó, và test khoá cả hai chiều (xem
// `__tests__/automationCatalog.test.ts`). Ý mượn từ Graphify: báo cáo sinh từ nguồn + CI kiểm
// tra schema, thay cho tài liệu chép tay.

import catalog from "@/lib/automationCatalog.json";

export type AutomationEntry = {
  id: string;
  name: string;
  group: string;
  trigger: string;
  does: string;
  where: string;
  closes?: string;
  workflow?: string;
  ruleType?: string;
  cronJob?: string;
  incidentKeys?: string[];
  env?: string[];
};

export type AutomationCatalog = {
  groups: Record<string, string>;
  entries: AutomationEntry[];
};

export const AUTOMATION_CATALOG = catalog as unknown as AutomationCatalog;

/** Mốc bao quanh phần tự sinh — mọi thứ ngoài hai mốc này do người viết, không bị ghi đè. */
export const DOC_START = "<!-- BẮT ĐẦU PHẦN TỰ SINH — sửa src/lib/automationCatalog.json rồi chạy: npm run docs:automation -->";
export const DOC_END = "<!-- HẾT PHẦN TỰ SINH -->";

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function groupTable(entries: AutomationEntry[]): string {
  const head = "| Quy trình | Chạy khi nào | Làm gì | Khép vòng thế nào | Ở đâu trong mã |\n|---|---|---|---|---|";
  const rows = entries.map(
    (e) =>
      `| **${cell(e.name)}** | ${cell(e.trigger)} | ${cell(e.does)} | ${cell(e.closes && e.closes !== "—" ? e.closes : "—")} | \`${cell(e.where)}\` |`,
  );
  return [head, ...rows].join("\n");
}

export function renderAutomationSection(input: AutomationCatalog = AUTOMATION_CATALOG): string {
  const parts: string[] = [DOC_START, ""];
  parts.push(`_Phần này do \`npm run docs:automation\` sinh ra từ \`frontend/src/lib/automationCatalog.json\`. Tổng cộng **${input.entries.length} quy trình tự động**._`);

  for (const [group, title] of Object.entries(input.groups)) {
    const entries = input.entries.filter((e) => e.group === group);
    if (entries.length === 0) continue;
    parts.push("", `### ${title} (${entries.length})`, "", groupTable(entries));
  }

  const withWorkflow = input.entries.filter((e) => e.workflow);
  parts.push(
    "",
    `### Workflow n8n (${withWorkflow.length} file trong \`frontend/n8n-workflows/\`)`,
    "",
    "| File | Quy trình | Quy tắc bật/tắt trong app |",
    "|---|---|---|",
    ...withWorkflow.map((e) => `| \`${e.workflow}\` | ${cell(e.name)} | ${e.ruleType ? `\`${e.ruleType}\`` : "— (hạ tầng, không tắt được từ app)"} |`),
  );

  const withIncidents = input.entries.filter((e) => e.incidentKeys?.length);
  parts.push(
    "",
    "### Khoá sự cố sinh ra trên chuông",
    "",
    "| Quy trình | Khoá |",
    "|---|---|",
    ...withIncidents.map((e) => `| ${cell(e.name)} | ${e.incidentKeys!.map((k) => `\`${k}\``).join(", ")} |`),
  );

  const envMap = new Map<string, string[]>();
  for (const e of input.entries) for (const v of e.env ?? []) envMap.set(v, [...(envMap.get(v) ?? []), e.name]);
  parts.push(
    "",
    "### Biến môi trường và quy trình phụ thuộc",
    "",
    "| Biến | Thiếu thì mất gì |",
    "|---|---|",
    ...[...envMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([v, names]) => `| \`${v}\` | ${cell(names.join("; "))} |`),
  );

  parts.push("", DOC_END);
  return parts.join("\n");
}

/** Thay phần giữa hai mốc trong tài liệu; giữ nguyên phần người viết. */
export function applyAutomationSection(doc: string, section: string): string {
  const start = doc.indexOf(DOC_START);
  const end = doc.indexOf(DOC_END);
  if (start === -1 || end === -1) throw new Error(`Không tìm thấy mốc tự sinh trong tài liệu (${DOC_START}).`);
  return doc.slice(0, start) + section + doc.slice(end + DOC_END.length);
}
