import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { backupFileName, filesToPrune, verifyBackup, type BackupState } from "@/lib/backupPolicy";
import { db } from "@/server/db/client";
import { getSystemState, setSystemState } from "@/server/store/systemState";
import plan from "@/server/backupTables.json";

// Sao lưu tự động — cùng định dạng với `scripts/backup-db.mjs`, nên `npm run db:restore`
// khôi phục được cả hai loại file.
//
// Chỉ chạy khi có `BACKUP_DIR` (bản tự host: docker-compose.yml đặt sẵn, gắn volume riêng).
// Trên Vercel hệ thống file là tạm — ghi vào đó là tự lừa mình, nên không đặt biến là không chạy.

export const BACKUP_LAST_KEY = "backup:last";
export const BACKUP_LAST_OK_KEY = "backup:lastOk";

export function backupDir(): string | null {
  const dir = process.env.BACKUP_DIR?.trim();
  return dir ? resolve(dir) : null;
}

/**
 * Thư mục THỨ HAI, nằm ngoài máy chủ về mặt vật lý: thư mục Google Drive for Desktop /
 * OneDrive / Dropbox (chủ gara chọn 20/09/2026), ổ mạng, ổ USB. App chỉ ghi file vào đó —
 * phần đưa lên mây là việc của phần mềm đồng bộ, nên không cần credential nào trong app.
 */
export function backupCopyDir(): string | null {
  const dir = process.env.BACKUP_COPY_DIR?.trim();
  return dir ? resolve(dir) : null;
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** Chép, đọc lại so từng byte (sha256), rồi xoay vòng thư mục đích như thư mục chính. */
async function copyOffsite(file: string, name: string, keep: number): Promise<{ copied: boolean; copyError?: string }> {
  const dir = backupCopyDir();
  if (!dir) return { copied: false, copyError: undefined };
  try {
    await mkdir(dir, { recursive: true });
    const target = join(dir, name);
    await copyFile(file, target);
    const [a, b] = await Promise.all([readFile(file), readFile(target)]);
    if (sha256(a) !== sha256(b)) throw new Error("Bản chép đọc lại không khớp bản gốc.");
    for (const old of filesToPrune(await readdir(dir), keep)) await unlink(join(dir, old)).catch(() => {});
    return { copied: true };
  } catch (error) {
    return { copied: false, copyError: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}

function backupKeep(): number {
  const n = Number(process.env.BACKUP_KEEP);
  return Number.isInteger(n) && n > 0 ? n : 14;
}

export async function getBackupState() {
  const [last, lastOk] = await Promise.all([
    getSystemState<BackupState>(BACKUP_LAST_KEY),
    getSystemState<BackupState>(BACKUP_LAST_OK_KEY),
  ]);
  return { last: last?.value ?? null, lastOk: lastOk?.value ?? null };
}

async function recordState(state: BackupState) {
  await setSystemState(BACKUP_LAST_KEY, state);
  if (state.ok) await setSystemState(BACKUP_LAST_OK_KEY, state);
}

type Rows = { rows: Record<string, unknown>[] };

export type BackupResult = { status: "ok" | "skipped" | "error"; summary: string };

/**
 * Sao lưu -> ghi file -> ĐỌC LẠI và đối chiếu số dòng -> xoay vòng bản cũ -> ghi trạng thái.
 *
 * Xoay vòng CHỈ sau khi bản mới đã đọc lại khớp: xoá bản cũ trước rồi mới phát hiện bản mới
 * hỏng là mất cả hai.
 */
export async function runBackup(source: BackupState["source"]): Promise<BackupResult> {
  const dir = backupDir();
  if (!dir) {
    return { status: "skipped", summary: "Chưa đặt BACKUP_DIR — sao lưu tự động đang tắt." };
  }

  const startedAt = new Date();
  try {
    const backup: {
      meta: { createdAt: string; app: string; schemaVersion: unknown; source: string };
      tables: Record<string, unknown[]>;
      sequences: Record<string, unknown>;
    } = {
      meta: { createdAt: startedAt.toISOString(), app: "anser-auto", schemaVersion: null, source },
      tables: {},
      sequences: {},
    };

    try {
      const r = (await db.execute(
        sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
      )) as unknown as Rows;
      backup.meta.schemaVersion = r.rows[0]?.created_at ?? null;
    } catch {
      // DB chưa chạy migration qua drizzle-kit — không phải lỗi.
    }

    // Khác script chạy tay: bảng nào đọc lỗi thì DỪNG, không "bỏ qua rồi đi tiếp". Bản sao
    // thiếu một bảng mà vẫn báo thành công còn nguy hiểm hơn không có bản sao.
    const counts: Record<string, number> = {};
    for (const table of plan.order) {
      const r = (await db.execute(sql.raw(`select * from "${table}"`))) as unknown as Rows;
      backup.tables[table] = r.rows;
      counts[table] = r.rows.length;
    }
    for (const seq of ["service_order_code_seq", "invoice_code_seq"]) {
      try {
        const r = (await db.execute(sql.raw(`select last_value, is_called from "${seq}"`))) as unknown as Rows;
        backup.sequences[seq] = r.rows[0];
      } catch {
        // Sequence chưa tồn tại (DB mới).
      }
    }

    await mkdir(dir, { recursive: true });
    const name = backupFileName(startedAt);
    const file = join(dir, name);
    await writeFile(file, JSON.stringify(backup), "utf-8");

    const check = verifyBackup(counts, JSON.parse(await readFile(file, "utf-8")));
    if (!check.ok) throw new Error(`Đọc lại không khớp: ${check.problems.join(" ")}`);

    const pruned = filesToPrune(await readdir(dir), backupKeep());
    for (const old of pruned) await unlink(join(dir, old)).catch(() => {});

    const bytes = (await stat(file)).size;
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    const offsite = backupCopyDir() ? await copyOffsite(file, name, backupKeep()) : null;
    await recordState({
      at: startedAt.toISOString(),
      ok: true,
      source,
      file: name,
      rows,
      tables: plan.order.length,
      bytes,
      ...(offsite ?? {}),
    });
    const base = `Sao lưu ${rows} dòng / ${plan.order.length} bảng (${(bytes / 1024 / 1024).toFixed(2)} MB), đã đọc lại khớp${pruned.length ? `, xoá ${pruned.length} bản cũ` : ""}`;
    if (offsite && !offsite.copied) {
      // Bản trên máy vẫn tốt, nhưng báo "error" để lịch/nhật ký thấy — mất máy là mất cả hai.
      return { status: "error", summary: `${base}; CHÉP RA NGOÀI LỖI: ${offsite.copyError}` };
    }
    return { status: "ok", summary: `${base}${offsite ? ", đã chép ra thư mục ngoài" : ""}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordState({ at: startedAt.toISOString(), ok: false, source, error: message.slice(0, 300) }).catch(() => {});
    return { status: "error", summary: message };
  }
}
