// Quét bundle client sau `next build` xem 3 mật khẩu đã gỡ ngày 17/09/2026 có quay lại không.
//
// Cùng phép kiểm tra với bước "Không có mật khẩu cũ trong bundle client" trong CI, để
// `npm run check` ở máy dev cho kết quả giống hệt GitHub Actions — kể cả khi Actions không
// chạy được (fork chưa bật, hết phút, chưa xác minh thanh toán).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LEAKED = ["demo1234", "aa660156", "f7820a49"];
const ROOT = ".next/static";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let hits = 0;
try {
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, "utf-8");
    for (const secret of LEAKED) {
      if (text.includes(secret)) {
        console.error(`LỘ: "${secret}" trong ${file}`);
        hits += 1;
      }
    }
  }
} catch (error) {
  console.error(`Không đọc được ${ROOT} — chạy \`npm run build\` trước.`, error.message);
  process.exit(2);
}

if (hits > 0) process.exit(1);
console.log(`Bundle client sạch — không chuỗi nào trong ${LEAKED.length} mật khẩu đã lộ xuất hiện.`);
