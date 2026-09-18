import Link from "next/link";
import { PageHeader } from "@/components/ui/PageShell";
import { getReadinessReport, type ReadinessItem } from "@/server/readiness";
import { formatDateTime } from "@/lib/format";
import { formatDuration } from "@/lib/opsLoop";
import { syncReadinessIncidents, WATCHDOG_TICK_KEY, type WatchdogTick } from "@/server/automation/watchdog";
import { getLoopStats, type LoopStats } from "@/server/store/notifications";
import { getSystemState } from "@/server/store/systemState";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<ReadinessItem["severity"], { label: string; box: string; dot: string }> = {
  blocker: {
    label: "Chặn go-live",
    box: "border-red-500/30 bg-red-500/[0.06]",
    dot: "bg-red-500",
  },
  warning: {
    label: "Nên xử lý sớm",
    box: "border-amber-500/30 bg-amber-500/[0.06]",
    dot: "bg-amber-400",
  },
  ok: { label: "Đạt", box: "border-emerald-500/30 bg-emerald-500/[0.06]", dot: "bg-emerald-400" },
};

// Server Component: đọc thẳng DB, không đi qua `/api/readiness`. Trang chỉ hiển thị một
// lần lúc tải nên gọi vòng qua HTTP chỉ thêm một chặng mạng cho cùng một dữ liệu.
export default async function ReadinessPage() {
  const report = await getReadinessReport();
  // KIỂM CHỨNG ngay lúc người dùng mở trang để xem mình sửa xong chưa: dùng luôn kết quả vừa
  // đo để đóng sự cố tương ứng trên chuông, không bắt đợi lượt canh gác kế tiếp (30 phút ở bản
  // tự host, tới một ngày trên Vercel Hobby). Lỗi ở bước này không được làm hỏng trang.
  await syncReadinessIncidents(report).catch((error) => console.error("[readiness] Không đồng bộ được sự cố:", error));
  const [stats, tick] = await Promise.all([
    getLoopStats().catch(() => null),
    getSystemState<WatchdogTick>(WATCHDOG_TICK_KEY).catch(() => null),
  ]);
  const groups = ["Bảo mật", "Dữ liệu", "Cấu hình", "Tự động hoá"] as const;

  return (
    <div>
      <PageHeader
        title="Kiểm tra sẵn sàng vận hành"
        subtitle={`Đo trực tiếp từ cơ sở dữ liệu lúc ${formatDateTime(report.checkedAt)} — không phải danh sách viết tay.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryTile
          value={report.blockers}
          label="Việc chặn go-live"
          hint="Phải xong trước khi giao cho nhân viên dùng thật"
          tone={report.blockers > 0 ? "red" : "emerald"}
        />
        <SummaryTile
          value={report.warnings}
          label="Việc nên làm sớm"
          hint="Dùng được, nhưng sẽ vướng khi chạy lâu dài"
          tone={report.warnings > 0 ? "amber" : "emerald"}
        />
        <SummaryTile
          value={report.items.length === 0 ? "✓" : report.items.length}
          label="Tổng số mục còn lại"
          hint={report.items.length === 0 ? "Hệ thống đã sạch" : "Danh sách bên dưới"}
          tone={report.items.length === 0 ? "emerald" : "zinc"}
        />
      </div>

      {stats && <LoopPanel stats={stats} tick={tick?.value ?? null} now={report.checkedAt} />}

      {report.items.length === 0 ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-6 py-16 text-center">
          <p className="text-lg font-bold text-emerald-300">Không còn mục nào tồn đọng</p>
          <p className="mt-2 text-sm text-zinc-400">
            Dữ liệu mẫu đã dọn, thông tin doanh nghiệp đã điền, tài khoản đã đổi mật khẩu và các quy
            tắc tự động đều đã chạy trong 48 giờ qua.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => {
            const groupItems = report.items.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <section key={group}>
                <h2 className="mb-3 text-sm font-bold tracking-wide text-zinc-400 uppercase">
                  {group}
                  <span className="ml-2 font-normal text-zinc-600">{groupItems.length} mục</span>
                </h2>
                <div className="flex flex-col gap-3">
                  {groupItems.map((item) => (
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Vòng lặp có khép thật không — đo bằng số, không bằng lời hứa trong tài liệu.
function LoopPanel({ stats, tick, now }: { stats: LoopStats; tick: WatchdogTick | null; now: Date }) {
  const verified = stats.resolved7d - stats.autoResolved7d;
  const silentMs = tick ? now.getTime() - new Date(tick.at).getTime() : null;
  return (
    <section className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wide text-zinc-400 uppercase">Vòng tự phát hiện – tự khép</h2>
        <p className="text-xs text-zinc-500">
          {tick && silentMs !== null
            ? `Bộ canh gác chạy lần cuối ${formatDuration(silentMs)} trước (${tick.source === "cron" ? "lịch nội bộ/cron" : tick.source})`
            : "Bộ canh gác chưa chạy theo lịch lần nào"}
        </p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <LoopStat value={stats.open} label="Sự cố đang mở" tone={stats.open > 0 ? "text-amber-400" : "text-emerald-400"} />
        <LoopStat value={verified} label="Đóng sau khi đo lại (7 ngày)" tone="text-white" />
        <LoopStat value={stats.autoResolved7d} label="Hệ thống tự sửa (7 ngày)" tone="text-white" />
        <LoopStat
          value={stats.medianHoursToResolve === null ? "—" : formatDuration(stats.medianHoursToResolve * 3600_000)}
          label="Thời gian khắc phục (trung vị)"
          tone="text-white"
        />
      </div>
      {!tick && (
        <p className="mt-4 text-xs text-zinc-500">
          Chưa có lịch nào gọi bộ canh gác, nên sự cố chỉ được đo lại khi có người mở trang này. Bản tự
          host: đặt <code className="rounded bg-black/40 px-1">INTERNAL_SCHEDULER=true</code> rồi khởi
          động lại. Trên Vercel: lịch trong <code className="rounded bg-black/40 px-1">vercel.json</code> tự chạy mỗi sáng.
        </p>
      )}
    </section>
  );
}

function LoopStat({ value, label, tone }: { value: number | string; label: string; tone: string }) {
  return (
    <div>
      <p className={`text-2xl font-extrabold ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function SummaryTile({
  value,
  label,
  hint,
  tone,
}: {
  value: number | string;
  label: string;
  hint: string;
  tone: "red" | "amber" | "emerald" | "zinc";
}) {
  const toneClass = {
    red: "text-red-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
    zinc: "text-white",
  }[tone];

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <p className={`text-3xl font-extrabold ${toneClass}`}>{value}</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function ItemCard({ item }: { item: ReadinessItem }) {
  const style = SEVERITY_STYLE[item.severity];
  return (
    <div className={`rounded-2xl border p-5 ${style.box}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
          <div>
            <h3 className="font-bold">{item.title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{item.detail}</p>
            <p className="mt-2 text-sm text-zinc-300">
              <span className="font-semibold text-zinc-500">Cách xử lý: </span>
              {item.fix}
            </p>
          </div>
        </div>
        {item.href && (
          <Link
            href={item.href}
            className="shrink-0 rounded-xl border border-white/[0.12] px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-white/[0.06]"
          >
            Mở trang xử lý
          </Link>
        )}
      </div>
    </div>
  );
}
