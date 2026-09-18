import { dueScheduledJobs } from "@/lib/opsLoop";
import { runCronJobs } from "@/server/automation/cron";
import { claimSlot } from "@/server/store/systemState";

// Bộ lập lịch TRONG TIẾN TRÌNH — cho bản tự host (Docker, máy chủ riêng), nơi không có Vercel
// Cron gọi vào `/api/cron/automation`.
//
// Trước đây bản tự host không có gì chạy theo lịch ngoài n8n: n8n tắt là bản tin sáng, chuông
// kiểm tra vận hành và mọi phát hiện sự cố cùng tắt theo — đúng lúc cần chúng nhất. Nay app tự
// chạy các việc của mình; n8n chỉ còn là kênh gửi email ra ngoài.
//
// Bật bằng `INTERNAL_SCHEDULER=true`. Để TẮT mặc định vì trên Vercel (serverless) tiến trình
// không sống liên tục — ở đó dùng `vercel.json`.
//
// Mỗi 5 phút hỏi "việc nào đến hạn" (hàm thuần, có test), rồi giành khe trong DB trước khi
// chạy: hai bản app cùng chạy, hay dev server nạp lại module, thì mỗi khe vẫn chạy đúng một lần.

const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 30 * 1000;

type SchedulerGlobal = typeof globalThis & { __anserScheduler?: ReturnType<typeof setInterval> };

async function tick() {
  for (const { job, slot } of dueScheduledJobs(new Date())) {
    try {
      if (!(await claimSlot(`scheduler:${job}`, slot))) continue;
      const [result] = await runCronJobs([job], "cron");
      console.log(`[scheduler] ${job} (${slot}): ${result.status} — ${result.summary}`);
    } catch (error) {
      // Không để một việc lỗi (DB chập chờn lúc giành khe) làm dừng cả vòng hẹn giờ.
      console.error(`[scheduler] ${job} lỗi:`, error);
    }
  }
}

export function startInternalScheduler() {
  const g = globalThis as SchedulerGlobal;
  if (g.__anserScheduler) return;

  g.__anserScheduler = setInterval(() => void tick(), TICK_MS);
  // Chạy lượt đầu sau 30 giây chứ không ngay lúc khởi động: để seed/migration xong trước, và
  // để lần khởi động lại liên tục (crash loop) không dồn một loạt lượt chạy.
  setTimeout(() => void tick(), FIRST_TICK_DELAY_MS);
  console.log("[scheduler] Lịch nội bộ đã bật: canh gác mỗi 30 phút, bản tin sáng 7h, tổng hợp kế toán 8h thứ Hai.");
}
