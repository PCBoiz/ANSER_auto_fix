import { db } from "@/server/db/client";
import { automationRules, branches, employees, parts, services } from "@/server/db/schema";
import { DEFAULT_LOW_STOCK_THRESHOLD, type AutomationRuleType } from "@/server/domain";
import { listBranches } from "@/server/store/branches";

const SEED_SERVICES = [
  { code: "DV-001", name: "Bảo dưỡng cấp 1 (5.000 km)", category: "Bảo dưỡng định kỳ", standardMinutes: 60, laborPrice: 350000 },
  { code: "DV-002", name: "Bảo dưỡng cấp 2 (20.000 km)", category: "Bảo dưỡng định kỳ", standardMinutes: 150, laborPrice: 900000 },
  { code: "DV-003", name: "Thay dầu động cơ + lọc dầu", category: "Bảo dưỡng định kỳ", standardMinutes: 45, laborPrice: 200000 },
  { code: "DV-004", name: "Kiểm tra - chẩn đoán bằng máy", category: "Kiểm tra - Chẩn đoán", standardMinutes: 45, laborPrice: 300000 },
  { code: "DV-005", name: "Thay má phanh trước", category: "Gầm - Lái - Phanh", standardMinutes: 90, laborPrice: 450000 },
  { code: "DV-006", name: "Cân bằng động - đảo lốp", category: "Lốp - La-zăng", standardMinutes: 60, laborPrice: 250000 },
  { code: "DV-007", name: "Vệ sinh dàn lạnh - nạp ga điều hoà", category: "Điện - Điều hoà", standardMinutes: 120, laborPrice: 700000 },
  { code: "DV-008", name: "Sơn dặm 1 tấm vỏ", category: "Đồng - Sơn", standardMinutes: 240, laborPrice: 1200000 },
];

const SEED_PARTS = [
  { code: "PT-001", name: "Lọc dầu động cơ", category: "Lọc - Dầu nhớt", oemNumber: "90915-YZZE1", unit: "Cái", stock: 42, price: 180000, cost: 120000, minStock: 10, location: "Kệ A1" },
  { code: "PT-002", name: "Dầu nhớt 5W-30 (1L)", category: "Lọc - Dầu nhớt", oemNumber: "08880-83543", unit: "Lít", stock: 96, price: 220000, cost: 155000, minStock: 24, location: "Kệ A2" },
  { code: "PT-003", name: "Lọc gió động cơ", category: "Lọc - Dầu nhớt", oemNumber: "17801-0D060", unit: "Cái", stock: 18, price: 260000, cost: 175000, minStock: 6, location: "Kệ A3" },
  { code: "PT-004", name: "Má phanh trước (bộ)", category: "Phanh", oemNumber: "04465-0D260", unit: "Bộ", stock: 4, price: 850000, cost: 590000, minStock: 6, location: "Kệ B1" },
  { code: "PT-005", name: "Ắc quy 12V-60Ah", category: "Điện - Ắc quy", oemNumber: "GS-60B24LS", unit: "Cái", stock: 7, price: 1650000, cost: 1250000, minStock: 3, location: "Kệ C1" },
  { code: "PT-006", name: "Lốp 205/55 R16", category: "Lốp", oemNumber: null, unit: "Chiếc", stock: 12, price: 1850000, cost: 1420000, minStock: 4, location: "Giá lốp" },
  { code: "PT-007", name: "Nước làm mát (1L)", category: "Vật tư tiêu hao", oemNumber: null, unit: "Lít", stock: 30, price: 90000, cost: 55000, minStock: 10, location: "Kệ A4" },
];

const SEED_EMPLOYEES = [
  { name: "Nguyễn Văn Hùng", position: "Quản đốc", specialty: "Máy - Hộp số", hourlyCost: 120000 },
  { name: "Trần Minh Khoa", position: "Kỹ thuật viên", specialty: "Máy - Hộp số", hourlyCost: 90000 },
  { name: "Lê Quốc Bảo", position: "Kỹ thuật viên", specialty: "Gầm - Treo - Phanh", hourlyCost: 90000 },
  { name: "Phạm Thị Lan", position: "Cố vấn dịch vụ", specialty: null, hourlyCost: 80000 },
  { name: "Đỗ Văn Tài", position: "Thủ kho", specialty: null, hourlyCost: 70000 },
];

// Idempotent: đảm bảo tồn tại ít nhất 1 chi nhánh và trả về ID của chi nhánh đầu tiên.
export async function ensureDefaultBranch() {
  let all = await listBranches();
  if (all.length === 0) {
    await db.insert(branches).values({
      name: "Gara trung tâm",
      address: "Chưa cập nhật",
    });
    all = await listBranches();
  }
  return all[0].id;
}

// Idempotent: chỉ seed khi bảng tương ứng đang rỗng (DB mới tinh).
export async function seedInitialData() {
  const branchId = await ensureDefaultBranch();

  const existingServices = await db.select({ id: services.id }).from(services).limit(1);
  if (existingServices.length === 0) {
    await db.insert(services).values(SEED_SERVICES);
  }

  const existingParts = await db.select({ id: parts.id }).from(parts).limit(1);
  if (existingParts.length === 0) {
    await db.insert(parts).values(SEED_PARTS.map((p) => ({ ...p, branchId })));
  }

  const existingEmployees = await db.select({ id: employees.id }).from(employees).limit(1);
  if (existingEmployees.length === 0) {
    await db.insert(employees).values(SEED_EMPLOYEES.map((e) => ({ ...e, branchId })));
  }

  const existingRules = await db.select({ id: automationRules.id }).from(automationRules).limit(1);
  if (existingRules.length === 0) {
    await db.insert(automationRules).values([
      {
        name: "Cảnh báo phụ tùng sắp hết",
        type: "low_stock_alert",
        thresholdQty: DEFAULT_LOW_STOCK_THRESHOLD,
        enabled: true,
      },
      {
        name: "Nhắc bảo dưỡng định kỳ",
        type: "maintenance_reminder",
        thresholdDays: 7,
        thresholdKm: 500,
        enabled: true,
      },
      {
        name: "Nhắc lịch hẹn ngày mai",
        type: "appointment_reminder",
        thresholdDays: 1,
        enabled: true,
      },
    ]);
  }

  await seedNewAutomationRules();
}

// Quy tắc thêm sau khi hệ thống đã chạy thật (22/08/2026) — không thể gộp vào nhánh
// "bảng rỗng" ở trên vì trên môi trường thật bảng automation_rules đã có dữ liệu từ lâu.
// Kiểm tra theo TỪNG loại quy tắc (không phải theo bảng rỗng hay chưa) để tự bù đúng phần
// còn thiếu mỗi lần server khởi động, mà không tạo trùng nếu đã tồn tại.
async function seedNewAutomationRules() {
  // Bổ sung 17/09/2026: `revenue_report` và `order_status_update` có workflow mẫu từ đầu
  // nhưng chưa bao giờ được seed thành quy tắc, nên trang Tự động hoá không bật/tắt hay
  // theo dõi được chúng. `morning_brief` và `accounting_digest` là hai bản tin mới.
  const NEW_RULES: Array<{
    name: string;
    type: AutomationRuleType;
    thresholdDays: number | null;
    thresholdQty?: number | null;
  }> = [
    { name: "Nhắc chờ nghiệm thu quá hạn", type: "awaiting_acceptance_reminder", thresholdDays: 2 },
    { name: "Báo cáo công nợ", type: "unpaid_invoice_report", thresholdDays: 7 },
    { name: "Báo cáo doanh thu ngày", type: "revenue_report", thresholdDays: null },
    { name: "Báo tiến độ sửa chữa cho khách", type: "order_status_update", thresholdDays: null },
    // Bản tin sáng: ngưỡng ngày = lệnh "chờ nghiệm thu" quá bao lâu thì đưa vào bản tin;
    // ngưỡng số lượng = liệt kê tối đa bao nhiêu phụ tùng sắp hết (phần còn lại chỉ đếm).
    { name: "Bản tin sáng cho quản lý xưởng", type: "morning_brief", thresholdDays: 2, thresholdQty: 10 },
    // Tổng hợp kế toán: ngưỡng ngày = hoá đơn mua hàng "chưa nhận" bao lâu thì coi là quá hạn.
    { name: "Tổng hợp tuần cho kế toán", type: "accounting_digest", thresholdDays: 15 },
  ];

  const existingTypes = new Set(
    (await db.select({ type: automationRules.type }).from(automationRules)).map((r) => r.type),
  );
  const toInsert = NEW_RULES.filter((r) => !existingTypes.has(r.type));
  if (toInsert.length > 0) {
    await db.insert(automationRules).values(toInsert.map((r) => ({ ...r, enabled: true })));
  }
}
