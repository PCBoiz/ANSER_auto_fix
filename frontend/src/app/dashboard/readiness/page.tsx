import Link from "next/link";
import { PageHeader } from "@/components/ui/PageShell";
import { getReadinessReport, type ReadinessItem } from "@/server/readiness";
import { formatDateTime } from "@/lib/format";

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
