import {
  boolean,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Sequence sinh số chứng từ. Dùng sequence của Postgres thay vì `count(*)+1`: hai người
// lập lệnh cùng lúc mà đếm số dòng thì cả hai ra cùng một số, người thua bị lỗi unique
// thay vì tự lấy số tiếp theo. Đây đúng là chỗ ANSER v2 đã dính (ghi trong mục Hạn chế
// của nó) — sửa ngay từ đầu ở đây.
//
// Số KHÔNG reset theo năm: reset cần sequence tạo động mỗi năm hoặc một lần khoá bảng,
// cả hai đều thêm điểm hỏng để đổi lấy thẩm mỹ. Năm trong mã (`RO-2026-0007`) là năm lập,
// còn tính duy nhất do sequence bảo đảm.
//
// Chỉ dùng cho chứng từ hệ thống tự sinh. `parts.code` / `services.code` do người dùng tự
// đặt (gara có quy ước mã riêng, và phụ tùng còn có mã OEM của hãng) — form chỉ gợi ý mã
// kế tiếp, ràng buộc unique lo phần chống trùng.
export const serviceOrderCodeSeq = pgSequence("service_order_code_seq", {
  startWith: 1,
  increment: 1,
});
export const invoiceCodeSeq = pgSequence("invoice_code_seq", { startWith: 1, increment: 1 });

// ---------------------------------------------------------------------------
// Quy ước chung
//
// - Mọi số tiền là `integer` VND (không float — làm tròn tiền tệ bằng float là
//   nguồn sai lệch kinh điển khi cộng dồn hàng trăm dòng công/phụ tùng).
// - Số km (odometer) cũng là `integer`.
// - Thời lượng công lưu bằng **phút** (`integer`), không phải giờ thập phân.
// - Cột giá vốn (`cost`, `unitCost`) **nullable có chủ đích**: `null` = CHƯA BIẾT,
//   khác hẳn `0` = "không tốn đồng nào". Thiếu phân biệt này thì báo cáo lãi lỗ
//   coi mọi mặt hàng chưa nhập giá vốn là lãi 100% — con số sai mà nghe rất xuôi tai.
// ---------------------------------------------------------------------------

// Chi nhánh gara. Đóng luôn vai trò "kho phụ tùng" (mỗi phụ tùng thuộc đúng 1 chi
// nhánh) — thay cho `warehouses` bên ANSER v2 bán lẻ. Gộp làm 1 vì trong gara,
// kho phụ tùng luôn gắn với xưởng đang sửa xe; tách 2 khái niệm chỉ tạo thêm join
// mà không có trường hợp dùng thật (một kho phục vụ nhiều xưởng là mô hình chuỗi
// lớn, ngoài phạm vi hiện tại).
export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  address: text("address"),
  phone: text("phone"),
  // Chuyên môn của xưởng — gara thật có 1 xưởng máy/động cơ và 1 xưởng đồng-sơn, và đó
  // là thông tin quyết định dòng công nào chạy ở đâu. Trước đây chỉ phân biệt bằng TÊN
  // chi nhánh, nghĩa là muốn biết xưởng nào sơn được thì phải đọc chuỗi tự do — không
  // lọc được, không gợi ý được lúc thêm dòng công. Xem BRANCH_SPECIALTIES trong domain.ts.
  // `null` = xưởng đa năng / chưa phân loại, khác hẳn một chuyên môn cụ thể.
  specialty: text("specialty"),
  // Email nhận cảnh báo tồn kho thấp / nhắc bảo dưỡng / báo cáo định kỳ qua n8n.
  notificationEmail: text("notification_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Hồ sơ nhân sự — tách riêng khỏi `users` (tài khoản đăng nhập): 1 kỹ thuật viên
// có thể không bao giờ đăng nhập vào hệ thống, và 1 tài khoản có thể gắn với 1 hồ
// sơ nhân sự (users.employeeId).
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // "technician" (kỹ thuật viên) | "advisor" (cố vấn dịch vụ) | "storekeeper" | "manager" | ...
  position: text("position"),
  // Chuyên môn của KTV, vd "Máy gầm", "Điện thân xe", "Đồng sơn", "Điều hoà".
  specialty: text("specialty"),
  // Đơn giá công của KTV này (VND/giờ). Dùng để tính CHI PHÍ nhân công thực tế —
  // khác `serviceCatalog.laborPrice` là GIÁ BÁN công cho khách.
  hourlyCost: integer("hourly_cost"),
  phone: text("phone"),
  email: text("email"),
  hireDate: timestamp("hire_date", { withTimezone: true }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Tài khoản đăng nhập. Phân quyền 3 cấp: "staff" < "manager" < "admin".
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("staff"),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    // Tài khoản do quản trị viên cấp (mật khẩu tạm gõ tay, thường đọc qua điện thoại) và
    // tài khoản khởi tạo hệ thống đều bật cờ này. Dashboard chặn mọi trang cho tới khi
    // người dùng tự đặt mật khẩu mới. Trước đây mật khẩu tạm sống mãi mãi — 3 tài khoản
    // test trong repo này là bằng chứng.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_employee_id_idx").on(table.employeeId)],
);

// Nhật ký thử đăng nhập — nền của rate-limit ở `src/server/loginThrottle.ts`.
//
// Vì sao lưu DB thay vì đếm trong RAM: đếm trong RAM chỉ đúng khi có đúng 1 tiến trình
// Node chạy mãi. Deploy lên Vercel/Cloud Run là nhiều instance, mỗi instance một bộ đếm
// riêng, và instance khởi động lại là mất sạch — kẻ dò mật khẩu chỉ cần đợi. Một bảng
// nhỏ tốn thêm 1 câu đếm mỗi lần đăng nhập, đổi lại giới hạn đúng thật ở mọi kiểu deploy.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lưu email người ta GÕ VÀO, kể cả email không tồn tại — dò mật khẩu bằng cách thử
    // hàng loạt email là việc phải chặn, không phải bỏ qua vì "user không có thật".
    email: text("email").notNull(),
    ip: text("ip"),
    success: boolean("success").notNull().default(false),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("login_attempts_email_time_idx").on(table.email, table.attemptedAt),
    index("login_attempts_ip_time_idx").on(table.ip, table.attemptedAt),
  ],
);

// ---------------------------------------------------------------------------
// Khách hàng & xe
// ---------------------------------------------------------------------------

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // "individual" | "company" — công ty cần xuất hoá đơn VAT theo mã số thuế.
  type: text("type").notNull().default("individual"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxCode: text("tax_code"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Xe là thực thể trung tâm của mảng sửa chữa — mọi lịch sử dịch vụ treo vào xe,
// KHÔNG treo vào khách hàng: xe đổi chủ thì lịch sử bảo dưỡng phải đi theo xe.
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Chủ xe hiện tại. `set null` khi xoá khách: xe vẫn còn lịch sử sửa chữa hợp lệ
  // dù hồ sơ chủ cũ bị xoá.
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  licensePlate: text("license_plate").notNull().unique(),
  vin: text("vin"),
  make: text("make").notNull(), // hãng: Toyota, Ford, Hyundai...
  model: text("model").notNull(), // dòng: Vios, Ranger, Santa Fe...
  year: integer("year"),
  color: text("color"),
  engineNumber: text("engine_number"),
  // "gasoline" | "diesel" | "hybrid" | "electric"
  fuelType: text("fuel_type"),
  // "manual" | "automatic"
  transmission: text("transmission"),
  // Số km ghi nhận gần nhất. Cập nhật mỗi lần tiếp nhận xe (serviceOrders.odometerIn).
  odometer: integer("odometer"),
  // Mốc bảo dưỡng kế tiếp — nguồn dữ liệu cho quy tắc tự động "nhắc bảo dưỡng".
  // Tính sẵn lúc đóng lệnh sửa chữa thay vì suy ra lúc chạy: quy tắc nhắc lịch phải
  // trả lời được "xe nào tới hạn" bằng 1 câu WHERE, không phải quét toàn bộ lịch sử.
  nextServiceAt: timestamp("next_service_at", { withTimezone: true }),
  nextServiceOdometer: integer("next_service_odometer"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("vehicles_customer_id_idx").on(table.customerId),
  // Quy tắc "nhắc bảo dưỡng" quét đúng cột này mỗi ngày (listVehiclesDueForService).
  index("vehicles_next_service_at_idx").on(table.nextServiceAt),
]);

// ---------------------------------------------------------------------------
// Danh mục dịch vụ & phụ tùng
// ---------------------------------------------------------------------------

// Bảng giá dịch vụ (công lao động). Đây là DANH MỤC, không phải công việc đã làm —
// công việc đã làm nằm ở `serviceOrderLabors`.
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // "DV-001"
  name: text("name").notNull(),
  // "Bảo dưỡng định kỳ" | "Sửa chữa máy" | "Gầm - Lái - Phanh" | "Điện - Điều hoà"
  // | "Đồng - Sơn" | "Lốp - La-zăng" | "Kiểm tra - Chẩn đoán"
  category: text("category").notNull(),
  // Giờ công chuẩn tính bằng PHÚT — cơ sở báo giá và xếp lịch xưởng.
  standardMinutes: integer("standard_minutes").notNull().default(60),
  // Giá bán công cho khách (VND) cho trọn hạng mục này.
  laborPrice: integer("labor_price").notNull().default(0),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Phụ tùng / vật tư trong kho. Mỗi phụ tùng thuộc đúng 1 chi nhánh (tồn kho độc lập).
export const parts = pgTable(
  "parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // mã nội bộ "PT-001"
    name: text("name").notNull(),
    // "Lọc - Dầu nhớt" | "Phanh" | "Gầm - Treo" | "Điện - Ắc quy" | "Lốp"
    // | "Thân vỏ" | "Vật tư tiêu hao"
    category: text("category").notNull(),
    // Mã phụ tùng chính hãng (OEM) — thứ thợ và khách thực sự tra khi đặt hàng.
    oemNumber: text("oem_number"),
    unit: text("unit").notNull().default("Cái"), // "Cái" | "Bộ" | "Lít" | "Mét"
    stock: integer("stock").notNull().default(0),
    price: integer("price").notNull().default(0), // giá bán
    cost: integer("cost"), // giá vốn hiện hành — nullable = chưa biết
    // Ngưỡng cảnh báo tồn thấp RIÊNG cho phụ tùng này. Nullable = dùng ngưỡng chung
    // của quy tắc tự động. Cần cột riêng vì lọc dầu và hộp số không thể chung ngưỡng.
    minStock: integer("min_stock"),
    location: text("location"), // vị trí trong kho, vd "Kệ A3"
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Mã phụ tùng chỉ cần duy nhất TRONG 1 chi nhánh, không phải toàn hệ thống —
  // 2 chi nhánh có kho độc lập, ép unique toàn cục sẽ chặn chi nhánh mới nhập
  // đúng mặt hàng mà chi nhánh cũ đã có.
  (table) => [
    unique("parts_branch_code_unique").on(table.branchId, table.code),
    // Kho thật đã có 781 mã ở riêng xưởng đồng-sơn; lọc theo chi nhánh là thao tác
    // mặc định của trang Kho phụ tùng và của mọi quy tắc cảnh báo tồn thấp.
    index("parts_branch_id_idx").on(table.branchId),
    index("parts_category_idx").on(table.category),
  ],
);

// Nhập/xuất kho phụ tùng. Xuất kho có thể gắn với 1 lệnh sửa chữa cụ thể.
export const partTransactions = pgTable("part_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  partId: uuid("part_id")
    .notNull()
    .references(() => parts.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "import" | "export"
  quantity: integer("quantity").notNull(),
  // Đơn giá của chính lần nhập này (VND) — nguồn giá vốn đáng tin nhất vì gắn với
  // một lô cụ thể, không phải con số bình quân trôi theo thời gian như `parts.cost`.
  unitCost: integer("unit_cost"),
  counterparty: text("counterparty"), // nhà cung cấp (nhập) / lý do (xuất)
  // Xuất kho phục vụ lệnh sửa chữa nào. `set null` để lịch sử kho không mất khi
  // lệnh bị xoá — số lượng đã xuất là sự thật đã xảy ra.
  serviceOrderId: uuid("service_order_id").references(() => serviceOrders.id, {
    onDelete: "set null",
  }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Lịch sử nhập/xuất của MỘT phụ tùng — mở ra mỗi lần thủ kho đối chiếu tồn.
  index("part_transactions_part_id_idx").on(table.partId),
  index("part_transactions_order_id_idx").on(table.serviceOrderId),
  index("part_transactions_created_at_idx").on(table.createdAt),
]);

// ---------------------------------------------------------------------------
// Lịch hẹn
// ---------------------------------------------------------------------------

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  // Khách hẹn qua điện thoại có thể chưa có hồ sơ xe trong hệ thống — giữ nullable
  // + `contactName`/`contactPhone`/`plateText` tự do để lễ tân không bị chặn.
  vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  plateText: text("plate_text"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  // "pending" | "confirmed" | "arrived" | "no_show" | "cancelled" — xem APPOINTMENT_STATUSES.
  status: text("status").notNull().default("pending"),
  source: text("source").notNull().default("phone"), // "phone" | "web" | "walk_in" | "reminder"
  requestNote: text("request_note"), // khách yêu cầu gì
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Lịch hẹn luôn đọc theo khung thời gian ("hôm nay", "24 giờ tới") kèm trạng thái.
  index("appointments_scheduled_at_idx").on(table.scheduledAt),
  index("appointments_status_idx").on(table.status),
]);

// ---------------------------------------------------------------------------
// Lệnh sửa chữa (Repair Order) — trung tâm của toàn bộ nghiệp vụ
// ---------------------------------------------------------------------------

export const serviceOrders = pgTable("service_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // "RO-2026-0001"
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  // Cố vấn dịch vụ phụ trách lệnh này.
  advisorId: uuid("advisor_id").references(() => employees.id, { onDelete: "set null" }),

  // "received" -> "diagnosing" -> "quoted" -> "approved" -> "in_progress"
  // -> "completed" -> "awaiting_acceptance" -> "delivered", hoặc "cancelled".
  // "awaiting_acceptance" (chờ khách nghiệm thu) có thể LÙI về "in_progress" nếu khách
  // không đồng ý — xem SERVICE_ORDER_STATUSES và REVERTIBLE_STATUSES.
  status: text("status").notNull().default("received"),

  // Snapshot xe lúc tiếp nhận — biển số có thể đổi (sang tên, đổi biển), nhưng
  // phiếu đã in cho khách phải giữ nguyên thông tin lúc đó.
  plateSnapshot: text("plate_snapshot").notNull(),
  odometerIn: integer("odometer_in"),

  customerComplaint: text("customer_complaint"), // lời khai của khách
  diagnosis: text("diagnosis"), // chẩn đoán của kỹ thuật viên

  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  promisedAt: timestamp("promised_at", { withTimezone: true }), // hẹn trả xe
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),

  // Tổng tiền — LƯU SẴN, không tính lại từ các dòng mỗi lần đọc: báo cáo doanh thu
  // và danh sách lệnh phải đọc được tổng mà không join 2 bảng con. Các hàm ghi
  // (thêm/sửa/xoá dòng công hoặc phụ tùng) chịu trách nhiệm cập nhật lại 4 cột này
  // trong cùng 1 db.transaction().
  laborTotal: integer("labor_total").notNull().default(0),
  partsTotal: integer("parts_total").notNull().default(0),
  discount: integer("discount").notNull().default(0),
  total: integer("total").notNull().default(0),

  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // `status` được lọc ở KPI "xe đang trong xưởng" (IN 7 giá trị), ở bảng điều xưởng và ở
  // mọi báo cáo — đây là cột bị quét nhiều nhất trong hệ thống.
  index("service_orders_status_idx").on(table.status),
  index("service_orders_vehicle_id_idx").on(table.vehicleId),
  index("service_orders_customer_id_idx").on(table.customerId),
  index("service_orders_branch_id_idx").on(table.branchId),
  // Danh sách lệnh luôn sắp xếp mới nhất trước.
  index("service_orders_received_at_idx").on(table.receivedAt),
  // Doanh thu theo ngày giao xe (getRevenueReport).
  index("service_orders_delivered_at_idx").on(table.deliveredAt),
]);

// Dòng CÔNG trên lệnh sửa chữa.
//
// Vì sao tách khỏi dòng phụ tùng (khác ANSER v2 bán lẻ — nơi 1 bảng
// `sales_invoice_items` là đủ)? Hai loại dòng này khác nhau về bản chất:
//   - dòng công: gắn kỹ thuật viên, có tiến độ riêng (đang làm / xong), tính theo
//     thời gian, KHÔNG chạm vào kho;
//   - dòng phụ tùng: trừ tồn kho, có giá vốn theo lô, không có người thực hiện.
// Gộp 1 bảng thì quá nửa số cột luôn NULL ở một trong hai loại, và mọi truy vấn
// đều phải kèm `WHERE kind = ...` — che mất chính điều khiến chúng khác nhau.
export const serviceOrderLabors = pgTable("service_order_labors", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceOrderId: uuid("service_order_id")
    .notNull()
    .references(() => serviceOrders.id, { onDelete: "cascade" }),
  // Hạng mục trong bảng giá. `set null` + `name` snapshot: sửa bảng giá không được
  // làm sai lệnh đã lập.
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  // Xưởng THỰC HIỆN dòng công này — khác `serviceOrders.branchId` (xưởng tiếp nhận xe).
  // Một xe tai nạn có thể vừa cần sửa máy vừa cần sơn: xe vẫn nằm trong ĐÚNG MỘT lệnh sửa
  // chữa, nhưng từng dòng công gán riêng xưởng máy/xưởng sơn. Nullable = chưa phân xưởng
  // (gara chỉ có 1 xưởng, hoặc chưa quyết dòng công này thuộc xưởng nào).
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  technicianId: uuid("technician_id").references(() => employees.id, { onDelete: "set null" }),
  // Giá công thoả thuận cho dòng này (snapshot tại thời điểm lập lệnh).
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull().default(1),
  lineTotal: integer("line_total").notNull(),
  standardMinutes: integer("standard_minutes"), // định mức lúc lập lệnh
  actualMinutes: integer("actual_minutes"), // thời gian làm thật, để đối chiếu định mức
  // "pending" | "in_progress" | "done"
  status: text("status").notNull().default("pending"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("service_order_labors_order_id_idx").on(table.serviceOrderId),
  // "Khu vực nhận việc" của KTV lọc đúng cột này xuyên mọi lệnh.
  index("service_order_labors_technician_id_idx").on(table.technicianId),
]);

// Dòng PHỤ TÙNG trên lệnh sửa chữa.
export const serviceOrderParts = pgTable("service_order_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceOrderId: uuid("service_order_id")
    .notNull()
    .references(() => serviceOrders.id, { onDelete: "cascade" }),
  partId: uuid("part_id").references(() => parts.id, { onDelete: "set null" }),
  // Snapshot — phụ tùng có thể đổi tên/đơn vị/giá, hoặc bị xoá khỏi danh mục.
  name: text("name").notNull(),
  unit: text("unit").notNull().default("Cái"),
  unitPrice: integer("unit_price").notNull(),
  // Giá vốn TẠI THỜI ĐIỂM XUẤT — lãi gộp của lệnh cũ phải giữ nguyên dù giá nhập
  // lô sau có đổi. `null` = chưa biết giá vốn lúc xuất.
  unitCost: integer("unit_cost"),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("service_order_parts_order_id_idx").on(table.serviceOrderId),
  index("service_order_parts_part_id_idx").on(table.partId),
]);

// Phụ tùng ĐẶT NGOÀI cho một lệnh sửa chữa cụ thể — khác hẳn `serviceOrderParts`
// (lấy từ tồn kho có sẵn, trừ kho ngay lúc thêm vào lệnh). Đặt ngoài là phụ tùng gara
// KHÔNG có sẵn, phải mua từ nhà cung cấp riêng cho đúng lệnh này — có một khoảng thời
// gian "đang chờ hàng" mà `serviceOrderParts` không mô hình hoá được (nó giả định đã có
// hàng ngay lúc thêm dòng).
//
// Vòng đời: "ordered" (đã đặt, có thể chưa rõ giá) -> "arrived" (hàng về, có giá thật)
// -> "billed" (đã chuyển thành 1 dòng trong serviceOrderParts, tính vào hoá đơn) hoặc
// "cancelled". Không xuất hiện trong `serviceOrderParts`/tổng tiền lệnh cho tới khi
// "billed" — báo giá cho khách không được gồm phụ tùng còn "chưa chắc đặt được".
export const serviceOrderSpecialOrders = pgTable("service_order_special_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceOrderId: uuid("service_order_id")
    .notNull()
    .references(() => serviceOrders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  supplier: text("supplier"),
  unit: text("unit").notNull().default("Cái"),
  quantity: integer("quantity").notNull().default(1),
  // Giá dự kiến lúc đặt — nullable vì lúc đặt hàng có thể chưa biết giá chính xác.
  estimatedCost: integer("estimated_cost"),
  // Giá vốn thật khi hàng về.
  actualCost: integer("actual_cost"),
  // Giá bán cho khách — đặt lúc "billed", có thể khác actualCost (gara vẫn có lãi trên
  // hàng đặt ngoài, không chỉ hàng trong kho).
  sellPrice: integer("sell_price"),
  status: text("status").notNull().default("ordered"), // "ordered" | "arrived" | "billed" | "cancelled"
  note: text("note"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  // Trỏ tới dòng đã sinh ra trong serviceOrderParts khi "billed" — để không tính vào
  // hoá đơn hai lần và để biết dòng nào trên hoá đơn vốn là hàng đặt ngoài.
  billedLineId: uuid("billed_line_id").references(() => serviceOrderParts.id, {
    onDelete: "set null",
  }),
}, (table) => [
  index("special_orders_order_id_idx").on(table.serviceOrderId),
  index("special_orders_status_idx").on(table.status),
]);

// ---------------------------------------------------------------------------
// Hoá đơn thanh toán
// ---------------------------------------------------------------------------

// 1 lệnh sửa chữa -> nhiều nhất 1 hoá đơn (`serviceOrderId` unique).
//
// Hoá đơn KHÔNG có bảng dòng riêng — dòng chi tiết đọc thẳng từ
// `serviceOrderLabors`/`serviceOrderParts` của lệnh, vì chúng đã là snapshot bất
// biến (tên/giá/giá vốn chốt tại thời điểm lập). Nhân đôi chúng sang bảng khác chỉ
// tạo thêm một bản sao có thể lệch, không thêm thông tin gì.
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // "HD-2026-0001"
  serviceOrderId: uuid("service_order_id")
    .notNull()
    .unique()
    .references(() => serviceOrders.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  // Snapshot để in hoá đơn không phụ thuộc hồ sơ khách còn tồn tại hay không.
  customerName: text("customer_name").notNull(),
  plateSnapshot: text("plate_snapshot").notNull(),

  subtotal: integer("subtotal").notNull(), // laborTotal + partsTotal
  discount: integer("discount").notNull().default(0),
  taxRate: integer("tax_rate").notNull().default(0), // % VAT, số nguyên (8 = 8%)
  taxAmount: integer("tax_amount").notNull().default(0),
  total: integer("total").notNull(),
  paidAmount: integer("paid_amount").notNull().default(0),
  // "unpaid" | "partial" | "paid" — suy ra từ paidAmount vs total, nhưng lưu sẵn để
  // lọc danh sách công nợ không phải tính toán trên mọi dòng.
  status: text("status").notNull().default("unpaid"),
  // "cash" | "transfer" | "card" | "insurance"
  paymentMethod: text("payment_method"),
  // Bảo hiểm chi trả bao nhiêu (phần còn lại khách tự trả) — trường hợp rất phổ
  // biến với đồng sơn sau va chạm.
  insuranceAmount: integer("insurance_amount").notNull().default(0),
  insuranceProvider: text("insurance_provider"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
}, (table) => [
  // Báo cáo doanh thu và sổ công nợ đều quét theo ngày phát hành + trạng thái.
  index("invoices_issued_at_idx").on(table.issuedAt),
  index("invoices_status_idx").on(table.status),
  index("invoices_customer_id_idx").on(table.customerId),
]);

// ---------------------------------------------------------------------------
// Cấu hình & tự động hoá
// ---------------------------------------------------------------------------

// Luôn chỉ có đúng 1 dòng (singleton) — xem ensureCompanySettingsRow().
export const companySettings = pgTable("company_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default("ANSER Auto"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  taxCode: text("tax_code"),
  currency: text("currency").notNull().default("VND"),
  // Thuế VAT mặc định (%) và đơn giá công mặc định (VND/giờ) khi hạng mục chưa có giá.
  defaultTaxRate: integer("default_tax_rate").notNull().default(8),
  defaultLaborRate: integer("default_labor_rate").notNull().default(0),
  // Chu kỳ bảo dưỡng mặc định — dùng để tính `vehicles.nextServiceAt`/`nextServiceOdometer`
  // khi đóng lệnh, nếu hạng mục không nói gì khác.
  maintenanceIntervalDays: integer("maintenance_interval_days").notNull().default(180),
  maintenanceIntervalKm: integer("maintenance_interval_km").notNull().default(5000),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // "low_stock_alert" | "maintenance_reminder" | "appointment_reminder"
  // | "order_status_update" | "revenue_report" — xem AUTOMATION_RULE_TYPES.
  type: text("type").notNull().default("low_stock_alert"),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  // Ngưỡng — mỗi loại quy tắc dùng đúng một trong ba cột này, nên để nullable hết
  // thay vì một cột `threshold` chung không đọc nổi ý nghĩa.
  thresholdQty: integer("threshold_qty"), // low_stock_alert: tồn dưới mức này
  thresholdDays: integer("threshold_days"), // maintenance/appointment: còn N ngày
  thresholdKm: integer("threshold_km"), // maintenance: còn N km
  categoryFilter: text("category_filter"),
  enabled: boolean("enabled").notNull().default(true),
  // ID workflow thật bên n8n. Có giá trị này thì nút Chạy/Dừng/Lịch sử mới gọi n8n
  // API thật; không có thì chỉ là bookkeeping riêng của app.
  n8nWorkflowId: text("n8n_workflow_id"),

  // --- Dấu vết lần chạy gần nhất (bổ sung 17/09/2026) ---
  //
  // Câu hỏi "workflow có TỰ chạy đúng lịch không?" trước đây không trả lời được từ trong
  // app: lịch sử chạy chỉ nằm bên n8n, và chỉ đọc được khi n8n đang bật + API key còn
  // hạn. Nếu n8n tắt (đúng tình trạng hôm nay: Docker không chạy), trang Tự động hoá vẫn
  // hiện quy tắc "Đang bật" — bật trong DB của app, chứ không phải đang thật sự chạy.
  //
  // Ba cột dưới đây do CHÍNH workflow ghi vào khi chạy xong (node cuối gọi
  // POST /api/n8n/internal/heartbeat). Không có nhịp tim nào trong 24h = chưa chạy, dù
  // app có ghi "Đang bật". Đây là bằng chứng do bên thực thi để lại, không phải suy đoán.
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  // "ok" | "error" | "skipped" (chạy nhưng không có dữ liệu để gửi).
  lastRunStatus: text("last_run_status"),
  lastRunSummary: text("last_run_summary"),
  // "schedule" = n8n tự nổ theo lịch; "manual" = người bấm chạy; "cron" = bộ lập lịch
  // nội bộ của app chạy thay khi n8n không có. Phân biệt được ba nguồn này mới biết lịch
  // có thật sự hoạt động hay chỉ toàn người bấm tay.
  lastRunSource: text("last_run_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sổ kế toán (mua/bán hàng hoá, dịch vụ) — độc lập với nghiệp vụ sửa xe
// ---------------------------------------------------------------------------

// Sổ bán hàng (kế toán) — hoá đơn bán hàng hoá/dịch vụ nói chung, KHÔNG gắn lệnh sửa chữa cụ
// thể (khác `invoices`, vốn bắt buộc 1-1 với `service_orders`). Dùng cho sổ sách khai thuế
// thật của xưởng — phần lớn khách ở đây là công ty bảo hiểm chi trả cho xe tai nạn, nhưng
// dữ liệu gốc không ghi biển số/lệnh sửa xe nào, nên không thể (và không nên bịa) liên kết
// chéo. `partnerName` lưu dạng text snapshot, không FK `customers` — đúng tên trên hoá đơn
// tại thời điểm lập, không đồng bộ ngược khi khách đổi tên.
export const salesLedger = pgTable("sales_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  voucherDate: timestamp("voucher_date", { withTimezone: true }).notNull(), // Ngày chứng từ
  voucherNo: text("voucher_no"), // Số chứng từ
  invoiceNo: text("invoice_no"), // Số hóa đơn
  partnerName: text("partner_name").notNull(), // Khách hàng
  amountBeforeTax: integer("amount_before_tax").notNull().default(0), // Tổng tiền hàng
  vatAmount: integer("vat_amount").notNull().default(0), // Tiền thuế GTGT
  totalAmount: integer("total_amount").notNull().default(0), // Tổng tiền thanh toán
  invoiceIssued: boolean("invoice_issued").notNull().default(false), // Đã lập hóa đơn
  goodsDelivered: boolean("goods_delivered").notNull().default(false), // Đã xuất hàng
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sales_ledger_voucher_date_idx").on(table.voucherDate),
  index("sales_ledger_partner_idx").on(table.partnerName),
]);

// Sổ mua hàng (kế toán) — đối xứng với `salesLedger`, không FK `parts`/`part_transactions`
// vì dữ liệu gốc chỉ có tổng tiền theo hoá đơn mua, không có dòng chi tiết từng phụ tùng.
export const purchaseLedger = pgTable("purchase_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  postingDate: timestamp("posting_date", { withTimezone: true }).notNull(), // Ngày hạch toán
  voucherDate: timestamp("voucher_date", { withTimezone: true }), // Ngày chứng từ
  voucherNo: text("voucher_no"), // Số chứng từ
  invoiceNo: text("invoice_no"), // Số hóa đơn
  partnerName: text("partner_name").notNull(), // Nhà cung cấp
  description: text("description"), // Diễn giải
  amountBeforeTax: integer("amount_before_tax").notNull().default(0), // Tổng tiền hàng
  discountAmount: integer("discount_amount").notNull().default(0), // Tiền chiết khấu
  vatAmount: integer("vat_amount").notNull().default(0), // Tiền thuế GTGT
  totalAmount: integer("total_amount").notNull().default(0), // Tổng tiền thanh toán
  purchaseCost: integer("purchase_cost").notNull().default(0), // Chi phí mua hàng
  inventoryValue: integer("inventory_value").notNull().default(0), // Giá trị nhập kho
  // "not_received" | "received" | "none" — khớp 3 giá trị thật trong sổ gốc (Chưa nhận HĐ /
  // Đã nhận HĐ / Không có HĐ)
  invoiceStatus: text("invoice_status").notNull().default("not_received"),
  isPurchaseCost: boolean("is_purchase_cost").notNull().default(false), // Là chi phí mua hàng
  documentType: text("document_type"), // Loại chứng từ
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("purchase_ledger_posting_date_idx").on(table.postingDate),
  index("purchase_ledger_partner_idx").on(table.partnerName),
  index("purchase_ledger_invoice_status_idx").on(table.invoiceStatus),
]);

// ---------------------------------------------------------------------------
// Chấm công
// ---------------------------------------------------------------------------

// Chấm công KTV — vào ca / ra ca đơn giản, KHÔNG gắn với lệnh sửa chữa cụ thể nào (một ca
// làm việc thường trải trên nhiều lệnh cùng lúc). `actualMinutes` ở service_order_labors là
// giờ công cho TỪNG dòng việc; bảng này là giờ có mặt tại xưởng, hai khái niệm khác nhau.
export const attendanceLogs = pgTable("attendance_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull().defaultNow(),
  // null = đang trong ca. Nghiệp vụ đảm bảo mỗi nhân sự chỉ có tối đa 1 dòng đang mở tại
  // một thời điểm (kiểm tra ở store `attendance.ts`, không ràng buộc được bằng SQL thuần).
  clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
  note: text("note"),
}, (table) => [
  index("attendance_logs_employee_time_idx").on(table.employeeId, table.clockInAt),
]);
