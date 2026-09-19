import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRules, branches } from "@/server/db/schema";
import { type AutomationRuleType } from "@/server/domain";

export type AutomationRule = typeof automationRules.$inferSelect;

export async function listRules() {
  return db
    .select({
      id: automationRules.id,
      name: automationRules.name,
      type: automationRules.type,
      branchId: automationRules.branchId,
      branchName: branches.name,
      thresholdQty: automationRules.thresholdQty,
      thresholdDays: automationRules.thresholdDays,
      thresholdKm: automationRules.thresholdKm,
      categoryFilter: automationRules.categoryFilter,
      enabled: automationRules.enabled,
      n8nWorkflowId: automationRules.n8nWorkflowId,
      lastRunAt: automationRules.lastRunAt,
      lastRunStatus: automationRules.lastRunStatus,
      lastRunSummary: automationRules.lastRunSummary,
      lastRunSource: automationRules.lastRunSource,
      createdAt: automationRules.createdAt,
    })
    .from(automationRules)
    .leftJoin(branches, eq(automationRules.branchId, branches.id))
    .orderBy(asc(automationRules.name));
}

export async function getRule(id: string): Promise<AutomationRule | undefined> {
  const rows = await db.select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
  return rows[0];
}

export async function updateRule(
  id: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    n8nWorkflowId: string | null;
    thresholdQty: number | null;
    thresholdDays: number | null;
    thresholdKm: number | null;
    branchId: string | null;
  }>,
) {
  const [rule] = await db
    .update(automationRules)
    .set(patch)
    .where(eq(automationRules.id, id))
    .returning();
  return rule;
}

export async function createRule(input: {
  name: string;
  type: AutomationRuleType;
  thresholdQty?: number | null;
  thresholdDays?: number | null;
  thresholdKm?: number | null;
  branchId?: string | null;
}) {
  const [rule] = await db.insert(automationRules).values(input).returning();
  return rule;
}

export async function deleteRule(id: string) {
  await db.delete(automationRules).where(eq(automationRules.id, id));
}

// Tên workflow trong n8n tương ứng với từng loại quy tắc — dùng để tự dò và liên kết, thay
// vì bắt người dùng copy Workflow ID từ n8n UI dán sang. Phải khớp trường `name` trong các
// file JSON ở `n8n-workflows/`.
export const WORKFLOW_NAMES: Record<AutomationRuleType, string> = {
  low_stock_alert: "ANSER Auto — Cảnh báo phụ tùng sắp hết",
  maintenance_reminder: "ANSER Auto — Nhắc bảo dưỡng định kỳ",
  appointment_reminder: "ANSER Auto — Nhắc lịch hẹn",
  order_status_update: "ANSER Auto — Báo tiến độ sửa chữa",
  awaiting_acceptance_reminder: "ANSER Auto — Nhắc chờ nghiệm thu quá hạn",
  unpaid_invoice_report: "ANSER Auto — Báo cáo công nợ",
  revenue_report: "ANSER Auto — Báo cáo doanh thu ngày",
  morning_brief: "ANSER Auto — Bản tin sáng cho quản lý xưởng",
  accounting_digest: "ANSER Auto — Tổng hợp tuần cho kế toán",
  owner_weekly_report: "ANSER Auto — Báo cáo tuần cho chủ gara",
};
