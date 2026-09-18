// Biến đổi THUẦN một file workflow mẫu (n8n-workflows/*.json) thành đúng thứ sẽ đẩy lên n8n.
// Không import db, không gọi mạng — có test (`__tests__/n8nTemplates.test.ts`).
//
// Trước đây ba việc này làm TAY sau mỗi lần import, theo README: dán token nội bộ vào từng
// node HTTP Request, sửa địa chỉ app nếu không chạy ở host.docker.internal, gán credential
// SMTP cho từng node Gửi Email. Quên một node là workflow đó hỏng im lặng (401 hoặc không
// gửi được mail) — và đó là lý do vòng lặp "sửa mẫu -> n8n chạy mẫu mới" chưa bao giờ khép.

export const TOKEN_PLACEHOLDER = "REPLACE_WITH_N8N_INTERNAL_TOKEN";
// Workflow canh gác app gửi email KHI APP ĐÃ CHẾT — lúc đó không hỏi app được địa chỉ nhận,
// nên địa chỉ phải được điền sẵn vào workflow ngay lúc đồng bộ.
export const ALERT_EMAIL_PLACEHOLDER = "REPLACE_WITH_ALERT_EMAIL";
export const DEFAULT_APP_BASE = "http://host.docker.internal:3000";

export type WorkflowTemplate = {
  name: string;
  nodes: Array<{
    name: string;
    type: string;
    parameters: Record<string, unknown>;
    credentials?: Record<string, { id: string; name: string }>;
    [key: string]: unknown;
  }>;
  connections: unknown;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RenderOptions = {
  internalToken: string;
  /** Địa chỉ app mà CONTAINER n8n gọi tới, vd `http://app:3000` khi chạy chung compose. */
  appBaseUrl: string;
  smtpCredential: { id: string; name: string } | null;
  /** Người nhận cảnh báo "app không phản hồi". Trống thì workflow canh gác không gửi được. */
  alertEmail?: string | null;
};

/**
 * Điền token + địa chỉ app + credential SMTP vào một bản sao của mẫu.
 *
 * Làm trên chuỗi JSON cho token và URL (chúng nằm rải trong header, URL, cả trong biểu thức
 * `={{ '...' + $json.id }}`) — duyệt cây theo từng loại node sẽ bỏ sót chỗ nằm trong biểu
 * thức. Credential thì gán theo node vì đó là thuộc tính cấu trúc, không phải chuỗi.
 */
export function renderTemplate(template: WorkflowTemplate, options: RenderOptions): WorkflowTemplate {
  if (!options.internalToken) {
    // Đẩy lên n8n với placeholder nguyên xi = mọi lần chạy đều 401. Thà dừng ở đây.
    throw new Error("Thiếu N8N_INTERNAL_TOKEN — không đồng bộ được workflow.");
  }
  const base = options.appBaseUrl.replace(/\/+$/, "");
  const json = JSON.stringify(template)
    .split(TOKEN_PLACEHOLDER).join(options.internalToken)
    .split(DEFAULT_APP_BASE).join(base)
    .split(ALERT_EMAIL_PLACEHOLDER).join(options.alertEmail ?? "");

  const rendered = JSON.parse(json) as WorkflowTemplate;
  if (options.smtpCredential) {
    for (const node of rendered.nodes) {
      if (node.type === "n8n-nodes-base.emailSend") {
        node.credentials = { smtp: { id: options.smtpCredential.id, name: options.smtpCredential.name } };
      }
    }
  }
  return rendered;
}

/**
 * Dấu vân tay nội dung — phát hiện "workflow trên n8n đã lệch khỏi mẫu trong git".
 *
 * Chỉ băm phần có nghĩa (tên, loại, tham số, nối dây của từng node) và SẮP XẾP khoá: n8n trả
 * JSON với thứ tự khoá và thêm các trường riêng (id, position, webhookId, typeVersion mới)
 * — băm nguyên văn thì lần nào cũng "lệch". Credential cũng loại ra: id credential khác nhau
 * giữa các máy nhưng không phải là lệch nội dung.
 */
export function fingerprint(workflow: Pick<WorkflowTemplate, "nodes" | "connections">): string {
  const canonical = {
    nodes: [...workflow.nodes]
      .map((n) => ({ name: n.name, type: n.type, parameters: n.parameters }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    connections: workflow.connections,
  };
  return fnv1a(stableStringify(canonical));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// FNV-1a 32 bit — đủ để so khớp "cùng/khác nội dung", không phải mật mã. Không dùng
// node:crypto để module này chạy được cả trong test lẫn trình duyệt nếu cần.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Có node Gửi Email nào CHƯA gán credential SMTP không (gán credential khác thì tôn trọng). */
export function lacksSmtpCredential(workflow: Pick<WorkflowTemplate, "nodes">): boolean {
  return workflow.nodes.some((n) => n.type === "n8n-nodes-base.emailSend" && !n.credentials?.smtp);
}

export type SyncAction =
  | { action: "create" }
  | { action: "update"; reason: "drift" }
  | { action: "keep" }
  | { action: "skip-drift"; reason: "đã sửa tay trên n8n" };

/**
 * Quyết định làm gì với MỘT workflow — ranh giới giữa "tự sửa" và "hỏi người".
 *
 * - Chưa có trên n8n              -> TẠO (luôn an toàn, không đè gì của ai).
 * - Có, nội dung khớp mẫu         -> giữ nguyên.
 * - Có, lệch mẫu, `force`         -> CẬP NHẬT (người đã bấm "Đồng bộ lại").
 * - Có, lệch mẫu, không `force`   -> KHÔNG đè: có thể ai đó đã chỉnh tay trong n8n UI (đổi
 *                                     giờ chạy, thêm người nhận). Bộ canh gác tự động chỉ báo,
 *                                     không tự đè — tự đè là xoá công sức của người khác.
 */
export function decideSync(
  existingFingerprint: string | null,
  templateFingerprint: string,
  force: boolean,
): SyncAction {
  if (existingFingerprint === null) return { action: "create" };
  if (existingFingerprint === templateFingerprint) return { action: "keep" };
  return force ? { action: "update", reason: "drift" } : { action: "skip-drift", reason: "đã sửa tay trên n8n" };
}

export type SyncTrigger = "watchdog" | "human";
export type ActivationDecision = "activate" | "deactivate" | "none" | "needs-human";

/**
 * Bật/tắt workflow trên n8n cho khớp app — và ranh giới "máy tự làm / người quyết".
 *
 * - `wantActive = null` (quy tắc chưa có dòng trong DB): không đụng. Endpoint coi "không có
 *   dòng" là bật, nên tự tắt ở đây sẽ làm im một workflow đang chạy mà không ai bấm gì.
 * - TẮT luôn được tự làm: dừng gửi không gây hại cho ai (endpoint cũng đã tự bỏ qua khi quy
 *   tắc tắt, đây chỉ là dọn cho khớp).
 * - BẬT do bộ canh gác tự quyết CHỈ với workflow hạ tầng (canh gác app — gửi cho chính gara,
 *   chỉ khi app chết). Workflow nghiệp vụ thì KHÔNG: bật "Nhắc lịch hẹn" là bắt đầu gửi email
 *   cho KHÁCH THẬT. Cờ "bật" trong DB có thể chỉ là giá trị mặc định lúc tạo quy tắc, không
 *   phải quyết định của ai — nên phải có người bấm.
 */
export function decideActivation(input: {
  isActive: boolean;
  wantActive: boolean | null;
  trigger: SyncTrigger;
  infra: boolean;
}): ActivationDecision {
  const { isActive, wantActive, trigger, infra } = input;
  if (wantActive === null || wantActive === isActive) return "none";
  if (!wantActive) return "deactivate";
  if (trigger === "human" || infra) return "activate";
  return "needs-human";
}
