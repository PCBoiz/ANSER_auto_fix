// Logic THUẦN của sao lưu tự động — không import db, không chạm đĩa, có test
// (`__tests__/backup.test.ts`).
//
// Trước đây sao lưu là một script chạy tay (`npm run db:backup`): không lịch, không ai biết
// lần cuối là bao giờ, và bản sao chưa từng được đọc lại. Sao lưu mà không kiểm chứng thì chỉ
// là một file ta HY VỌNG đọc được — đúng thứ vòng lặp khép kín phải loại bỏ.

import type { IncidentInput } from "@/lib/opsLoop";

const HOUR = 60 * 60 * 1000;

const FILE_PATTERN = /^anser-auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

/** Cùng định dạng tên với `scripts/backup-db.mjs` — để xoay vòng chung một thư mục. */
export function backupFileName(date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `anser-auto-${stamp}.json`;
}

/**
 * File nào cần xoá để chỉ giữ `keep` bản mới nhất.
 *
 * CHỈ đụng tới file đúng mẫu tên do chính hệ thống đặt: bản người dùng tự chép vào thư mục
 * và đổi tên ("truoc-khi-don-kho.json") không bao giờ bị xoá tự động. Tên chứa thời điểm dạng
 * ISO nên sắp xếp theo chữ = sắp xếp theo thời gian.
 */
export function filesToPrune(files: string[], keep: number): string[] {
  const ours = files.filter((f) => FILE_PATTERN.test(f)).sort().reverse();
  return ours.slice(Math.max(1, keep));
}

export type BackupCheck = { ok: boolean; problems: string[] };

/**
 * Đọc lại bản sao vừa ghi có đủ đúng số dòng đã lấy từ DB không.
 *
 * Bắt được: ghi dở (đầy đĩa), file bị cắt, một bảng rỗng bất thường vì truy vấn lỗi bị nuốt.
 * Không thay được việc diễn tập khôi phục thật vào một DB trống — việc đó ghi trong
 * docs/VIEC_CAN_LAM.md.
 */
export function verifyBackup(expected: Record<string, number>, parsed: unknown): BackupCheck {
  const problems: string[] = [];
  const tables = (parsed as { tables?: Record<string, unknown[]> } | null)?.tables;
  if (!tables || typeof tables !== "object") return { ok: false, problems: ["File không có phần `tables`."] };
  for (const [table, count] of Object.entries(expected)) {
    const rows = tables[table];
    if (!Array.isArray(rows)) problems.push(`Thiếu bảng ${table}.`);
    else if (rows.length !== count) problems.push(`${table}: đọc lại ${rows.length} dòng, lúc lấy là ${count}.`);
  }
  return { ok: problems.length === 0, problems };
}

export type BackupState = {
  at: string;
  ok: boolean;
  source: "schedule" | "manual";
  file?: string;
  rows?: number;
  tables?: number;
  bytes?: number;
  error?: string;
  /** Có BACKUP_COPY_DIR: đã chép sang thư mục ngoài (và đọc lại khớp) chưa. */
  copied?: boolean;
  copyError?: string;
};

/** Lịch sao lưu mỗi ngày; nới 12 giờ cho máy tắt qua đêm rồi bắt kịp buổi sáng. */
export const BACKUP_MAX_AGE_MS = 36 * HOUR;

/**
 * Sự cố sao lưu cho bộ canh gác.
 *
 * - Lần gần nhất LỖI (kể cả đọc lại không khớp) -> báo ngay, kèm lỗi.
 * - Lần thành công gần nhất quá 36 giờ, khi sao lưu tự động đang bật -> lịch sao lưu đã chết.
 * - Chưa từng sao lưu -> không báo ở đây (việc cài đặt; trang Kiểm tra vận hành đã nhắc).
 */
export function backupIncidents(
  input: { configured: boolean; last: BackupState | null; lastOk: BackupState | null },
  now: Date,
): IncidentInput[] {
  const out: IncidentInput[] = [];
  if (input.last && !input.last.ok) {
    out.push({
      key: "watchdog:backup:failed",
      severity: "high",
      title: "Lần sao lưu gần nhất bị lỗi",
      body: `${input.last.error ?? "Không rõ lỗi"}. Kiểm tra dung lượng đĩa và quyền ghi của thư mục BACKUP_DIR; sự cố tự đóng khi lần sao lưu sau thành công.`,
      href: "/dashboard/readiness",
    });
  }
  if (input.last && input.last.ok && input.last.copied === false) {
    out.push({
      key: "watchdog:backup:copy-failed",
      severity: "high",
      title: "Không chép được bản sao lưu ra thư mục ngoài",
      body: `${input.last.copyError ?? "Không rõ lỗi"}. Bản sao vẫn có trên máy chủ nhưng mất máy là mất cả hai. Kiểm tra BACKUP_COPY_DIR (ổ đồng bộ Google Drive/OneDrive có đang gắn không).`,
      href: "/dashboard/readiness",
    });
  }
  if (input.configured && input.lastOk) {
    const age = now.getTime() - new Date(input.lastOk.at).getTime();
    if (age > BACKUP_MAX_AGE_MS) {
      out.push({
        key: "watchdog:backup:stale",
        severity: "high",
        title: "Sao lưu tự động đã ngừng chạy",
        body: `Bản sao lưu thành công gần nhất cách đây ${Math.floor(age / HOUR)} giờ. Lịch nội bộ (INTERNAL_SCHEDULER) có còn bật không?`,
        href: "/dashboard/readiness",
      });
    }
  }
  return out;
}
