import { NextResponse } from "next/server";
import { forbidden, handle, notFound, unauthorized } from "@/server/api";
import { salesLedgerPatchSchema } from "@/server/ledgerSchemas";
import { requireLedgerEditor, requireUser } from "@/server/session";
import { parseBody } from "@/server/validation";
import {
  deleteSalesLedgerEntry,
  getSalesLedgerEntryById,
  updateSalesLedgerEntry,
} from "@/server/store/salesLedger";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Sửa một chứng từ trong sổ bán hàng. Trước đây sổ chỉ có GET/POST: gõ nhầm một số 0 trong
// ô tổng tiền là sai vĩnh viễn, và cách duy nhất để sửa là vào thẳng DB.
//
// Quyền: quản lý trở lên, hoặc tài khoản luồng kế toán (`requireLedgerEditor`). Thêm
// chứng từ mới vẫn chỉ cần đăng nhập — nhập liệu là việc thường ngày, còn sửa số tiền của
// chứng từ đã ghi sổ thì không.
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireLedgerEditor())) {
      return forbidden("Chỉ quản lý hoặc kế toán mới sửa được chứng từ đã ghi sổ.");
    }

    const { id } = await params;
    if (!(await getSalesLedgerEntryById(id))) return notFound("Không tìm thấy chứng từ.");

    const parsed = await parseBody(request, salesLedgerPatchSchema);
    if (!parsed.ok) return parsed.response;

    const entry = await updateSalesLedgerEntry(id, parsed.data);
    return NextResponse.json({ entry });
  });
}

// Xoá chứng từ — dùng cho dòng nhập trùng hoặc nhập nhầm sổ. Xoá thật (không xoá mềm):
// sổ trong app là bản đối chiếu của phần mềm kế toán chính, nguồn sự thật nằm ở đó và ở
// bản sao lưu `npm run db:backup`, không phải ở một cột `deleted_at` ở đây.
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    if (!(await requireUser())) return unauthorized();
    if (!(await requireLedgerEditor())) {
      return forbidden("Chỉ quản lý hoặc kế toán mới xoá được chứng từ.");
    }

    const { id } = await params;
    const deleted = await deleteSalesLedgerEntry(id);
    if (!deleted) return notFound("Không tìm thấy chứng từ.");
    return NextResponse.json({ ok: true });
  });
}
