import { NextResponse } from "next/server";
import { badRequest, forbidden, handle, notFound, unauthorized } from "@/server/api";
import { applyPartsImport, planPartsImport } from "@/server/partsImport";
import { checkRateLimit, RATE_LIMITS } from "@/server/rateLimit";
import { requireManager, requireUser } from "@/server/session";
import { getBranchById } from "@/server/store/branches";

export const dynamic = "force-dynamic";

// 5 MB: file danh mục 781 mã thật nặng khoảng 60 KB. Giới hạn này đủ rộng cho kho lớn
// gấp chục lần, và đủ chặt để một file ảnh chọn nhầm không bị nạp cả vào RAM server.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".csv"];

/**
 * Nhập danh mục phụ tùng từ Excel/CSV qua giao diện.
 *
 * Hai bước, cùng một endpoint:
 *   - `mode=preview`: đọc file, đối chiếu kho, trả về kế hoạch. KHÔNG ghi gì.
 *   - `mode=apply`: đọc lại CHÍNH file đó và thực hiện.
 *
 * Bước apply đọc lại file thay vì nhận kế hoạch do client gửi lên: kế hoạch từ client là
 * dữ liệu người dùng sửa được bằng DevTools, và giữa lúc xem trước với lúc bấm đồng ý thì
 * kho có thể đã đổi (người khác vừa thêm một mã trùng). Tính lại ở server là cách duy
 * nhất để thứ được ghi đúng là thứ khớp với DB lúc ghi.
 *
 * Trước đây việc này chỉ làm được bằng `scripts/import-legacy-2025.mjs` trên máy dev,
 * nghĩa là mỗi đợt dữ liệu mới gara gửi tới đều phải chờ người biết chạy script.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (!user) return unauthorized();
    if (!(await requireManager())) {
      return forbidden("Chỉ quản lý trở lên mới nhập được danh mục phụ tùng.");
    }
    // Kiểm tra hạn mức TRƯỚC khi đọc form-data: đọc 5 MB vào RAM rồi mới từ chối là vô ích.
    const limited = checkRateLimit(RATE_LIMITS.partsImport, user.id);
    if (limited) return limited;

    const form = await request.formData().catch(() => null);
    if (!form) return badRequest("Cần gửi file qua form-data.");

    const file = form.get("file");
    const branchId = form.get("branchId");
    const mode = form.get("mode") === "apply" ? "apply" : "preview";

    if (!(file instanceof File)) return badRequest("Chưa chọn file.");
    if (typeof branchId !== "string" || !branchId) return badRequest("Chưa chọn chi nhánh nhận hàng.");

    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      // .xls (Excel 97-2003) là định dạng nhị phân khác hẳn .xlsx — báo rõ cách lưu lại
      // thay vì một lỗi đọc file khó hiểu.
      return badRequest(
        lowerName.endsWith(".xls")
          ? "File .xls đời cũ chưa đọc được. Mở bằng Excel rồi chọn Lưu thành → Excel Workbook (.xlsx)."
          : "Chỉ nhận file .xlsx hoặc .csv.",
      );
    }
    if (file.size > MAX_FILE_BYTES) return badRequest("File lớn hơn 5 MB.");

    const branch = await getBranchById(branchId);
    if (!branch) return notFound("Không tìm thấy chi nhánh.");

    const buffer = Buffer.from(await file.arrayBuffer());

    let plan;
    try {
      plan = await planPartsImport(buffer, file.name, branchId);
    } catch {
      return badRequest("Không đọc được file. Kiểm tra file có mở được bằng Excel không, và không đặt mật khẩu.");
    }

    if (mode === "preview") {
      return NextResponse.json({
        branchName: branch.name,
        totalRows: plan.totalRows,
        createCount: plan.toCreate.length,
        updateCount: plan.toUpdate.length,
        // Gửi đủ để người dùng soát, nhưng không gửi cả nghìn dòng về trình duyệt: 50
        // dòng đầu mỗi nhóm là đủ để nhận ra file bị lệch cột.
        createSample: plan.toCreate.slice(0, 50),
        updateSample: plan.toUpdate.slice(0, 50).map((u) => ({ code: u.row.code, name: u.row.name, changes: u.changes })),
        issues: plan.issues.slice(0, 100),
        issueCount: plan.issues.length,
        openingStockCount: plan.toCreate.filter((r) => (r.openingStock ?? 0) > 0).length,
      });
    }

    if (plan.toCreate.length === 0 && plan.toUpdate.length === 0) {
      return badRequest("File không có dòng nào để tạo mới hoặc cập nhật.");
    }

    const result = await applyPartsImport(plan, branchId);
    return NextResponse.json({ ...result, branchName: branch.name, skipped: plan.issues.length });
  });
}
