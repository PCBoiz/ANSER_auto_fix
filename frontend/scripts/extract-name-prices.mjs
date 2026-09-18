// Tách "giá trong tên" ra khỏi tên phụ tùng.
//
// Phát hiện ngày 17/09/2026 trên kho đồng-sơn nhập từ Excel: 600/781 tên phụ tùng kết thúc
// bằng dạng "G3.000", "G.700", "G300" — ví dụ "Kính chắn gió trước G1.400".
//
// ĐÃ KIỂM CHỨNG ĐÂY LÀ GIÁ NHẬP, KHÔNG PHẢI GIÁ BÁN. Với 495 mã có cả "G" lẫn giá vốn, tỷ lệ
// G×1000 / giá vốn có trung vị 1,00 (p10 = 0,98, p90 = 1,00). Giả thuyết ban đầu "G là giá
// bán, điền luôn 781 giá bán từ tên" là SAI, và làm theo nó sẽ đặt giá bán = giá vốn cho cả
// kho, tức bán không lãi.
//
// Hai việc script này làm được, cả hai đều cần người quyết:
//   1. Điền giá vốn cho mã đang thiếu giá vốn nhưng tên có "G".
//   2. Bỏ đuôi "G..." khỏi tên. Tên phụ tùng được IN LÊN HOÁ ĐƠN giao khách (dòng phụ tùng
//      snapshot đúng tên này) — để nguyên là in giá nhập của gara cho khách đọc.
//
// Mặc định chỉ XEM TRƯỚC:
//     node scripts/extract-name-prices.mjs
//     node scripts/extract-name-prices.mjs --apply-cost          # chỉ điền giá vốn còn trống
//     node scripts/extract-name-prices.mjs --apply-cost --apply-rename
//
// Không bao giờ ghi đè giá vốn đã có, và không bao giờ đụng giá bán.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { Pool } from "@neondatabase/serverless";

const APPLY_COST = process.argv.includes("--apply-cost");
const APPLY_RENAME = process.argv.includes("--apply-rename");

// `npm run data:name-prices --apply-cost` (thiếu `--` ở giữa): npm giữ cờ lại làm cấu hình của
// chính nó (npm_config_apply_cost) thay vì chuyển cho script. Dừng hẳn và chỉ đúng lệnh, thay vì
// lặng lẽ chạy xem trước để người gõ tưởng đã ghi.
if (
  (process.env.npm_config_apply_cost && !APPLY_COST) ||
  (process.env.npm_config_apply_rename && !APPLY_RENAME)
) {
  console.error("npm đã giữ lại cờ --apply-… (thiếu dấu -- ở giữa), CHƯA ghi gì. Gõ lại:");
  console.error("    npm run data:name-prices -- --apply-cost --apply-rename");
  process.exit(1);
}

// "G" + số, có thể có dấu chấm phân cách nghìn, có thể bắt đầu bằng dấu chấm ("G.700"),
// nằm ở CUỐI tên sau một khoảng trắng. Neo cuối chuỗi để không cắt nhầm chữ G trong tên
// ("Gương chiếu hậu", "Gioăng") — những chữ đó không theo sau bởi số rồi hết chuỗi.
const PRICE_SUFFIX = /\s+G\s?(\d{1,3}(?:\.\d{3})+|\.\d{3}|\d+)\s*$/i;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  `select p.id, p.code, p.name, p.cost, p.price, b.name as branch
   from parts p join branches b on b.id = p.branch_id
   order by b.name, p.code`,
);

const fillCost = [];
const rename = [];
const mismatch = [];
let withSuffix = 0;

for (const part of rows) {
  const m = part.name.match(PRICE_SUFFIX);
  if (!m) continue;
  withSuffix += 1;

  // Số trong tên tính bằng NGHÌN đồng: "G1.400" = 1.400.000đ, "G.700" = 700.000đ.
  const vnd = Number(m[1].replace(/\./g, "")) * 1000;
  const cleanName = part.name.replace(PRICE_SUFFIX, "").trim();

  if (part.cost === null) {
    fillCost.push({ ...part, vnd });
  } else if (Math.abs(part.cost - vnd) / Math.max(part.cost, 1) > 0.05) {
    // Lệch hơn 5% so với giá vốn đang lưu: không đoán cái nào đúng, chỉ liệt kê.
    mismatch.push({ ...part, vnd });
  }

  if (cleanName && cleanName !== part.name) rename.push({ ...part, cleanName });
}

const vnd = (n) => (n === null ? "—" : `${n.toLocaleString("vi-VN")}đ`);

console.log(`Tên có đuôi giá "G…": ${withSuffix}/${rows.length} phụ tùng`);
console.log();
console.log(`1) Điền giá vốn còn trống từ tên: ${fillCost.length} mã`);
for (const p of fillCost.slice(0, 12)) console.log(`   ${p.code.padEnd(8)} ${p.name.slice(0, 50).padEnd(50)} -> giá vốn ${vnd(p.vnd)}`);
if (fillCost.length > 12) console.log(`   ... và ${fillCost.length - 12} mã nữa`);

console.log();
console.log(`2) Bỏ đuôi giá khỏi tên (để không in giá nhập lên hoá đơn khách): ${rename.length} mã`);
for (const p of rename.slice(0, 8)) console.log(`   "${p.name}"  ->  "${p.cleanName}"`);
if (rename.length > 8) console.log(`   ... và ${rename.length - 8} mã nữa`);

console.log();
console.log(`Không tự xử lý — giá trong tên lệch >5% so với giá vốn đang lưu: ${mismatch.length} mã`);
for (const p of mismatch.slice(0, 8)) console.log(`   ${p.code.padEnd(8)} ${p.name.slice(0, 45).padEnd(45)} tên: ${vnd(p.vnd)}  | giá vốn: ${vnd(p.cost)}`);

if (!APPLY_COST && !APPLY_RENAME) {
  console.log();
  console.log("Chưa ghi gì. Để ghi thật: npm run data:name-prices -- --apply-cost [--apply-rename]  (có dấu -- ở giữa)");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("begin");
  let costDone = 0;
  let renameDone = 0;
  if (APPLY_COST) {
    for (const p of fillCost) {
      // `and cost is null`: nếu ai đó vừa nhập giá vốn qua giao diện giữa lúc xem trước và
      // lúc ghi, giữ giá của họ.
      const r = await client.query(`update parts set cost = $1, updated_at = now() where id = $2 and cost is null`, [p.vnd, p.id]);
      costDone += r.rowCount;
    }
  }
  if (APPLY_RENAME) {
    for (const p of rename) {
      // Vướng unique (branch_id, code) không xảy ra vì chỉ đổi tên, không đổi mã.
      const r = await client.query(`update parts set name = $1, updated_at = now() where id = $2 and name = $3`, [p.cleanName, p.id, p.name]);
      renameDone += r.rowCount;
    }
  }
  await client.query("commit");
  console.log();
  console.log(`Đã điền giá vốn: ${costDone}. Đã đổi tên: ${renameDone}.`);
  console.log("Lưu ý: dòng phụ tùng trên lệnh sửa chữa CŨ giữ nguyên tên lúc lập (snapshot) — chỉ lệnh mới dùng tên đã sửa.");
} catch (error) {
  await client.query("rollback");
  console.error("Lỗi — đã hoàn tác toàn bộ:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
