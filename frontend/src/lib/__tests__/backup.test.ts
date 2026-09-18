import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  BACKUP_MAX_AGE_MS,
  backupFileName,
  backupIncidents,
  filesToPrune,
  verifyBackup,
  type BackupState,
} from "@/lib/backupPolicy";
import * as schema from "@/server/db/schema";
import plan from "@/server/backupTables.json";

// schema.ts chỉ khai báo bảng (drizzle pg-core), không mở kết nối DB — import ở test được.
// (schema còn export cả sequence — lọc lấy đúng bảng.)
const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

describe("Danh sách bảng sao lưu khớp schema thật", () => {
  it("MỌI bảng trong schema đều đã được xếp chỗ: sao lưu hoặc cố ý loại (kèm lý do)", () => {
    const placed = new Set([...plan.order, ...Object.keys(plan.excluded)]);
    const missing = tables.map((t) => getTableName(t)).filter((name) => !placed.has(name));
    // Đỏ ở đây = vừa thêm bảng mới vào schema. Ghi nó vào src/server/backupTables.json:
    // "order" (đúng chỗ theo khoá ngoại) hoặc "excluded" (kèm lý do vì sao không cần sao lưu).
    expect(missing).toEqual([]);
  });

  it("không bảng nào vừa được sao lưu vừa bị loại, không tên nào không có trong schema", () => {
    const names = new Set(tables.map((t) => getTableName(t)));
    expect(plan.order.filter((t) => t in plan.excluded)).toEqual([]);
    expect([...plan.order, ...Object.keys(plan.excluded)].filter((t) => !names.has(t))).toEqual([]);
  });

  it("thứ tự = thứ tự khôi phục: bảng cha (theo khoá ngoại thật) luôn đứng trước bảng con", () => {
    const position = new Map(plan.order.map((t, i) => [t, i]));
    const violations: string[] = [];
    for (const table of tables) {
      const name = getTableName(table);
      if (!position.has(name)) continue;
      for (const fk of getTableConfig(table).foreignKeys) {
        const parent = getTableName(fk.reference().foreignTable);
        if (parent === name || !position.has(parent)) continue;
        if (position.get(parent)! > position.get(name)!) violations.push(`${parent} phải đứng trước ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("xoay vòng bản sao", () => {
  const f = (iso: string) => backupFileName(new Date(iso));

  it("giữ N bản mới nhất theo thời điểm trong tên", () => {
    const files = [f("2026-09-10T19:00:00Z"), f("2026-09-12T19:00:00Z"), f("2026-09-11T19:00:00Z")];
    expect(filesToPrune(files, 2)).toEqual([f("2026-09-10T19:00:00Z")]);
  });

  it("KHÔNG đụng file người dùng tự đặt tên, và luôn giữ ít nhất 1 bản", () => {
    const files = ["truoc-khi-don-kho.json", f("2026-09-12T19:00:00Z"), "ghi-chu.txt"];
    expect(filesToPrune(files, 0)).toEqual([]);
  });
});

describe("đọc lại bản sao", () => {
  it("khớp số dòng -> ok; thiếu bảng hoặc lệch số dòng -> nêu rõ", () => {
    expect(verifyBackup({ parts: 2 }, { tables: { parts: [{}, {}] } }).ok).toBe(true);
    const bad = verifyBackup({ parts: 2, users: 1 }, { tables: { parts: [{}] } });
    expect(bad.ok).toBe(false);
    expect(bad.problems).toEqual(["parts: đọc lại 1 dòng, lúc lấy là 2.", "Thiếu bảng users."]);
    expect(verifyBackup({ parts: 1 }, null).ok).toBe(false);
  });
});

describe("sự cố sao lưu cho bộ canh gác", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();
  const ok = (hoursAgo: number): BackupState => ({ at: at(hoursAgo), ok: true, source: "schedule" });

  it("chưa từng sao lưu -> không báo (việc cài đặt, trang Kiểm tra vận hành đã nhắc)", () => {
    expect(backupIncidents({ configured: true, last: null, lastOk: null }, now)).toEqual([]);
  });

  it("lần gần nhất lỗi -> báo ngay kèm lỗi, kể cả khi bản thành công trước đó còn mới", () => {
    const failed: BackupState = { at: at(1), ok: false, source: "schedule", error: "ENOSPC: hết dung lượng" };
    const out = backupIncidents({ configured: true, last: failed, lastOk: ok(25) }, now);
    expect(out.map((i) => i.key)).toEqual(["watchdog:backup:failed"]);
    expect(out[0].body).toContain("ENOSPC");
  });

  it("bản thành công gần nhất quá 36 giờ khi đang bật -> lịch sao lưu đã chết", () => {
    const hours = BACKUP_MAX_AGE_MS / 3600_000;
    expect(backupIncidents({ configured: true, last: ok(hours - 1), lastOk: ok(hours - 1) }, now)).toEqual([]);
    const out = backupIncidents({ configured: true, last: ok(hours + 1), lastOk: ok(hours + 1) }, now);
    expect(out.map((i) => i.key)).toEqual(["watchdog:backup:stale"]);
  });

  it("đã tắt sao lưu tự động (bỏ BACKUP_DIR) -> không báo 'ngừng chạy'", () => {
    expect(backupIncidents({ configured: false, last: ok(100), lastOk: ok(100) }, now)).toEqual([]);
  });
});
