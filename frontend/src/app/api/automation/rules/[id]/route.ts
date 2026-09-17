import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, handle, notFound, unauthorized } from "@/server/api";
import {
  activateN8nWorkflow,
  deactivateN8nWorkflow,
  isN8nApiConfigured,
  listN8nWorkflows,
} from "@/server/n8nApi";
import { requireManager, requireUser } from "@/server/session";
import { getRule, updateRule, WORKFLOW_NAMES } from "@/server/store/automation";
import { optionalNonNegativeInt, parseBody, requiredText } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// `optionalNonNegativeInt` giữ đúng 0 là 0. Bản cũ viết `body.x ? Number(body.x) : null`, nên
// số 0 (falsy) thành null còn chuỗi "abc" thành NaN rồi nổ 500 ở Postgres.
const patchSchema = z.object({
  name: requiredText("Tên quy tắc", 200).optional(),
  enabled: z.boolean().optional(),
  thresholdQty: optionalNonNegativeInt.optional(),
  thresholdDays: optionalNonNegativeInt.optional(),
  thresholdKm: optionalNonNegativeInt.optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    // Trước đây chỉ cần đăng nhập — tài khoản KTV cũng tắt được cảnh báo tồn kho của cả gara.
    if (!(await requireManager())) return forbidden("Chỉ quản lý mới đổi được quy tắc tự động.");

    const { id } = await params;
    const rule = await getRule(id);
    if (!rule) return notFound("Không tìm thấy quy tắc.");

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const patch: Parameters<typeof updateRule>[1] = {};
    if (body.thresholdQty !== undefined) patch.thresholdQty = body.thresholdQty;
    if (body.thresholdDays !== undefined) patch.thresholdDays = body.thresholdDays;
    if (body.thresholdKm !== undefined) patch.thresholdKm = body.thresholdKm;
    if (body.name !== undefined) patch.name = body.name;

    let warning: string | null = null;

    if (body.enabled !== undefined) {
      // CỜ TRONG DB LÀ CÔNG TẮC THẬT (từ 17/09/2026). Mọi endpoint mà workflow gọi vào đều
      // đọc cờ này và trả "đang tắt, không gửi gì" (xem automation/rules.ts). Nên ghi DB luôn
      // thành công; đồng bộ trạng thái Active bên n8n chỉ là phần phụ.
      //
      // Bản cũ làm ngược lại — gọi n8n trước, n8n lỗi thì KHÔNG ghi DB. Hôm kiểm tra, Docker
      // không chạy: quản lý bấm tắt cảnh báo tồn kho sẽ nhận lỗi 502 và không có cách nào
      // dừng nó từ trong app.
      patch.enabled = body.enabled;

      if (isN8nApiConfigured()) {
        let workflowId = rule.n8nWorkflowId;
        try {
          if (!workflowId) {
            const workflows = await listN8nWorkflows();
            workflowId =
              workflows.find((w) => w.name === WORKFLOW_NAMES[rule.type as keyof typeof WORKFLOW_NAMES])?.id ??
              null;
          }
          if (workflowId) {
            if (body.enabled) await activateN8nWorkflow(workflowId);
            else await deactivateN8nWorkflow(workflowId);
            patch.n8nWorkflowId = workflowId;
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "không rõ lỗi";
          warning = body.enabled
            ? `Đã bật trong app, nhưng không bật được workflow bên n8n (${reason}). Email sẽ chưa gửi cho tới khi n8n chạy lại.`
            : `Đã tắt trong app — workflow n8n dù vẫn chạy cũng sẽ không gửi gì. (Không tắt được bên n8n: ${reason})`;
        }
      }
    }

    if (Object.keys(patch).length === 0) return badRequest("Không có thay đổi nào.");

    return NextResponse.json({ rule: await updateRule(id, patch), warning });
  });
}
