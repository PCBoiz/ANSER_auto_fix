// Sao lưu toàn bộ dữ liệu ra một file JSON.
//
// Vì sao không dùng `pg_dump`: nó cần cài PostgreSQL client trên máy chạy backup, và trên
// Windows thì đó là một bản cài riêng mà gara không có lý do gì phải có. Script này dùng
// đúng driver mà app đang dùng, nên chạy được ở bất cứ đâu đã chạy được app.
//
// Neon có point-in-time restore sẵn, nhưng nó nằm trong tài khoản Neon — mất quyền truy
// cập tài khoản đó là mất luôn đường khôi phục. Một file JSON trên máy/ổ cứng ngoài là
// bản sao ĐỘC LẬP với nhà cung cấp, và đó mới là ý nghĩa của backup.
//
//     node scripts/backup-db.mjs                 -> backups/anser-auto-<ngày giờ>.json
//     node scripts/backup-db.mjs --out D:\sao-luu
//
// Khôi phục: xem `scripts/restore-db.mjs`.
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

// Thứ tự QUAN TRỌNG: đây cũng là thứ tự khôi phục, và bảng con phải đứng sau bảng cha,
// nếu không khoá ngoại sẽ chặn lúc chèn lại.
const TABLES_IN_DEPENDENCY_ORDER = [
  "branches",
  "employees",
  "users",
  "customers",
  "vehicles",
  "services",
  "parts",
  "appointments",
  "service_orders",
  "service_order_labors",
  "service_order_parts",
  "service_order_special_orders",
  "part_transactions",
  "invoices",
  "company_settings",
  "automation_rules",
  "sales_ledger",
  "purchase_ledger",
  "attendance_logs",
  // `login_attempts` cố tình KHÔNG sao lưu: đó là dữ liệu chống dò mật khẩu, sống 30 ngày
  // và không có giá trị gì khi khôi phục.
];

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1 ? process.argv[outIndex + 1] : "backups";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const backup = {
  meta: {
    createdAt: new Date().toISOString(),
    app: "anser-auto",
    // Ghi lại migration mới nhất: khôi phục vào một DB có schema cũ hơn sẽ hỏng lặng lẽ
    // (cột thiếu), nên bản sao phải tự nói nó thuộc phiên bản schema nào.
    schemaVersion: null,
  },
  tables: {},
};

try {
  const { rows } = await pool.query(
    `select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
  );
  backup.meta.schemaVersion = rows[0]?.created_at ?? null;
} catch {
  // DB chưa từng chạy migration qua drizzle-kit — không phải lỗi, chỉ là không có mốc.
}

let totalRows = 0;
for (const table of TABLES_IN_DEPENDENCY_ORDER) {
  try {
    const { rows } = await pool.query(`select * from "${table}"`);
    backup.tables[table] = rows;
    totalRows += rows.length;
    console.log(String(rows.length).padStart(7), table);
  } catch (error) {
    console.warn(`  bỏ qua ${table}: ${error.message}`);
  }
}

// Sequence sinh mã chứng từ: khôi phục dữ liệu mà không khôi phục vị trí sequence thì
// lệnh tiếp theo sẽ lấy lại số RO-2026-0001 đã tồn tại và nổ lỗi unique.
backup.sequences = {};
for (const seq of ["service_order_code_seq", "invoice_code_seq"]) {
  try {
    const { rows } = await pool.query(`select last_value, is_called from "${seq}"`);
    backup.sequences[seq] = rows[0];
  } catch {
    // Sequence chưa tồn tại (DB mới) — bỏ qua.
  }
}

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = join(outDir, `anser-auto-${stamp}.json`);
writeFileSync(file, JSON.stringify(backup, null, 2), "utf-8");

const sizeMb = (statSync(file).size / 1024 / 1024).toFixed(2);
console.log();
console.log(`Đã sao lưu ${totalRows} dòng / ${Object.keys(backup.tables).length} bảng -> ${file} (${sizeMb} MB)`);
console.log("Chép file này ra ổ cứng ngoài hoặc Google Drive — để cùng một chỗ với DB thì không phải backup.");

await pool.end();
