// Dọn dữ liệu MINH HOẠ do `seedInitialData()` tạo lúc DB còn rỗng, để nó không nằm lẫn
// với hàng và người thật của gara.
//
// Vì sao cần script riêng mà không xoá tay trên UI: phụ tùng/dịch vụ mẫu có thể đã được
// dùng thật (xuất kho, đưa vào lệnh sửa chữa). Xoá một mã đã phát sinh giao dịch là xoá
// luôn lịch sử đối chiếu của giao dịch đó. Script này KIỂM TRA từng mã trước, và bỏ qua
// (không xoá) bất cứ thứ gì đã có dấu vết sử dụng — rồi nói rõ cái nào bị bỏ qua vì sao.
//
// Mặc định chạy ở chế độ XEM TRƯỚC, không đụng vào DB:
//     node scripts/clean-demo-data.mjs
// Xoá thật:
//     node scripts/clean-demo-data.mjs --apply
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");

// Đúng cặp (mã, tên) mà `src/server/store/seed.ts` sinh ra. Dò cả hai: chỉ theo mã thì một
// hạng mục thật mà gara tự đặt "DV-001" cũng bị xoá; chỉ theo tên thì "Lọc dầu động cơ" là
// mặt hàng có thật ở mọi gara. Khớp đồng thời cả hai mới đủ chắc là bản seed.
const DEMO_PARTS = [
  ["PT-001", "Lọc dầu động cơ"], ["PT-002", "Dầu nhớt 5W-30 (1L)"], ["PT-003", "Lọc gió động cơ"],
  ["PT-004", "Má phanh trước (bộ)"], ["PT-005", "Ắc quy 12V-60Ah"], ["PT-006", "Lốp 205/55 R16"],
  ["PT-007", "Nước làm mát (1L)"],
];
const DEMO_SERVICES = [
  ["DV-001", "Bảo dưỡng cấp 1 (5.000 km)"], ["DV-002", "Bảo dưỡng cấp 2 (20.000 km)"],
  ["DV-003", "Thay dầu động cơ + lọc dầu"], ["DV-004", "Kiểm tra - chẩn đoán bằng máy"],
  ["DV-005", "Thay má phanh trước"], ["DV-006", "Cân bằng động - đảo lốp"],
  ["DV-007", "Vệ sinh dàn lạnh - nạp ga điều hoà"], ["DV-008", "Sơn dặm 1 tấm vỏ"],
];
const DEMO_PART_CODES = DEMO_PARTS.map(([c]) => c);
const DEMO_SERVICE_CODES = DEMO_SERVICES.map(([c]) => c);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

const willDelete = [];
const skipped = [];

async function inspectParts() {
  const rows = await q(
    `select p.id, p.code, p.name, p.stock, b.name as branch,
            (select count(*)::int from part_transactions t where t.part_id = p.id) as tx,
            (select count(*)::int from service_order_parts sp where sp.part_id = p.id) as lines
     from parts p join branches b on b.id = p.branch_id
     where p.code = any($1::text[]) and p.name = any($2::text[])`,
    [DEMO_PART_CODES, DEMO_PARTS.map(([, n]) => n)],
  );
  for (const r of rows) {
    if (r.tx > 0 || r.lines > 0) {
      skipped.push(
        `phụ tùng ${r.code} "${r.name}" — đã có ${r.tx} phiếu kho và ${r.lines} dòng trên lệnh sửa chữa, giữ lại để không mất lịch sử`,
      );
    } else {
      willDelete.push({ kind: "part", id: r.id, label: `phụ tùng ${r.code} "${r.name}" (${r.branch}, tồn ${r.stock})` });
    }
  }
}

async function inspectServices() {
  const rows = await q(
    `select s.id, s.code, s.name,
            (select count(*)::int from service_order_labors l where l.service_id = s.id) as lines
     from services s where s.code = any($1::text[]) and s.name = any($2::text[])`,
    [DEMO_SERVICE_CODES, DEMO_SERVICES.map(([, n]) => n)],
  );
  for (const r of rows) {
    if (r.lines > 0) {
      skipped.push(`hạng mục ${r.code} "${r.name}" — đã dùng trong ${r.lines} dòng công, giữ lại`);
    } else {
      willDelete.push({ kind: "service", id: r.id, label: `hạng mục ${r.code} "${r.name}"` });
    }
  }
}

async function inspectEmployees() {
  const rows = await q(
    `select e.id, e.name, e.position,
            (select count(*)::int from attendance_logs a where a.employee_id = e.id) as shifts,
            (select count(*)::int from service_order_labors l where l.technician_id = e.id) as jobs,
            (select count(*)::int from users u where u.employee_id = e.id) as accounts
     from employees e where e.name ilike '%(test)%'`,
  );
  for (const r of rows) {
    if (r.shifts > 0 || r.jobs > 0) {
      skipped.push(
        `nhân sự "${r.name}" — đã có ${r.shifts} ca chấm công và ${r.jobs} dòng việc, giữ lại (giờ công phải còn để tính lương)`,
      );
    } else {
      willDelete.push({
        kind: "employee",
        id: r.id,
        label: `nhân sự "${r.name}" (${r.position})${r.accounts > 0 ? ` — sẽ gỡ liên kết khỏi ${r.accounts} tài khoản` : ""}`,
      });
    }
  }
}

await inspectParts();
await inspectServices();
await inspectEmployees();

console.log(APPLY ? "=== XOÁ DỮ LIỆU MẪU ===" : "=== XEM TRƯỚC (chưa xoá gì) ===");
console.log();

if (willDelete.length === 0) {
  console.log("Không còn dữ liệu mẫu nào xoá được.");
} else {
  console.log(`Sẽ xoá ${willDelete.length} mục:`);
  for (const d of willDelete) console.log("  -", d.label);
}

if (skipped.length > 0) {
  console.log();
  console.log(`Bỏ qua ${skipped.length} mục (đã phát sinh dữ liệu thật):`);
  for (const s of skipped) console.log("  !", s);
}

if (!APPLY) {
  console.log();
  // Nói rõ "chưa xoá gì" + đúng câu lệnh: `npm run data:clean-demo --apply` (thiếu `--` ở
  // giữa) bị npm nuốt mất cờ --apply mà không báo gì — đã thử trên npm 11. Người gõ sẽ tưởng
  // đã xoá xong, trong khi script chỉ chạy xem trước.
  console.log("CHƯA XOÁ GÌ — đây là bản xem trước. Để xoá thật:");
  console.log("    npm run data:clean-demo -- --apply      (có dấu -- ở giữa)");
  console.log("  hoặc node scripts/clean-demo-data.mjs --apply");
  await pool.end();
  process.exit(0);
}

// Một transaction cho tất cả: xoá nửa chừng rồi lỗi sẽ để lại trạng thái lẫn lộn khó
// biết đã tới đâu.
const client = await pool.connect();
try {
  await client.query("begin");
  for (const d of willDelete) {
    if (d.kind === "part") await client.query(`delete from parts where id = $1`, [d.id]);
    if (d.kind === "service") await client.query(`delete from services where id = $1`, [d.id]);
    if (d.kind === "employee") {
      // `users.employee_id` là `on delete set null` nên tài khoản không bị xoá theo —
      // nhưng nói rõ ra đây để người đọc không phải tra lại schema.
      await client.query(`update users set employee_id = null where employee_id = $1`, [d.id]);
      await client.query(`delete from employees where id = $1`, [d.id]);
    }
  }
  await client.query("commit");
  console.log();
  console.log(`Đã xoá ${willDelete.length} mục.`);
} catch (error) {
  await client.query("rollback");
  console.error("Lỗi — đã hoàn tác toàn bộ:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
