// Logic THUẦN của vòng lặp vận hành — không import db, có test (`__tests__/opsLoop.test.ts`).
//
// Vòng lặp: PHÁT HIỆN -> CẢNH BÁO -> SỬA (tự động nếu an toàn, người nếu cần phán đoán)
// -> KIỂM CHỨNG -> ĐÓNG -> quay lại PHÁT HIỆN. Hai câu hỏi thuần nhất của vòng lặp nằm ở đây:
//   1. Với danh sách sự cố vừa đo được và danh sách đang mở, cái nào mở mới, cái nào vẫn
//      còn, cái nào đã hết (tự khép)?
//   2. Một quy tắc tự động im lặng bao lâu thì coi là lịch của nó đã chết?

export type IncidentInput = {
  /** Khoá ổn định, KHÔNG kèm ngày: một sự cố = một bản ghi dù kéo dài bao lâu. */
  key: string;
  severity: "high" | "normal";
  title: string;
  body: string | null;
  href: string | null;
};

export type IncidentPlan = {
  /** Có trong lần đo này — tạo mới hoặc cập nhật `lastSeenAt` (và mở lại nếu đã đóng). */
  upsert: IncidentInput[];
  /** Đang mở nhưng lần đo này không còn thấy -> đóng. */
  resolveKeys: string[];
};

/**
 * Đối soát. `openKeys` là khoá các sự cố CÙNG LOẠI đang mở trong DB.
 *
 * Một sự cố xuất hiện hai lần trong `current` (hai bộ kiểm tra cùng báo) chỉ giữ bản đầu —
 * khoá trùng mà chèn hai lần sẽ nổ ràng buộc unique giữa chừng và bỏ dở cả lượt.
 */
export function planIncidents(openKeys: string[], current: IncidentInput[]): IncidentPlan {
  const seen = new Set<string>();
  const upsert: IncidentInput[] = [];
  for (const incident of current) {
    if (seen.has(incident.key)) continue;
    seen.add(incident.key);
    upsert.push(incident);
  }
  const resolveKeys = openKeys.filter((key) => !seen.has(key));
  return { upsert, resolveKeys };
}

// ---------------------------------------------------------------------------
// Nhịp kỳ vọng của từng quy tắc
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;

/**
 * Im lặng tối đa trước khi coi là lịch đã chết = chu kỳ + một khoảng nới.
 *
 * Khớp lịch trong `n8n-workflows/*.json` và `vercel.json`. Nới 2 giờ cho lịch 6 giờ và 2 giờ
 * cho lịch ngày: n8n khởi động lại, Neon ngủ đông, máy chủ chậm — trễ vài chục phút là bình
 * thường, báo động ngay phút thứ 61 chỉ dạy người nhận tắt chuông.
 *
 * `null` = không có lịch (chạy theo sự kiện), không canh được bằng thời gian.
 */
export const EXPECTED_MAX_SILENCE_MS: Record<string, number | null> = {
  low_stock_alert: 8 * HOUR, // mỗi 6 giờ
  maintenance_reminder: 26 * HOUR, // 8h hằng ngày
  appointment_reminder: 26 * HOUR, // 17h hằng ngày
  awaiting_acceptance_reminder: 26 * HOUR, // 9h hằng ngày
  unpaid_invoice_report: 26 * HOUR, // 9h hằng ngày
  revenue_report: 26 * HOUR, // 20h hằng ngày
  morning_brief: 26 * HOUR, // 7h hằng ngày
  accounting_digest: 8 * 24 * HOUR, // 8h thứ Hai
  order_status_update: null, // gửi khi lệnh đổi trạng thái — không có lịch
};

export type RuleRunState = {
  type: string;
  name: string;
  enabled: boolean;
  lastScheduledRunAt: Date | null;
};

/**
 * Quy tắc nào đã từng chạy theo lịch nhưng nay im lặng quá nhịp kỳ vọng.
 *
 * CHỈ báo quy tắc ĐÃ TỪNG chạy theo lịch: "chưa từng chạy" là việc cài đặt (trang Kiểm tra
 * vận hành đã báo), còn đây là HỒI QUY — thứ trước chạy, nay ngừng. Trộn hai thứ vào một
 * sẽ làm chuông kêu cả tuần trong lúc gara còn đang cài n8n.
 */
export function findSilentRules(rules: RuleRunState[], now: Date): IncidentInput[] {
  const out: IncidentInput[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.lastScheduledRunAt) continue;
    const maxSilence = EXPECTED_MAX_SILENCE_MS[rule.type];
    if (!maxSilence) continue;

    const silentMs = now.getTime() - rule.lastScheduledRunAt.getTime();
    if (silentMs <= maxSilence) continue;

    const hours = Math.floor(silentMs / HOUR);
    out.push({
      key: `watchdog:rule:${rule.type}`,
      severity: "high",
      title: `"${rule.name}" đã ngừng chạy theo lịch`,
      body: `Lần chạy theo lịch gần nhất cách đây ${hours >= 48 ? `${Math.floor(hours / 24)} ngày` : `${hours} giờ`}. Thường là n8n đang tắt hoặc workflow bị tắt. Hệ thống sẽ tự thử đồng bộ lại workflow; thông báo này tự đóng khi lịch chạy lại.`,
      href: "/dashboard/automation",
    });
  }
  return out;
}

/** Thời gian từ lúc mở tới lúc đóng, dạng người đọc được — cho dòng "đã khắc phục sau …". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

// ---------------------------------------------------------------------------
// Lịch nội bộ — việc nào đến hạn
// ---------------------------------------------------------------------------

export type ScheduledJob = "watchdog" | "morning_brief" | "accounting_digest";

// Việt Nam không có giờ mùa hè — cộng cứng 7 giờ là đúng quanh năm, và giữ hàm này thuần
// (không phụ thuộc múi giờ của máy chủ, vốn là UTC trên Vercel/Docker).
const GARAGE_UTC_OFFSET_MS = 7 * HOUR;
export const WATCHDOG_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Việc nào đến hạn lúc `now`, kèm "khe" (slot) của nó.
 *
 * Trả về khe chứ không trả "chạy hay không": bộ lập lịch dùng khe để giành quyền chạy trong
 * DB — mỗi khe chạy đúng một lần dù có hai tiến trình, dù dev server nạp lại module.
 *
 * Có BẮT KỊP: máy bật lúc 10h vẫn chạy bản tin sáng hôm đó (khe = ngày, đến hạn từ 7h); bật
 * máy thứ Tư vẫn chạy tổng hợp tuần (khe = thứ Hai của tuần, đến hạn từ 8h thứ Hai). Lịch
 * kiểu "đúng 7h00 mới chạy" thì một lần mất điện buổi sáng là mất luôn bản tin hôm đó.
 */
export function dueScheduledJobs(now: Date): Array<{ job: ScheduledJob; slot: string }> {
  const local = new Date(now.getTime() + GARAGE_UTC_OFFSET_MS);
  const day = local.toISOString().slice(0, 10);
  const hour = local.getUTCHours();
  const weekday = (local.getUTCDay() + 6) % 7; // 0 = thứ Hai
  const monday = new Date(local.getTime() - weekday * 24 * HOUR).toISOString().slice(0, 10);

  const due: Array<{ job: ScheduledJob; slot: string }> = [
    { job: "watchdog", slot: String(Math.floor(now.getTime() / WATCHDOG_INTERVAL_MS)) },
  ];
  if (hour >= 7) due.push({ job: "morning_brief", slot: day });
  if (weekday > 0 || hour >= 8) due.push({ job: "accounting_digest", slot: monday });
  return due;
}

// ---------------------------------------------------------------------------
// Sức khoẻ — cho /api/health, thứ mà n8n hỏi mỗi 30 phút
// ---------------------------------------------------------------------------

export type HealthCheck = {
  name: string;
  ok: boolean;
  detail: string;
  /** Hỏng cái này là app không dùng được (DB chết) — khác với "vòng tự động đang hỏng". */
  fatal?: boolean;
};
export type HealthStatus = "ok" | "degraded" | "down";

export function overallHealth(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => !c.ok && c.fatal)) return "down";
  if (checks.some((c) => !c.ok)) return "degraded";
  return "ok";
}

/** Nới cho cả lịch 30 phút (tự host) lẫn lịch ngày (Vercel Hobby chỉ cho cron mỗi ngày). */
export const WATCHDOG_STALE_MS = 26 * HOUR;

/**
 * Bộ canh gác TRONG app có còn chạy không. Chưa chạy lần nào thì KHÔNG tính là hỏng — cùng
 * lý do với `findSilentRules`: chưa bật lịch là việc cài đặt, còn đây chỉ bắt hồi quy.
 */
export function watchdogCheck(lastTick: Date | null, now: Date): HealthCheck {
  if (!lastTick) {
    return { name: "Bộ canh gác trong app", ok: true, detail: "Chưa chạy theo lịch lần nào (chưa bật lịch nội bộ hoặc cron)." };
  }
  const silent = now.getTime() - lastTick.getTime();
  if (silent > WATCHDOG_STALE_MS) {
    return {
      name: "Bộ canh gác trong app",
      ok: false,
      detail: `Im lặng ${formatDuration(silent)} — lịch nội bộ/cron đã ngừng, sự cố mới sẽ không được phát hiện.`,
    };
  }
  return { name: "Bộ canh gác trong app", ok: true, detail: `Chạy lần cuối ${formatDuration(silent)} trước.` };
}

// ---------------------------------------------------------------------------
// Kết quả đồng bộ n8n -> sự cố (cần người) và việc đã tự sửa
// ---------------------------------------------------------------------------

/** Hình dạng tối thiểu của báo cáo đồng bộ — khai báo lại ở đây để module này vẫn thuần. */
export type SyncSummary = {
  reachable: boolean;
  smtpCredentialFound: boolean;
  alertEmailSet: boolean;
  items: Array<{
    file: string;
    name: string;
    action: "created" | "updated" | "unchanged" | "drift-skipped" | "error";
    toggled: "activated" | "deactivated" | null;
    needsActivation: boolean;
    credentialFixed: boolean;
    detail?: string;
  }>;
};

const AUTOMATION_HREF = "/dashboard/automation";
const list = (names: string[]) => names.map((n) => n.replace(/^ANSER Auto — /, "")).join("; ");

/**
 * Tách kết quả đồng bộ thành hai nhóm:
 *   - `incidents`: việc CẦN NGƯỜI (lệch mẫu, chờ bật, lỗi, thiếu SMTP). Mở và giữ mở tới khi
 *     lần đo sau không còn thấy.
 *   - `autoFixes`: việc máy ĐÃ làm (tạo workflow thiếu, tắt theo app, bật canh gác). Ghi lại
 *     cho có dấu vết, đóng ngay.
 *
 * n8n không trả lời thì CHỈ báo đúng một việc đó: các suy luận khác (lệch, chờ bật) đều dựa
 * trên dữ liệu không đọc được, báo ra là báo đoán.
 */
export function n8nIncidents(sync: SyncSummary): { incidents: IncidentInput[]; autoFixes: IncidentInput[] } {
  if (!sync.reachable) {
    return {
      incidents: [
        {
          key: "watchdog:n8n:unreachable",
          severity: "high",
          title: "Không liên lạc được với n8n",
          body: "App gọi API của n8n không được — n8n đang tắt, hoặc N8N_API_KEY đã hết hạn. Mọi email tự động (nhắc khách, cảnh báo kho, báo cáo) đang dừng. Thông báo tự đóng khi n8n trả lời lại.",
          href: AUTOMATION_HREF,
        },
      ],
      autoFixes: [],
    };
  }

  const incidents: IncidentInput[] = [];
  const autoFixes: IncidentInput[] = [];

  if (!sync.smtpCredentialFound) {
    incidents.push({
      key: "watchdog:n8n:no-smtp",
      severity: "high",
      title: "n8n chưa có credential SMTP",
      body: "Workflow vẫn chạy theo lịch nhưng mọi node Gửi Email sẽ lỗi. Vào n8n → Credentials → thêm SMTP, rồi bấm “Đồng bộ workflow”.",
      href: AUTOMATION_HREF,
    });
  }

  if (!sync.alertEmailSet) {
    incidents.push({
      key: "watchdog:n8n:no-alert-email",
      severity: "normal",
      title: "Chưa có email nhận cảnh báo khi app ngừng",
      body: "Workflow canh gác app trên n8n không biết gửi cho ai nên đang để tắt. Điền Email doanh nghiệp ở Cài đặt (hoặc biến N8N_NOTIFY_EMAIL).",
      href: "/dashboard/settings",
    });
  }

  const errors = sync.items.filter((i) => i.action === "error");
  if (errors.length > 0) {
    incidents.push({
      key: "watchdog:n8n:sync-error",
      severity: "high",
      title: `${errors.length} workflow đồng bộ lên n8n bị lỗi`,
      body: `${list(errors.map((e) => e.name))}. Lỗi đầu tiên: ${errors[0].detail ?? "không rõ"}`,
      href: AUTOMATION_HREF,
    });
  }

  const drifted = sync.items.filter((i) => i.action === "drift-skipped");
  if (drifted.length > 0) {
    incidents.push({
      key: "watchdog:n8n:drift",
      severity: "normal",
      title: `${drifted.length} workflow trên n8n khác bản mẫu`,
      body: `${list(drifted.map((d) => d.name))}. Có thể ai đó đã chỉnh tay trong n8n nên bộ canh gác không tự đè. Kiểm tra rồi bấm “Đồng bộ workflow” để đưa về bản mẫu.`,
      href: AUTOMATION_HREF,
    });
  }

  const waiting = sync.items.filter((i) => i.needsActivation);
  if (waiting.length > 0) {
    incidents.push({
      key: "watchdog:n8n:inactive",
      severity: "normal",
      title: `${waiting.length} quy tắc đang bật nhưng workflow trên n8n đang tắt`,
      body: `${list(waiting.map((w) => w.name))}. Bộ canh gác không tự bật workflow gửi email (có workflow gửi thẳng cho khách). Bấm “Đồng bộ workflow” để bật, hoặc tắt quy tắc trong app.`,
      href: AUTOMATION_HREF,
    });
  }

  // Gộp theo LOẠI việc: lần đầu nối n8n có thể tạo 9 workflow và gán SMTP cho cả 9 — mười
  // tám dòng trên chuông cho một sự kiện là tiếng ồn (đo thật trên n8n 2.39).
  const fixGroups: Array<{ key: string; title: string; body: string; names: string[] }> = [
    {
      key: "watchdog:autofix:created",
      title: "Đã tự tạo {n} workflow còn thiếu trên n8n",
      body: "Mẫu có trong mã nguồn nhưng n8n chưa có",
      names: sync.items.filter((i) => i.action === "created").map((i) => i.name),
    },
    {
      key: "watchdog:autofix:smtp",
      title: "Đã tự gán SMTP cho {n} workflow",
      body: "Tạo lúc n8n chưa có credential SMTP nên node Gửi Email đang trống",
      names: sync.items.filter((i) => i.credentialFixed).map((i) => i.name),
    },
    {
      key: "watchdog:autofix:activated",
      title: "Đã tự bật {n} workflow hạ tầng trên n8n",
      body: "Workflow canh gác app phải luôn chạy",
      names: sync.items.filter((i) => i.toggled === "activated").map((i) => i.name),
    },
    {
      key: "watchdog:autofix:deactivated",
      title: "Đã tự tắt {n} workflow trên n8n",
      body: "Các quy tắc này đang tắt trong app",
      names: sync.items.filter((i) => i.toggled === "deactivated").map((i) => i.name),
    },
  ];
  for (const g of fixGroups) {
    if (g.names.length === 0) continue;
    autoFixes.push({
      key: g.key,
      severity: "normal",
      title: g.title.replace("{n}", String(g.names.length)),
      body: `${g.body}: ${list(g.names)}.`,
      href: AUTOMATION_HREF,
    });
  }

  return { incidents, autoFixes };
}

// ---------------------------------------------------------------------------
// Người canh gác có còn canh không
// ---------------------------------------------------------------------------

/** Workflow "Canh gác app" hỏi mỗi 30 phút; im 2 giờ = lỡ 4 lần liền, không còn là trễ. */
export const N8N_WATCHDOG_MAX_SILENCE_MS = 2 * HOUR;

/**
 * Workflow canh gác app bên n8n có còn hỏi `/api/health` không.
 *
 * Canh gác hai chiều chỉ có nghĩa khi CẢ HAI chiều còn sống. App đã biết n8n chết (API không
 * trả lời) — nhưng n8n sống mà riêng workflow canh gác bị tắt/hỏng thì trước đây không ai
 * biết, và lần app chết kế tiếp sẽ không có email nào. Chỉ báo khi ĐÃ TỪNG thấy nó hỏi: chưa
 * bao giờ thấy là việc cài đặt (chưa đồng bộ), không phải hồi quy.
 */
export function n8nWatchdogSilence(lastSeen: Date | null, now: Date): IncidentInput | null {
  if (!lastSeen) return null;
  const silent = now.getTime() - lastSeen.getTime();
  if (silent <= N8N_WATCHDOG_MAX_SILENCE_MS) return null;
  return {
    key: "watchdog:n8n:app-watchdog-silent",
    severity: "high",
    title: "Workflow “Canh gác app” trên n8n đã ngừng hỏi app",
    body: `Lần cuối n8n hỏi /api/health cách đây ${formatDuration(silent)}. Nếu app chết lúc này sẽ không ai nhận được email. Kiểm tra workflow còn Active và lịch sử chạy trong n8n, hoặc bấm “Đồng bộ workflow”.`,
    href: "/dashboard/automation",
  };
}

