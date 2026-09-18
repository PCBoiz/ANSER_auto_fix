"use client";

import { useCallback, useEffect, useState } from "react";
import { TextField } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  GhostButton,
  PageHeader,
  PrimaryButton,
  formatDateTime,
} from "@/components/ui/PageShell";

const TYPE_LABELS: Record<string, string> = {
  low_stock_alert: "Cảnh báo phụ tùng sắp hết",
  maintenance_reminder: "Nhắc bảo dưỡng định kỳ",
  appointment_reminder: "Nhắc lịch hẹn",
  order_status_update: "Báo tiến độ sửa chữa",
  awaiting_acceptance_reminder: "Nhắc chờ nghiệm thu quá hạn",
  unpaid_invoice_report: "Báo cáo công nợ",
  revenue_report: "Báo cáo doanh thu định kỳ",
  morning_brief: "Bản tin sáng cho quản lý xưởng",
  accounting_digest: "Tổng hợp tuần cho kế toán",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  low_stock_alert: "Mỗi 6 giờ, gửi email cho từng chi nhánh danh sách phụ tùng đã chạm ngưỡng.",
  maintenance_reminder: "8h mỗi ngày, nhắc khách có xe tới hạn và gửi bản tổng hợp cho gara.",
  appointment_reminder: "17h mỗi ngày, nhắc khách có lịch hẹn trong 24 giờ tới.",
  order_status_update: "Gửi ngay khi lệnh chuyển sang Đã báo giá / Chờ nghiệm thu / Đã giao xe.",
  awaiting_acceptance_reminder:
    "9h mỗi ngày, nhắc khách có xe chờ nghiệm thu quá hạn và gửi bản tổng hợp cho gara.",
  unpaid_invoice_report:
    "9h mỗi ngày, gửi quản lý danh sách hoá đơn chưa thu đủ quá hạn — không gửi khách.",
  revenue_report: "20h mỗi ngày, gửi báo cáo doanh thu về email doanh nghiệp.",
  morning_brief:
    "7h mỗi ngày, MỘT bản tin gộp xe quá hẹn trả, xe chờ nghiệm thu, đặt hàng ngoài về trễ, lịch hẹn, phụ tùng sắp hết và công nợ. Lên chuông thông báo ngay cả khi n8n không chạy.",
  accounting_digest:
    "8h thứ Hai, gửi kế toán: hoá đơn mua hàng chưa nhận theo nhà cung cấp, hàng đã giao chưa lập hoá đơn, và khách bị ghi nhiều tên. Lên chuông thông báo ngay cả khi n8n không chạy.",
};

type SyncAction = "created" | "updated" | "unchanged" | "drift-skipped" | "error";
type SyncResult = {
  smtpCredentialFound: boolean;
  items: Array<{ file: string; name: string; action: SyncAction; active: boolean | null; detail?: string }>;
};

const SYNC_LABELS: Record<SyncAction, string> = {
  created: "Vừa tạo",
  updated: "Đã cập nhật theo mẫu",
  unchanged: "Khớp mẫu",
  "drift-skipped": "Lệch mẫu",
  error: "Lỗi",
};
const SYNC_TONES: Record<SyncAction, "emerald" | "sky" | "zinc" | "orange" | "red"> = {
  created: "emerald",
  updated: "sky",
  unchanged: "zinc",
  "drift-skipped": "orange",
  error: "red",
};

// Quy tắc có bộ lập lịch NỘI BỘ (chạy trong app, không cần n8n) — có nút "Chạy ngay".
const IN_APP_JOBS = new Set(["morning_brief", "accounting_digest"]);

const SOURCE_LABELS: Record<string, string> = {
  schedule: "n8n theo lịch",
  n8n: "n8n",
  cron: "lịch nội bộ của app",
  manual: "chạy tay",
};

const STATUS_TONES: Record<string, "emerald" | "sky" | "red" | "zinc"> = {
  ok: "emerald",
  fetched: "sky",
  error: "red",
  skipped: "zinc",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "đã gửi xong",
  fetched: "đã lấy dữ liệu",
  error: "lỗi",
  skipped: "bỏ qua",
};

// Tên file JSON trong public/n8n-templates/ — sinh tự động từ n8n-workflows/ (xem
// scripts/sync-n8n-templates.mjs), khớp 1-1 với AutomationRuleType.
const TEMPLATE_FILES: Record<string, string> = {
  low_stock_alert: "low_stock_alert.json",
  maintenance_reminder: "maintenance_reminder.json",
  appointment_reminder: "appointment_reminder.json",
  order_status_update: "order_status_update.json",
  awaiting_acceptance_reminder: "awaiting_acceptance_reminder.json",
  unpaid_invoice_report: "unpaid_invoice_report.json",
  revenue_report: "revenue_report.json",
  morning_brief: "morning_brief.json",
  accounting_digest: "accounting_digest.json",
};

type Rule = {
  id: string;
  name: string;
  type: string;
  branchName: string | null;
  thresholdQty: number | null;
  thresholdDays: number | null;
  thresholdKm: number | null;
  enabled: boolean;
  n8nWorkflowId: string | null;
  expectedWorkflowName: string | null;
  matchedWorkflowId: string | null;
  n8nActive: boolean | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  lastRunSource: string | null;
};

// Quá 48 giờ không có nhịp từ nguồn LỊCH thì coi là lịch đã chết. Lần chạy tay không tính —
// nó chứng minh code chạy được, không chứng minh lịch có tự nổ.
const STALE_MS = 48 * 60 * 60 * 1000;

function runHealth(rule: Rule): { tone: "emerald" | "orange" | "red" | "zinc"; text: string } {
  if (!rule.enabled) return { tone: "zinc", text: "Đang tắt" };
  if (!rule.lastRunAt) return { tone: "red", text: "Chưa từng chạy" };
  const scheduled = rule.lastRunSource !== "manual";
  const age = Date.now() - new Date(rule.lastRunAt).getTime();
  if (!scheduled) return { tone: "orange", text: "Mới chỉ chạy tay — chưa có lần tự chạy" };
  if (rule.lastRunStatus === "error") return { tone: "red", text: "Lần chạy gần nhất bị lỗi" };
  if (age > STALE_MS) return { tone: "orange", text: "Quá 48 giờ không chạy" };
  return { tone: "emerald", text: "Đang tự chạy" };
}

type Execution = {
  id: string | number;
  status: string;
  startedAt?: string;
  stoppedAt?: string | null;
};

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [n8nConfigured, setN8nConfigured] = useState(false);
  const [n8nError, setN8nError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<Rule | null>(null);
  const [thresholds, setThresholds] = useState({ qty: "", days: "", km: "" });

  const [history, setHistory] = useState<{ rule: Rule; rows: Execution[] } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [template, setTemplate] = useState<{ rule: Rule; file: string; content: string } | null>(
    null,
  );
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/rules");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được quy tắc.");
      setRules(data.rules);
      setN8nConfigured(data.n8nConfigured);
      setN8nError(data.n8nError);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/automation/rules")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) {
          setRules(data.rules);
          setN8nConfigured(data.n8nConfigured);
          setN8nError(data.n8nError);
        } else setError(data?.message ?? "Không tải được quy tắc.");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Không tải được quy tắc.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(rule: Rule) {
    setBusy(true);
    try {
      const res = await fetch(`/api/automation/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không đổi được trạng thái.");
      setNotice(data?.warning ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow(rule: Rule) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: rule.type }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.result?.summary ?? data?.message ?? "Chạy không thành công.");
      setNotice(`${rule.name}: ${data.result.summary}. Xem chuông thông báo ở góc trên.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setBusy(false);
    }
  }

  // Phần "người quyết" của vòng lặp: bộ canh gác tự tạo workflow thiếu và tắt theo app, còn
  // đè bản chỉnh tay và BẬT workflow gửi email (có cái gửi thẳng cho khách) thì chờ ở đây.
  async function syncN8n() {
    const ok = window.confirm(
      "Đồng bộ sẽ đưa mọi workflow về đúng bản mẫu (đè chỉnh sửa tay trong n8n) và BẬT workflow của mọi quy tắc đang bật — kể cả nhắc lịch hẹn, nhắc bảo dưỡng gửi thẳng cho khách. Tiếp tục?",
    );
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/automation/n8n-sync", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok && !data?.report) throw new Error(data?.message ?? "Đồng bộ không thành công.");
      setSyncResult(data.report);
      setNotice(`Đồng bộ xong. Vòng kiểm tra: ${data.loop.summary}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setBusy(false);
    }
  }

  async function saveThresholds() {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/automation/rules/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Gửi chuỗi rỗng thành null (xoá ngưỡng), còn "0" giữ nguyên là 0 — server phân
        // biệt hai trường hợp này (xem optionalNonNegativeInt).
        body: JSON.stringify({
          thresholdQty: thresholds.qty === "" ? null : Number(thresholds.qty),
          thresholdDays: thresholds.days === "" ? null : Number(thresholds.days),
          thresholdKm: thresholds.km === "" ? null : Number(thresholds.km),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Không lưu được.");
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(rule: Rule) {
    setHistoryError(null);
    const res = await fetch(`/api/automation/rules/${rule.id}/executions`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setHistory({ rule, rows: [] });
      setHistoryError(data?.message ?? "Không lấy được lịch sử.");
      return;
    }
    setHistory({ rule, rows: data.executions });
  }

  async function openTemplate(rule: Rule) {
    const file = TEMPLATE_FILES[rule.type];
    if (!file) return;
    setCopied(false);
    setTemplateError(null);
    setTemplateLoading(true);
    setTemplate({ rule, file, content: "" });
    try {
      // File tĩnh sinh sẵn ở public/n8n-templates/ (xem scripts/sync-n8n-templates.mjs) —
      // không phải API route, nên không cần đăng nhập lại và luôn khớp file thật trong repo.
      const res = await fetch(`/n8n-templates/${file}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Không tìm thấy file mẫu.");
      const text = await res.text();
      setTemplate({ rule, file, content: text });
    } catch (err) {
      setTemplateError(
        err instanceof Error
          ? `${err.message} Chạy "npm run sync:n8n-templates" rồi thử lại.`
          : "Không tải được file mẫu.",
      );
    } finally {
      setTemplateLoading(false);
    }
  }

  async function copyTemplate() {
    if (!template?.content) return;
    try {
      await navigator.clipboard.writeText(template.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setTemplateError("Trình duyệt chặn sao chép — hãy dùng nút Tải xuống thay thế.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Tự động hoá"
        subtitle="Bật/tắt và ngưỡng ở đây là công tắc thật: mọi workflow đều đọc lại từ app trước khi gửi."
      />

      <ErrorBanner message={error} />

      {notice && (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          {notice}
        </div>
      )}

      {!n8nConfigured && (
        <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
          <b>Chưa kết nối n8n</b> nên chưa gửi được email nào. Tắt quy tắc ở đây vẫn có tác dụng
          (workflow đọc lại cờ trong app trước khi gửi), và <b>bản tin sáng / tổng hợp kế toán</b>{" "}
          vẫn lên chuông thông báo nhờ lịch nội bộ. Để gửi email: chạy{" "}
          <code className="rounded bg-black/40 px-1">docker compose up -d</code>, tạo API key
          trong n8n UI (Settings → n8n API) rồi dán vào <code className="rounded bg-black/40 px-1">N8N_API_KEY</code>.
        </div>
      )}

      {n8nError && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Đã cấu hình n8n nhưng không gọi được: {n8nError}
        </div>
      )}

      {n8nConfigured && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Đồng bộ workflow lên n8n</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Mỗi 30 phút bộ canh gác tự tạo workflow còn thiếu và tắt workflow mà app đã tắt —
                không cần import tay. Nút này làm nốt phần cần người quyết: đưa workflow đã chỉnh
                tay về bản mẫu, và <b>bật</b> workflow của các quy tắc đang bật.
              </p>
            </div>
            <PrimaryButton type="button" onClick={syncN8n} disabled={busy}>
              Đồng bộ workflow
            </PrimaryButton>
          </div>
          {syncResult && (
            <ul className="mt-3 divide-y divide-white/[0.04] rounded-xl bg-black/20 text-xs">
              {!syncResult.smtpCredentialFound && (
                <li className="px-3 py-2 text-orange-300">
                  n8n chưa có credential SMTP — workflow đã tạo nhưng node Gửi Email sẽ lỗi.
                </li>
              )}
              {syncResult.items.map((item) => (
                <li key={item.file} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-zinc-300">{item.name.replace(/^ANSER Auto — /, "")}</span>
                  <Badge tone={SYNC_TONES[item.action]}>{SYNC_LABELS[item.action]}</Badge>
                  {item.active !== null && (
                    <Badge tone={item.active ? "emerald" : "zinc"}>{item.active ? "Đang chạy" : "Đang tắt"}</Badge>
                  )}
                  {item.detail && <span className="w-full text-zinc-500">{item.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {loading ? (
        <EmptyState title="Đang tải..." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rules.map((rule) => {
            const linked = Boolean(rule.matchedWorkflowId);
            const health = runHealth(rule);
            return (
              <Card key={rule.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold">{rule.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {TYPE_DESCRIPTIONS[rule.type] ?? TYPE_LABELS[rule.type] ?? rule.type}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(rule)}
                    disabled={busy}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                      rule.enabled ? "bg-emerald-500" : "bg-zinc-700"
                    }`}
                    aria-label={rule.enabled ? "Tắt" : "Bật"}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        rule.enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {rule.thresholdQty !== null && (
                    <Badge tone="zinc">Ngưỡng tồn: {rule.thresholdQty}</Badge>
                  )}
                  {rule.thresholdDays !== null && (
                    <Badge tone="zinc">Trước {rule.thresholdDays} ngày</Badge>
                  )}
                  {rule.thresholdKm !== null && (
                    <Badge tone="zinc">Trước {rule.thresholdKm} km</Badge>
                  )}
                  {rule.branchName && <Badge tone="violet">{rule.branchName}</Badge>}
                </div>

                {/* Bằng chứng chạy thật — ghi bởi chính endpoint mà workflow/lịch gọi vào.
                    Trả lời câu hỏi "có tự chạy đúng lịch không" mà không phải mở n8n. */}
                <div className="mt-4 rounded-xl bg-black/20 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={health.tone}>{health.text}</Badge>
                    {rule.lastRunStatus && (
                      <Badge tone={STATUS_TONES[rule.lastRunStatus] ?? "zinc"}>
                        {STATUS_LABELS[rule.lastRunStatus] ?? rule.lastRunStatus}
                      </Badge>
                    )}
                  </div>
                  {rule.lastRunAt ? (
                    <p className="mt-1.5 text-xs text-zinc-400">
                      {formatDateTime(rule.lastRunAt)} · {SOURCE_LABELS[rule.lastRunSource ?? ""] ?? "không rõ nguồn"}
                      {rule.lastRunSummary && <span className="block text-zinc-500">{rule.lastRunSummary}</span>}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-zinc-500">Chưa có nhịp chạy nào được ghi nhận.</p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-3">
                  {!n8nConfigured ? (
                    <Badge tone="orange">Chưa kết nối n8n</Badge>
                  ) : n8nError ? (
                    // Không hỏi được n8n thì KHÔNG kết luận "chưa import" — bắt được khi thử
                    // với Docker đang tắt: 9 quy tắc đều bị gắn nhãn đỏ dù 3 workflow đã
                    // import từ tháng 8.
                    <Badge tone="orange">n8n không phản hồi</Badge>
                  ) : linked ? (
                    <Badge tone={rule.n8nActive ? "emerald" : "zinc"}>
                      n8n: {rule.n8nActive ? "đang chạy" : "đang dừng"}
                    </Badge>
                  ) : (
                    <Badge tone="red">Chưa import workflow</Badge>
                  )}

                  <div className="ml-auto flex flex-wrap gap-1">
                    {IN_APP_JOBS.has(rule.type) && (
                      <button
                        onClick={() => runNow(rule)}
                        disabled={busy}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-sky-400 hover:bg-sky-500/10 disabled:opacity-50"
                      >
                        Chạy ngay
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditing(rule);
                        setThresholds({
                          qty: rule.thresholdQty?.toString() ?? "",
                          days: rule.thresholdDays?.toString() ?? "",
                          km: rule.thresholdKm?.toString() ?? "",
                        });
                      }}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                    >
                      Ngưỡng
                    </button>
                    <button
                      onClick={() => openHistory(rule)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                    >
                      Lịch sử chạy
                    </button>
                    <button
                      onClick={() => openTemplate(rule)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                    >
                      Xem mẫu n8n
                    </button>
                  </div>
                </div>

                {!linked && !n8nError && n8nConfigured && rule.expectedWorkflowName && (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Chưa có workflow &ldquo;{rule.expectedWorkflowName}&rdquo; trong n8n — bộ canh
                    gác sẽ tự tạo ở lượt tới, hoặc bấm &ldquo;Đồng bộ workflow&rdquo; ở trên để tạo
                    ngay.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal
          title={`Ngưỡng — ${editing.name}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setEditing(null)}>
                Huỷ
              </GhostButton>
              <GhostButton onClick={saveThresholds} disabled={busy}>
                Lưu
              </GhostButton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {editing.type === "low_stock_alert" && (
              <TextField
                label="Ngưỡng tồn kho chung"
                type="number"
                hint="phụ tùng có ngưỡng riêng sẽ dùng ngưỡng riêng"
                value={thresholds.qty}
                onChange={(e) => setThresholds((p) => ({ ...p, qty: e.target.value }))}
              />
            )}
            {(editing.type === "maintenance_reminder" || editing.type === "appointment_reminder") && (
              <TextField
                label="Báo trước (ngày)"
                type="number"
                value={thresholds.days}
                onChange={(e) => setThresholds((p) => ({ ...p, days: e.target.value }))}
              />
            )}
            {editing.type === "morning_brief" && (
              <>
                <TextField
                  label="Xe chờ nghiệm thu quá (ngày)"
                  type="number"
                  min={0}
                  value={thresholds.days}
                  onChange={(e) => setThresholds((p) => ({ ...p, days: e.target.value }))}
                />
                <TextField
                  label="Liệt kê tối đa bao nhiêu phụ tùng sắp hết"
                  type="number"
                  min={0}
                  hint="phần còn lại chỉ đếm tổng"
                  value={thresholds.qty}
                  onChange={(e) => setThresholds((p) => ({ ...p, qty: e.target.value }))}
                />
              </>
            )}
            {editing.type === "accounting_digest" && (
              <TextField
                label="Hoá đơn mua hàng chưa nhận quá (ngày)"
                type="number"
                min={0}
                value={thresholds.days}
                onChange={(e) => setThresholds((p) => ({ ...p, days: e.target.value }))}
              />
            )}
            {(editing.type === "awaiting_acceptance_reminder" ||
              editing.type === "unpaid_invoice_report") && (
              <TextField
                label="Quá hạn (ngày)"
                type="number"
                hint={
                  editing.type === "awaiting_acceptance_reminder"
                    ? "chờ nghiệm thu quá số ngày này thì nhắc lại"
                    : "hoá đơn phát hành quá số ngày này mà chưa thu đủ thì báo"
                }
                value={thresholds.days}
                onChange={(e) => setThresholds((p) => ({ ...p, days: e.target.value }))}
              />
            )}
            {editing.type === "maintenance_reminder" && (
              <TextField
                label="Báo trước (km)"
                type="number"
                value={thresholds.km}
                onChange={(e) => setThresholds((p) => ({ ...p, km: e.target.value }))}
              />
            )}

            <p className="rounded-xl bg-sky-500/10 px-4 py-3 text-xs text-sky-200">
              Workflow đọc ngưỡng này từ app mỗi lần chạy — lưu xong là lần chạy kế tiếp dùng số
              mới, không cần sửa hay import lại gì bên n8n.
              {editing.type === "low_stock_alert" && (
                <>
                  {" "}
                  Muốn một phụ tùng <b>không bao giờ</b> cảnh báo (vật tư đặt theo xe), đặt ngưỡng
                  riêng của nó bằng 0 ở Kho phụ tùng → Nhập giá hàng loạt.
                </>
              )}
            </p>
          </div>
        </Modal>
      )}

      {template && (
        <Modal
          title={`Mẫu n8n — ${template.rule.name}`}
          onClose={() => setTemplate(null)}
          wide
          footer={
            <>
              <GhostButton type="button" onClick={() => setTemplate(null)}>
                Đóng
              </GhostButton>
              <GhostButton type="button" onClick={copyTemplate} disabled={!template.content}>
                {copied ? "Đã sao chép ✓" : "Sao chép"}
              </GhostButton>
              <a
                href={`/n8n-templates/${template.file}`}
                download={template.file}
                className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black transition-transform hover:-translate-y-0.5"
              >
                Tải xuống (.json)
              </a>
            </>
          }
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Import vào n8n: <b>Workflows → Import from File</b>. Sau đó gán credential SMTP
              cho node Gửi Email, thay token nội bộ trong các node HTTP Request, rồi bật{" "}
              <b>Active</b>. Chi tiết ở{" "}
              <code className="rounded bg-black/40 px-1">n8n-workflows/README.md</code>.
            </p>
            <Badge tone="zinc">{template.file}</Badge>
          </div>
          {templateLoading ? (
            <EmptyState title="Đang tải..." />
          ) : templateError ? (
            <ErrorBanner message={templateError} />
          ) : (
            <pre className="max-h-[50vh] overflow-auto rounded-xl bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-zinc-300">
              {template.content}
            </pre>
          )}
        </Modal>
      )}

      {history && (
        <Modal
          title={`Lịch sử chạy — ${history.rule.name}`}
          onClose={() => setHistory(null)}
          wide
        >
          {historyError ? (
            <p className="rounded-xl bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
              {historyError}
            </p>
          ) : history.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              Workflow chưa chạy lần nào.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Bắt đầu</th>
                  <th className="py-2 pr-4 font-semibold">Kết thúc</th>
                  <th className="py-2 font-semibold">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((e) => (
                  <tr key={String(e.id)} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2 pr-4 text-zinc-400">{formatDateTime(e.startedAt)}</td>
                    <td className="py-2 pr-4 text-zinc-400">{formatDateTime(e.stoppedAt)}</td>
                    <td className="py-2">
                      <Badge tone={e.status === "success" ? "emerald" : e.status === "running" ? "sky" : "red"}>
                        {e.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}
