// Hằng số nghiệp vụ dùng chung giữa server và UI.
//
// Đặt ở một chỗ thay vì rải chuỗi tự do khắp nơi: trạng thái lệnh sửa chữa được
// đọc ở ít nhất 4 nơi (danh sách lệnh, bảng điều xưởng, báo cáo, quy tắc tự động),
// gõ sai một chữ ở một chỗ là mất bản ghi khỏi bộ lọc mà không có lỗi nào nổ ra.

export const SERVICE_ORDER_STATUSES = [
  "received", // đã tiếp nhận xe
  "diagnosing", // đang kiểm tra / chẩn đoán
  "quoted", // đã báo giá, chờ khách duyệt
  "approved", // khách đã duyệt
  "in_progress", // đang thi công
  "completed", // đã xong việc sửa chữa
  "awaiting_acceptance", // chờ khách tới nghiệm thu
  "delivered", // khách đã nghiệm thu, đã giao xe
  "cancelled",
] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  received: "Đã tiếp nhận",
  diagnosing: "Đang chẩn đoán",
  quoted: "Đã báo giá",
  approved: "Khách đã duyệt",
  in_progress: "Đang sửa chữa",
  completed: "Hoàn tất sửa chữa",
  awaiting_acceptance: "Chờ nghiệm thu",
  delivered: "Đã giao xe",
  cancelled: "Đã huỷ",
};

// Trạng thái được coi là "xe đang nằm trong xưởng" — dùng cho KPI và bảng điều xưởng.
export const ACTIVE_ORDER_STATUSES: ServiceOrderStatus[] = [
  "received",
  "diagnosing",
  "quoted",
  "approved",
  "in_progress",
  "completed",
  "awaiting_acceptance",
];

// "awaiting_acceptance" là trạng thái DUY NHẤT lùi được — khách nghiệm thu không đồng ý
// thì quay lại "in_progress" để sửa tiếp, giữ nguyên toàn bộ dòng công/phụ tùng đã có.
// Các bước trước đó (báo giá, duyệt...) không cho lùi: một khi đã thi công thì không có
// lý do nghiệp vụ nào để quay lại "chưa báo giá".
export const REVERTIBLE_FROM: Partial<Record<ServiceOrderStatus, ServiceOrderStatus>> = {
  awaiting_acceptance: "in_progress",
};

export const LABOR_STATUSES = ["pending", "in_progress", "done"] as const;
export type LaborStatus = (typeof LABOR_STATUSES)[number];

export const APPOINTMENT_STATUSES = [
  "pending",
  "confirmed",
  "arrived",
  "no_show",
  "cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  arrived: "Khách đã tới",
  no_show: "Khách không tới",
  cancelled: "Đã huỷ",
};

export const INVOICE_STATUSES = ["unpaid", "partial", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "transfer", "card", "insurance"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SERVICE_CATEGORIES = [
  "Bảo dưỡng định kỳ",
  "Sửa chữa máy",
  "Gầm - Lái - Phanh",
  "Điện - Điều hoà",
  "Đồng - Sơn",
  "Lốp - La-zăng",
  "Kiểm tra - Chẩn đoán",
] as const;

export const PART_CATEGORIES = [
  "Lọc - Dầu nhớt",
  "Phanh",
  "Gầm - Treo",
  "Điện - Ắc quy",
  "Lốp",
  "Thân vỏ",
  "Vật tư tiêu hao",
] as const;

export const PART_UNITS = ["Cái", "Bộ", "Chiếc", "Lít", "Mét", "Hộp"] as const;

export const EMPLOYEE_POSITIONS = [
  "Kỹ thuật viên",
  "Cố vấn dịch vụ",
  "Thủ kho",
  "Quản đốc",
  "Lễ tân",
  "Kế toán",
] as const;

export const TECHNICIAN_SPECIALTIES = [
  "Máy - Hộp số",
  "Gầm - Treo - Phanh",
  "Điện thân xe",
  "Điều hoà",
  "Đồng - Sơn",
  "Lốp - Cân chỉnh",
] as const;

// Chuyên môn của XƯỞNG (khác `TECHNICIAN_SPECIALTIES` là chuyên môn của từng người).
//
// Gara thật có 1 xưởng máy/động cơ và 1 xưởng đồng-sơn. Trước đây hai xưởng chỉ khác
// nhau ở TÊN, nên phần mềm không biết xưởng nào sơn được — mà đó chính là thứ quyết định
// dòng công nào chạy ở đâu khi một xe tai nạn cần cả hai xưởng trong cùng một lệnh.
export const BRANCH_SPECIALTIES = [
  "Máy - Động cơ - Hộp số",
  "Đồng - Sơn - Gò hàn",
  "Gầm - Treo - Phanh",
  "Điện - Điều hoà",
  "Lốp - Cân chỉnh",
  "Đa năng (làm mọi hạng mục)",
] as const;
export type BranchSpecialty = (typeof BRANCH_SPECIALTIES)[number];

// Hạng mục dịch vụ nào thường thuộc chuyên môn nào — dùng để GỢI Ý xưởng lúc thêm dòng
// công, không phải để ép. Gara nhỏ vẫn có ngày xưởng máy phải sơn dặm một tấm vỏ, chặn
// cứng là bắt người dùng nói dối phần mềm để làm được việc.
export const SERVICE_CATEGORY_TO_BRANCH_SPECIALTY: Record<string, BranchSpecialty> = {
  "Bảo dưỡng định kỳ": "Máy - Động cơ - Hộp số",
  "Sửa chữa máy": "Máy - Động cơ - Hộp số",
  "Gầm - Lái - Phanh": "Gầm - Treo - Phanh",
  "Điện - Điều hoà": "Điện - Điều hoà",
  "Đồng - Sơn": "Đồng - Sơn - Gò hàn",
  "Lốp - La-zăng": "Lốp - Cân chỉnh",
  "Kiểm tra - Chẩn đoán": "Máy - Động cơ - Hộp số",
};

export const AUTOMATION_RULE_TYPES = [
  "low_stock_alert", // phụ tùng dưới ngưỡng
  "maintenance_reminder", // xe tới hạn bảo dưỡng (theo ngày hoặc km)
  "appointment_reminder", // nhắc khách trước lịch hẹn
  "order_status_update", // báo khách khi lệnh đổi trạng thái
  "awaiting_acceptance_reminder", // lệnh "chờ nghiệm thu" quá lâu chưa thấy khách tới
  "unpaid_invoice_report", // hoá đơn chưa thu đủ quá lâu — báo nội bộ, không gửi khách
  "revenue_report", // báo cáo doanh thu định kỳ
] as const;
export type AutomationRuleType = (typeof AUTOMATION_RULE_TYPES)[number];

export const AUTOMATION_RULE_LABELS: Record<AutomationRuleType, string> = {
  low_stock_alert: "Cảnh báo phụ tùng sắp hết",
  maintenance_reminder: "Nhắc bảo dưỡng định kỳ",
  appointment_reminder: "Nhắc lịch hẹn",
  order_status_update: "Báo tiến độ sửa chữa",
  awaiting_acceptance_reminder: "Nhắc chờ nghiệm thu quá hạn",
  unpaid_invoice_report: "Báo cáo công nợ",
  revenue_report: "Báo cáo doanh thu định kỳ",
};

// Ngưỡng tồn kho mặc định khi phụ tùng không đặt `minStock` riêng.
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
