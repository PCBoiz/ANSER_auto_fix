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

import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

// Danh sách bảng + thứ tự (= thứ tự khôi phục, bảng cha trước) nằm ở MỘT chỗ, dùng chung với
// sao lưu tự động trong app. Trước đây nó viết cứng ở đây và đã lệch: schema có 22 bảng, danh
// sách có 19 — may là 3 bảng thiếu đều bỏ được. Nay test đỏ nếu có bảng chưa được xếp chỗ.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const plan = JSON.parse(readFileSync(join(root, "src", "server", "backupTables.json"), "utf-8"));
const TABLES_IN_DEPENDENCY_ORDER = plan.order;

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

// Đọc lại và đối chiếu số dòng — một bản sao chưa từng đọc lại chỉ là một file ta hy vọng.
const reread = JSON.parse(readFileSync(file, "utf-8"));
const mismatched = Object.keys(backup.tables).filter(
  (t) => reread.tables?.[t]?.length !== backup.tables[t].length,
);
if (mismatched.length > 0) {
  console.error(`Đọc lại KHÔNG khớp ở: ${mismatched.join(", ")} — đừng dựa vào file này.`);
  await pool.end();
  process.exit(1);
}

// Ghi mốc để trang Kiểm tra vận hành biết lần cuối có bản sao đọc lại được là bao giờ. Bảng
// system_state chưa có (DB cũ chưa migrate) thì bỏ qua — bản sao vẫn là bản sao.
try {
  const state = JSON.stringify({
    at: backup.meta.createdAt,
    ok: true,
    source: "manual",
    file: file.split(/[\\/]/).pop(),
    rows: totalRows,
    tables: Object.keys(backup.tables).length,
    bytes: statSync(file).size,
  });
  for (const key of ["backup:last", "backup:lastOk"]) {
    await pool.query(
      `insert into system_state (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, state],
    );
  }
} catch {
  // Không ghi được mốc không làm hỏng bản sao.
}

console.log();
console.log(`Đã sao lưu ${totalRows} dòng / ${Object.keys(backup.tables).length} bảng -> ${file} (${sizeMb} MB), đã đọc lại khớp`);
console.log("Chép file này ra ổ cứng ngoài hoặc Google Drive — để cùng một chỗ với DB thì không phải backup.");

await pool.end();
