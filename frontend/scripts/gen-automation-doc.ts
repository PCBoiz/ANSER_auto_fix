// Ghi phần kiểm kê tự sinh vào docs/TONG_HOP_TU_DONG_HOA.md.
//
//     npm run docs:automation
//
// Test `automationCatalog.test.ts` chạy cùng logic này và đỏ nếu tài liệu lệch — nên quên chạy
// script cũng không lọt được qua `npm run check`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAutomationSection, renderAutomationSection } from "../src/lib/automationDoc";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const file = join(repoRoot, "docs", "TONG_HOP_TU_DONG_HOA.md");

const before = readFileSync(file, "utf-8");
const after = applyAutomationSection(before, renderAutomationSection());
if (before === after) {
  console.log("[docs:automation] Tài liệu đã khớp kiểm kê — không sửa gì.");
} else {
  writeFileSync(file, after, "utf-8");
  console.log(`[docs:automation] Đã cập nhật ${file}`);
}
