// Cài git hook chặn push khi mã đang đỏ.
//
//     npm run hooks:install
//
// Vì sao cần: CI trên fork đang không chạy (tài khoản GitHub bị khoá thanh toán), nên không có
// lớp nào chặn một lần push làm hỏng nhánh chính. Hook chạy đúng `npm run check` — chuỗi giống
// hệt CI. Muốn bỏ qua một lần (đang push nhánh nháp): `git push --no-verify`.
//
// Ý mượn từ Graphify (`graphify hook install`): việc gì phải chạy mỗi lần thay đổi mã thì gắn
// vào git, đừng trông vào trí nhớ.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(frontend);
const hooksDir = join(repoRoot, ".git", "hooks");

if (!existsSync(join(repoRoot, ".git"))) {
  console.error("Không thấy thư mục .git — chạy lệnh này trong bản sao git của dự án.");
  process.exit(1);
}
mkdirSync(hooksDir, { recursive: true });

const hook = `#!/bin/sh
# Do ANSER Auto tạo: npm run hooks:install
# Chặn push khi typecheck/lint/test/build đỏ. Bỏ qua một lần: git push --no-verify
echo "[pre-push] npm run check (bỏ qua bằng --no-verify)"
cd "$(dirname "$0")/../../frontend" || exit 1
# Build sang thư mục riêng: nếu đang mở "npm run dev" thì hai bên không tranh .next (Windows).
export NEXT_DIST_DIR=.next-hook
npm run check || {
  echo ""
  echo "[pre-push] ĐỎ — chưa push. Sửa xong chạy lại, hoặc git push --no-verify nếu thật sự cần."
  exit 1
}
`;

const target = join(hooksDir, "pre-push");
if (existsSync(target) && !readFileSync(target, "utf-8").includes("ANSER Auto")) {
  console.error(`Đã có hook khác ở ${target} — không ghi đè. Xem rồi tự gộp nếu muốn.`);
  process.exit(1);
}
writeFileSync(target, hook, "utf-8");
try {
  chmodSync(target, 0o755);
} catch {
  // Windows không cần bit thực thi; Git Bash vẫn chạy được hook.
}
console.log(`Đã cài ${target}. Mỗi lần "git push" sẽ chạy npm run check trước.`);
