import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRules } from "@/server/db/schema";
import {
  decideActivation,
  decideSync,
  fingerprint,
  lacksSmtpCredential,
  renderTemplate,
  type SyncTrigger,
  type WorkflowTemplate,
} from "@/lib/n8nTemplates";
import {
  activateN8nWorkflow,
  createN8nWorkflow,
  deactivateN8nWorkflow,
  findSmtpCredential,
  getN8nWorkflow,
  isN8nApiConfigured,
  listN8nWorkflows,
  updateN8nWorkflow,
} from "@/server/n8nApi";
import { WORKFLOW_NAMES } from "@/server/store/automation";
import { getCompanySettings } from "@/server/store/settings";

// Nạp mẫu bằng import tĩnh (không đọc đĩa lúc chạy): bundler đóng gói chúng vào build, nên
// chạy được cả trên serverless nơi thư mục `n8n-workflows/` không nằm cạnh mã đã build.
import accountingDigest from "../../../n8n-workflows/accounting_digest.json";
import appWatchdog from "../../../n8n-workflows/app_watchdog.json";
import incidentAlert from "../../../n8n-workflows/incident_alert.json";
import appointmentReminder from "../../../n8n-workflows/appointment_reminder.json";
import awaitingAcceptance from "../../../n8n-workflows/awaiting_acceptance_reminder.json";
import lowStockAlert from "../../../n8n-workflows/low_stock_alert.json";
import maintenanceReminder from "../../../n8n-workflows/maintenance_reminder.json";
import morningBrief from "../../../n8n-workflows/morning_brief.json";
import orderStatusUpdate from "../../../n8n-workflows/order_status_update.json";
import ownerWeekly from "../../../n8n-workflows/owner_weekly_report.json";
import revenueReport from "../../../n8n-workflows/revenue_report.json";
import unpaidInvoiceReport from "../../../n8n-workflows/unpaid_invoice_report.json";

// Tự đồng bộ workflow mẫu lên n8n — nối chỗ đứt "import bằng tay" của vòng lặp.
//
// Trước đây: sửa mẫu trong git -> ai đó nhớ vào n8n UI -> Import from File -> dán token vào
// từng node HTTP -> gán SMTP cho từng node Email -> bật Active. Bỏ sót bước nào thì workflow
// hỏng im lặng. Nay: một lệnh (hoặc nút, hoặc bộ canh gác tự gọi) làm hết, và có bằng chứng.

type TemplateEntry = {
  file: string;
  template: WorkflowTemplate;
  /** Quy tắc trong app mà workflow này phục vụ; `null` = workflow hạ tầng (canh gác app). */
  ruleType: keyof typeof WORKFLOW_NAMES | null;
};

const TEMPLATES: TemplateEntry[] = [
  { file: "morning_brief.json", template: morningBrief as WorkflowTemplate, ruleType: "morning_brief" },
  { file: "accounting_digest.json", template: accountingDigest as WorkflowTemplate, ruleType: "accounting_digest" },
  { file: "owner_weekly_report.json", template: ownerWeekly as WorkflowTemplate, ruleType: "owner_weekly_report" },
  { file: "low_stock_alert.json", template: lowStockAlert as WorkflowTemplate, ruleType: "low_stock_alert" },
  { file: "maintenance_reminder.json", template: maintenanceReminder as WorkflowTemplate, ruleType: "maintenance_reminder" },
  { file: "appointment_reminder.json", template: appointmentReminder as WorkflowTemplate, ruleType: "appointment_reminder" },
  { file: "awaiting_acceptance_reminder.json", template: awaitingAcceptance as WorkflowTemplate, ruleType: "awaiting_acceptance_reminder" },
  { file: "unpaid_invoice_report.json", template: unpaidInvoiceReport as WorkflowTemplate, ruleType: "unpaid_invoice_report" },
  { file: "revenue_report.json", template: revenueReport as WorkflowTemplate, ruleType: "revenue_report" },
  { file: "order_status_update.json", template: orderStatusUpdate as WorkflowTemplate, ruleType: "order_status_update" },
  { file: "app_watchdog.json", template: appWatchdog as WorkflowTemplate, ruleType: null },
  { file: "incident_alert.json", template: incidentAlert as WorkflowTemplate, ruleType: null },
];

export type SyncItemResult = {
  file: string;
  name: string;
  action: "created" | "updated" | "unchanged" | "drift-skipped" | "error";
  /** Trạng thái Active trên n8n SAU lần đồng bộ; `null` = không biết (lỗi). */
  active: boolean | null;
  /** Đã bật/tắt để khớp app trong lần này. */
  toggled: "activated" | "deactivated" | null;
  /** Quy tắc bật trong app, workflow tắt trên n8n, và bộ canh gác không được tự bật. */
  needsActivation: boolean;
  /** Đã gán credential SMTP cho node Gửi Email còn trống (nội dung khớp mẫu, chỉ thêm credential). */
  credentialFixed: boolean;
  detail?: string;
};

export type SyncReport = {
  ok: boolean;
  reachable: boolean;
  smtpCredentialFound: boolean;
  /** Có địa chỉ nhận cảnh báo "app không phản hồi" hay không. */
  alertEmailSet: boolean;
  items: SyncItemResult[];
  /** Workflow lệch mẫu mà không đè — việc cần người quyết. */
  driftCount: number;
};

const UNREACHABLE: SyncReport = {
  ok: false,
  reachable: false,
  smtpCredentialFound: false,
  alertEmailSet: false,
  items: [],
  driftCount: 0,
};

/**
 * Đồng bộ toàn bộ mẫu lên n8n.
 *
 * `trigger = "watchdog"` (tự động, không có người): TẠO workflow còn thiếu, TẮT workflow mà
 * app đã tắt, bật workflow canh gác. Không đè workflow đã bị chỉnh tay, không bật workflow
 * nghiệp vụ — xem `decideSync` và `decideActivation`.
 * `trigger = "human"` (người bấm "Đồng bộ workflow"): làm hết, kể cả đè và bật.
 */
export async function syncN8nWorkflows(options: { trigger: SyncTrigger }): Promise<SyncReport> {
  if (!isN8nApiConfigured()) return UNREACHABLE;

  let existing: Array<{ id: string; name: string; active: boolean }>;
  try {
    existing = await listN8nWorkflows();
  } catch {
    return UNREACHABLE;
  }

  // Credential SMTP: lấy cái đầu tiên loại `smtp`. Không có thì vẫn tạo workflow (để lịch
  // chạy, nhịp tim về), chỉ node Email sẽ lỗi — báo rõ trong kết quả.
  let smtp: { id: string; name: string } | null = null;
  try {
    smtp = await findSmtpCredential();
  } catch {
    smtp = null;
  }

  const rules = await db.select().from(automationRules);
  const ruleByType = new Map(rules.map((r) => [r.type, r]));
  const byName = new Map(existing.map((w) => [w.name, w]));

  const internalToken = process.env.N8N_INTERNAL_TOKEN ?? "";
  const appBaseUrl = process.env.APP_URL_FOR_N8N ?? "http://host.docker.internal:3000";
  const company = await getCompanySettings();
  const alertEmail = company.email || process.env.N8N_NOTIFY_EMAIL || null;
  const force = options.trigger === "human";

  const items: SyncItemResult[] = [];
  for (const entry of TEMPLATES) {
    const name = entry.template.name;
    try {
      const rendered = renderTemplate(entry.template, { internalToken, appBaseUrl, smtpCredential: smtp, alertEmail });
      const wantFp = fingerprint(rendered);
      const current = byName.get(name);

      let workflowId = current?.id ?? null;
      let action: SyncItemResult["action"] = "unchanged";
      let credentialFixed = false;

      if (!current) {
        // n8n Public API luôn tạo workflow ở trạng thái TẮT — bật hay không do bước dưới.
        const created = await createN8nWorkflow({
          name,
          nodes: rendered.nodes,
          connections: rendered.connections,
          settings: rendered.settings ?? { executionOrder: "v1" },
        });
        workflowId = created.id;
        action = "created";
      } else {
        const detail = await getN8nWorkflow(current.id);
        const decision = decideSync(fingerprint(detail as WorkflowTemplate), wantFp, force);
        if (decision.action === "update") {
          await updateN8nWorkflow(current.id, {
            name,
            nodes: rendered.nodes as never,
            connections: rendered.connections,
            settings: rendered.settings ?? { executionOrder: "v1" },
          });
          action = "updated";
        } else if (decision.action === "skip-drift") {
          action = "drift-skipped";
        } else if (smtp && lacksSmtpCredential(detail as WorkflowTemplate)) {
          // Nội dung KHỚP mẫu, chỉ thiếu credential: workflow được tạo lúc n8n chưa có SMTP.
          // Vân tay cố ý bỏ qua credential (id khác nhau giữa các máy), nên nếu không có nhánh
          // này thì thêm SMTP sau đó sẽ không bao giờ tới được workflow — kể cả khi bấm Đồng
          // bộ. Ghi đè ở đây an toàn: thứ ghi lên giống hệt thứ đang có, cộng credential.
          await updateN8nWorkflow(current.id, {
            name,
            nodes: rendered.nodes as never,
            connections: rendered.connections,
            settings: rendered.settings ?? { executionOrder: "v1" },
          });
          action = "updated";
          credentialFixed = true;
        }
      }

      const rule = entry.ruleType ? ruleByType.get(entry.ruleType) : undefined;
      // Workflow canh gác: chỉ bật khi đã có người nhận — bật mà không có địa chỉ thì mỗi lần
      // app chết nó chỉ ghi lỗi "thiếu người nhận" trong n8n, không ai đọc.
      const wantActive = entry.ruleType ? (rule ? rule.enabled : null) : Boolean(alertEmail);
      const isActive = current?.active ?? false;
      const activation = decideActivation({ isActive, wantActive, trigger: options.trigger, infra: !entry.ruleType });

      // n8n TỪ CHỐI bật workflow có node Gửi Email chưa gán credential ("Missing required
      // credential: smtp" — đo trên n8n 2.39). Thử bật chỉ đẻ ra một lỗi trùng với sự cố
      // "chưa có SMTP" đã báo; lượt canh gác sau khi có SMTP sẽ tự bật.
      const blockedBySmtp =
        activation === "activate" && !smtp && rendered.nodes.some((n) => n.type === "n8n-nodes-base.emailSend");

      let active: boolean | null = isActive;
      let toggled: SyncItemResult["toggled"] = null;
      if (workflowId && activation === "activate" && !blockedBySmtp) {
        await activateN8nWorkflow(workflowId);
        active = true;
        toggled = "activated";
      } else if (workflowId && activation === "deactivate") {
        await deactivateN8nWorkflow(workflowId);
        active = false;
        toggled = "deactivated";
      }

      if (rule && workflowId && rule.n8nWorkflowId !== workflowId) {
        await db.update(automationRules).set({ n8nWorkflowId: workflowId }).where(eq(automationRules.id, rule.id));
      }

      items.push({
        file: entry.file,
        name,
        action,
        active,
        toggled,
        needsActivation: activation === "needs-human",
        credentialFixed,
        detail: blockedBySmtp
          ? "Chờ credential SMTP trong n8n rồi mới bật được."
          : !entry.ruleType && !alertEmail
            ? "Chưa có email nhận cảnh báo (Cài đặt → Email doanh nghiệp)."
            : undefined,
      });
    } catch (error) {
      items.push({
        file: entry.file,
        name,
        action: "error",
        active: null,
        toggled: null,
        needsActivation: false,
        credentialFixed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: items.every((i) => i.action !== "error"),
    reachable: true,
    smtpCredentialFound: Boolean(smtp),
    alertEmailSet: Boolean(alertEmail),
    items,
    driftCount: items.filter((i) => i.action === "drift-skipped").length,
  };
}
