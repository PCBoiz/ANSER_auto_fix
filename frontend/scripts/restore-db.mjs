// Khôi phục từ file JSON do `backup-db.mjs` tạo.
//
// Một bản sao lưu chưa từng khôi phục thử thì chưa phải bản sao lưu — nó chỉ là một file
// mà ta HY VỌNG là đọc được. Script này tồn tại để việc thử khôi phục là một câu lệnh,
// chứ không phải một buổi chiều viết code lúc đang mất dữ liệu.
//
//     node scripts/restore-db.mjs backups/anser-auto-....json            # xem trước
//     node scripts/restore-db.mjs backups/anser-auto-....json --apply    # ghi thật
//
// CẢNH BÁO: `--apply` XOÁ SẠCH dữ liệu hiện có của các bảng trong file rồi chèn lại.
// Hãy chạy vào một Neon branch nhánh riêng khi diễn tập, đừng chạy vào DB đang dùng.
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!file) {
  console.error("Dùng: node scripts/restore-db.mjs <file-backup.json> [--apply]");
  process.exit(1);
}

const backup = JSON.parse(readFileSync(file, "utf-8"));
const tables = Object.keys(backup.tables ?? {});

console.log(`Bản sao lưu tạo lúc: ${backup.meta?.createdAt ?? "không rõ"}`);
console.log(`Mốc schema: ${backup.meta?.schemaVersion ?? "không rõ"}`);
console.log();
for (const t of tables) console.log(String(backup.tables[t].length).padStart(7), t);

if (!APPLY) {
  console.log();
  // `npm run db:restore <file> --apply` (thiếu `--`) bị npm nuốt mất --apply — nói rõ lệnh đúng.
  console.log("CHƯA GHI GÌ — đây là bản xem trước. Để ghi thật (XOÁ dữ liệu hiện có của các bảng trên):");
  console.log(`    npm run db:restore -- ${file} --apply      (có dấu -- ở giữa)`);
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("begin");

  // Xoá theo thứ tự NGƯỢC với thứ tự phụ thuộc: bảng con trước, bảng cha sau, nếu không
  // khoá ngoại sẽ chặn.
  for (const table of [...tables].reverse()) {
    await client.query(`delete from "${table}"`);
  }

  let inserted = 0;
  for (const table of tables) {
    const rows = backup.tables[table];
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    const colList = columns.map((c) => `"${c}"`).join(", ");

    for (const row of rows) {
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await client.query(
        `insert into "${table}" (${colList}) values (${placeholders})`,
        columns.map((c) => row[c]),
      );
      inserted += 1;
    }
    console.log(`  ${table}: ${rows.length} dòng`);
  }

  // Đưa sequence về đúng vị trí, nếu không mã chứng từ tiếp theo sẽ trùng mã đã có.
  for (const [seq, state] of Object.entries(backup.sequences ?? {})) {
    if (!state) continue;
    await client.query(`select setval($1, $2, $3)`, [seq, state.last_value, state.is_called]);
    console.log(`  sequence ${seq} -> ${state.last_value}`);
  }

  await client.query("commit");
  console.log();
  console.log(`Đã khôi phục ${inserted} dòng.`);
} catch (error) {
  await client.query("rollback");
  console.error("Lỗi — đã hoàn tác toàn bộ, DB giữ nguyên như trước khi chạy:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
