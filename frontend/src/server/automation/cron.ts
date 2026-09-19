import { eq } from "drizzle-orm";
import { buildAccountingDigest, buildMorningBrief, buildOwnerWeekly, type Digest } from "@/server/automation/digests";
import { recordRuleRun, type RunSource } from "@/server/automation/rules";
import { db } from "@/server/db/client";
import { automationRules } from "@/server/db/schema";
import type { AutomationRuleType } from "@/server/domain";
import { runWatchdog, syncReadinessIncidents } from "@/server/automation/watchdog";
import { runBackup } from "@/server/backup";
import { getReadinessReport } from "@/server/readiness";
import {
  createNotifications,
  pruneNotifications,
  supersedeDatedNotifications,
  type NotificationInput,
} from "@/server/store/notifications";
import { getCompanySettings } from "@/server/store/settings";

// Bộ lập lịch NỘI BỘ — chạy trong chính app, không cần n8n/Docker/SMTP.
//
// Nó không gửi email. Nó biến cùng dữ liệu của bản tin thành thông báo trên chuông trong
// app. Chia vai như vậy là cố ý:
//   - n8n: kênh gửi RA NGOÀI (email cho khách, cho quản lý). Hỏng thì mất email.
//   - cron nội bộ: kênh TRONG app. Chỉ hỏng khi chính app hỏng — mà khi đó người dùng
//     cũng biết ngay.
// Hôm 17/09/2026 Docker không chạy, nghĩa là không cảnh báo nào tới được ai. Với cron nội
// bộ, ít nhất người mở app vẫn thấy việc cần làm.

export const CRON_JOBS = [
  "morning_brief",
  "accounting_digest",
  "owner_weekly_report",
  "readiness",
  "watchdog",
  "backup",
] as const;
export type CronJob = (typeof CRON_JOBS)[number];

export type CronJobResult = {
  job: CronJob;
  status: "ok" | "skipped" | "error";
  created: number;
  summary: string;
};

/** Ngày theo giờ gara, dạng yyyy-mm-dd — khoá chống trùng thông báo trong ngày. */
function garageDay(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

async function loadRule(type: AutomationRuleType) {
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.type, type)).limit(1);
  // Cùng quy ước với endpoint n8n: không có dòng cấu hình thì coi là bật.
  return { rule, enabled: rule ? rule.enabled : true };
}

function digestToNotifications(
  digest: Digest,
  audience: NotificationInput["audience"],
): NotificationInput[] {
  const day = garageDay(digest.generatedAt);
  // Mỗi MỤC của bản tin thành một thông báo riêng (không gộp cả bản tin thành một dòng):
  // chuông cần trỏ thẳng tới đúng trang xử lý, và "3 xe quá hẹn trả" với "724 phụ tùng sắp
  // hết" dẫn tới hai trang khác nhau.
  return digest.sections
    .filter((section) => section.count > 0 && section.key !== "week_totals")
    .map((section) => ({
      kind: digest.kind,
      severity: section.priority,
      audience,
      title: `${section.title} (${section.count})`,
      body: section.headline,
      href: section.href ?? null,
      dedupeKey: `${digest.kind}:${section.key}:${day}`,
    }));
}

/**
 * Đưa bản tin lên chuông, và gỡ các mục của bản tin CŨ hơn (resolution = "superseded").
 *
 * Không gỡ thì chuông giữ song song "Phụ tùng sắp hết (724)" của hôm qua, hôm kia, hôm kìa —
 * con số cũ nằm cạnh con số mới, và mục nào hôm nay đã về 0 (việc đã xong) vẫn còn treo từ
 * hôm qua như chưa ai làm gì.
 */
async function publishDigest(digest: Digest, audience: NotificationInput["audience"]) {
  const inputs = digestToNotifications(digest, audience);
  const created = await createNotifications(inputs);
  await supersedeDatedNotifications(
    digest.kind,
    inputs.map((i) => i.dedupeKey),
  );
  return created;
}

async function runMorningBrief(source: RunSource): Promise<CronJobResult> {
  const [company, { rule, enabled }] = await Promise.all([getCompanySettings(), loadRule("morning_brief")]);
  if (!enabled) {
    return { job: "morning_brief", status: "skipped", created: 0, summary: "Quy tắc đang tắt" };
  }
  const digest = await buildMorningBrief({
    companyName: company.name,
    awaitingDays: rule?.thresholdDays ?? 2,
    lowStockLimit: rule?.thresholdQty ?? 10,
    lowStockFallback: 5,
  });
  const created = await publishDigest(digest, "manager");
  const summary = `${digest.subject} — tạo ${created} thông báo mới`;
  await recordRuleRun("morning_brief", { status: "ok", summary, source });
  return { job: "morning_brief", status: "ok", created, summary };
}

async function runAccountingDigest(source: RunSource): Promise<CronJobResult> {
  const [company, { rule, enabled }] = await Promise.all([getCompanySettings(), loadRule("accounting_digest")]);
  if (!enabled) {
    return { job: "accounting_digest", status: "skipped", created: 0, summary: "Quy tắc đang tắt" };
  }
  const digest = await buildAccountingDigest({
    companyName: company.name,
    pendingInvoiceDays: rule?.thresholdDays ?? 15,
  });
  const created = await publishDigest(digest, "accountant");
  const summary = `${digest.subject} — tạo ${created} thông báo mới`;
  await recordRuleRun("accounting_digest", { status: "ok", summary, source });
  return { job: "accounting_digest", status: "ok", created, summary };
}

// Việc chặn go-live cũng lên chuông, nhưng CHỈ loại "blocker" — cảnh báo mức thường đã có
// trang Kiểm tra vận hành, đẩy cả chúng lên chuông mỗi ngày là tiếng ồn. Mỗi việc là MỘT sự
// cố, tự đóng khi đo lại không còn — xem `syncReadinessIncidents`.
async function runReadiness(): Promise<CronJobResult> {
  const report = await getReadinessReport();
  const r = await syncReadinessIncidents(report);
  return {
    job: "readiness",
    status: "ok",
    created: r.opened,
    summary: `${report.blockers} việc chặn go-live, ${report.warnings} cảnh báo — mở ${r.opened}, đóng ${r.resolved}`,
  };
}

// Báo cáo tuần: MỘT thông báo trên chuông (không tách từng mục như bản tin sáng) — đây là
// bản tổng kết để đọc, không phải danh sách việc. Chi tiết nằm trong email.
async function runOwnerWeekly(source: RunSource): Promise<CronJobResult> {
  const [company, { enabled }] = await Promise.all([getCompanySettings(), loadRule("owner_weekly_report")]);
  if (!enabled) {
    return { job: "owner_weekly_report", status: "skipped", created: 0, summary: "Quy tắc đang tắt" };
  }
  const digest = await buildOwnerWeekly({ companyName: company.name });
  const key = `owner_weekly:${garageDay(digest.generatedAt)}`;
  const activity = digest.sections.find((s) => s.key === "activity");
  const created = await createNotifications([
    {
      kind: "owner_weekly",
      severity: "normal",
      audience: "manager",
      title: digest.subject,
      body: digest.sections.map((s) => s.headline).join(" "),
      href: activity?.href ?? "/dashboard/reports",
      dedupeKey: key,
    },
  ]);
  await supersedeDatedNotifications("owner_weekly", [key]);
  const summary = `${digest.subject} — tạo ${created} thông báo mới`;
  await recordRuleRun("owner_weekly_report", { status: "ok", summary, source });
  return { job: "owner_weekly_report", status: "ok", created, summary };
}

async function runWatchdogJob(source: RunSource): Promise<CronJobResult> {
  const r = await runWatchdog(source);
  return { job: "watchdog", status: r.status, created: r.opened, summary: r.summary };
}

/**
 * Chạy một hoặc nhiều việc. Mỗi việc chạy độc lập: bản tin kế toán lỗi không được làm mất
 * bản tin sáng của quản lý xưởng.
 */
export async function runCronJobs(jobs: CronJob[], source: RunSource = "cron"): Promise<CronJobResult[]> {
  const results: CronJobResult[] = [];
  for (const job of jobs) {
    try {
      if (job === "morning_brief") results.push(await runMorningBrief(source));
      else if (job === "accounting_digest") results.push(await runAccountingDigest(source));
      else if (job === "owner_weekly_report") results.push(await runOwnerWeekly(source));
      else if (job === "readiness") results.push(await runReadiness());
      else if (job === "watchdog") results.push(await runWatchdogJob(source));
      else if (job === "backup") {
        const r = await runBackup(source === "manual" ? "manual" : "schedule");
        results.push({ job: "backup", status: r.status, created: 0, summary: r.summary });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron] Việc "${job}" lỗi:`, error);
      if (job === "morning_brief" || job === "accounting_digest" || job === "owner_weekly_report") {
        await recordRuleRun(job, { status: "error", summary: message, source });
      }
      results.push({ job, status: "error", created: 0, summary: message });
    }
  }

  // Dọn thông báo cũ ở cuối mỗi lượt — không cần một lịch riêng chỉ để xoá.
  await pruneNotifications(30).catch((error) => console.error("[cron] Không dọn được thông báo cũ:", error));
  return results;
}
