import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import {
  branches,
  companySettings,
  customers,
  employees,
  parts,
  partTransactions,
  serviceOrderLabors,
  serviceOrderParts,
  serviceOrders,
  serviceOrderSpecialOrders,
  vehicles,
} from "@/server/db/schema";
import { ACTIVE_ORDER_STATUSES, type ServiceOrderStatus } from "@/server/domain";
import { nextServiceOrderCode } from "@/server/store/codes";
import { InsufficientStockError } from "@/server/store/parts";

// Kiểu của handle transaction do Drizzle truyền vào callback. Không dùng `typeof db` được:
// `PgTransaction` và `NeonDatabase` là hai kiểu khác nhau dù cùng API truy vấn.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ServiceOrder = typeof serviceOrders.$inferSelect;
export type ServiceOrderLabor = typeof serviceOrderLabors.$inferSelect;
export type ServiceOrderPart = typeof serviceOrderParts.$inferSelect;

// Trạng thái mà lệnh được coi là đã chốt — không cho sửa dòng công/phụ tùng nữa. Sửa nội
// dung một lệnh đã giao xe (và đã xuất hoá đơn) sẽ làm doanh thu đã báo cáo lệch đi.
const LOCKED_STATUSES: ServiceOrderStatus[] = ["delivered", "cancelled"];

export class OrderLockedError extends Error {
  constructor() {
    super("Lệnh đã giao xe hoặc đã huỷ nên không sửa được nội dung nữa.");
    this.name = "OrderLockedError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Không tìm thấy lệnh sửa chữa.");
    this.name = "OrderNotFoundError";
  }
}

export class CrossBranchError extends Error {
  constructor() {
    super("Phụ tùng thuộc chi nhánh khác với chi nhánh của lệnh sửa chữa.");
    this.name = "CrossBranchError";
  }
}

// --- Đọc ---

export type ServiceOrderListItem = {
  id: string;
  code: string;
  status: string;
  plateSnapshot: string;
  receivedAt: Date;
  promisedAt: Date | null;
  total: number;
  customerName: string | null;
  customerPhone: string | null;
  vehicleLabel: string;
  branchName: string;
  advisorName: string | null;
  hasInvoice: boolean;
};

export async function listServiceOrders(options?: {
  search?: string;
  status?: string;
  activeOnly?: boolean;
}): Promise<ServiceOrderListItem[]> {
  const conditions = [];
  const term = options?.search?.trim();
  if (term) {
    conditions.push(
      or(
        ilike(serviceOrders.code, `%${term}%`),
        ilike(serviceOrders.plateSnapshot, `%${term.replace(/[\s.\-_]/g, "").toUpperCase()}%`),
        ilike(customers.name, `%${term}%`),
      )!,
    );
  }
  if (options?.status) conditions.push(eq(serviceOrders.status, options.status));
  if (options?.activeOnly) conditions.push(inArray(serviceOrders.status, ACTIVE_ORDER_STATUSES));

  return db
    .select({
      id: serviceOrders.id,
      code: serviceOrders.code,
      status: serviceOrders.status,
      plateSnapshot: serviceOrders.plateSnapshot,
      receivedAt: serviceOrders.receivedAt,
      promisedAt: serviceOrders.promisedAt,
      total: serviceOrders.total,
      customerName: customers.name,
      customerPhone: customers.phone,
      vehicleLabel: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      branchName: branches.name,
      advisorName: employees.name,
      hasInvoice: sql<boolean>`exists (
        select 1 from invoices where invoices.service_order_id = ${serviceOrders.id}
      )`,
    })
    .from(serviceOrders)
    .innerJoin(vehicles, eq(serviceOrders.vehicleId, vehicles.id))
    .innerJoin(branches, eq(serviceOrders.branchId, branches.id))
    .leftJoin(customers, eq(serviceOrders.customerId, customers.id))
    .leftJoin(employees, eq(serviceOrders.advisorId, employees.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(serviceOrders.receivedAt));
}

export type TechnicianJob = {
  laborId: string;
  serviceOrderId: string;
  orderCode: string;
  orderStatus: string;
  plateSnapshot: string;
  vehicleLabel: string;
  branchName: string | null;
  name: string;
  status: string;
  standardMinutes: number | null;
  actualMinutes: number | null;
  note: string | null;
  createdAt: Date;
};

// Việc đã giao cho một KTV cụ thể, gộp từ mọi lệnh còn hoạt động — trang "Khu vực nhận
// việc" của KTV cần nhìn xuyên lệnh, khác mọi hàm khác trong file này vốn luôn xoay quanh
// đúng 1 lệnh. Không gồm lệnh đã huỷ: việc trên lệnh huỷ không còn ai phải làm.
export async function listLaborsForTechnician(technicianId: string): Promise<TechnicianJob[]> {
  const laborBranch = alias(branches, "labor_branch");
  return db
    .select({
      laborId: serviceOrderLabors.id,
      serviceOrderId: serviceOrders.id,
      orderCode: serviceOrders.code,
      orderStatus: serviceOrders.status,
      plateSnapshot: serviceOrders.plateSnapshot,
      vehicleLabel: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      branchName: laborBranch.name,
      name: serviceOrderLabors.name,
      status: serviceOrderLabors.status,
      standardMinutes: serviceOrderLabors.standardMinutes,
      actualMinutes: serviceOrderLabors.actualMinutes,
      note: serviceOrderLabors.note,
      createdAt: serviceOrderLabors.createdAt,
    })
    .from(serviceOrderLabors)
    .innerJoin(serviceOrders, eq(serviceOrderLabors.serviceOrderId, serviceOrders.id))
    .innerJoin(vehicles, eq(serviceOrders.vehicleId, vehicles.id))
    .leftJoin(laborBranch, eq(serviceOrderLabors.branchId, laborBranch.id))
    .where(
      and(
        eq(serviceOrderLabors.technicianId, technicianId),
        sql`${serviceOrders.status} != 'cancelled'`,
      ),
    )
    .orderBy(desc(serviceOrderLabors.createdAt));
}

export type AwaitingAcceptanceItem = {
  code: string;
  plateSnapshot: string;
  vehicleLabel: string;
  daysWaiting: number;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
};

// Lệnh đang ở "chờ nghiệm thu" quá `minDays` ngày kể từ lần cập nhật gần nhất — xe đã sửa
// xong, khách đã được báo 1 lần qua order_status_update, nhưng nếu quên không tới thì xe cứ
// chiếm chỗ xưởng mà không ai nhắc lại. Dùng cho quy tắc tự động awaiting_acceptance_reminder.
//
// Mốc tính là `updatedAt` (không có cột riêng "lúc vào trạng thái chờ nghiệm thu") — sửa một
// trường bất kỳ khác (ghi chú, giảm giá...) trong lúc đang chờ cũng làm mốc này nhích lên,
// nên "số ngày chờ" có thể thấp hơn thực tế một chút trong trường hợp hiếm đó.
export async function listOrdersAwaitingAcceptanceTooLong(
  minDays: number,
): Promise<AwaitingAcceptanceItem[]> {
  return db
    .select({
      code: serviceOrders.code,
      plateSnapshot: serviceOrders.plateSnapshot,
      vehicleLabel: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      daysWaiting: sql<number>`floor(extract(epoch from (now() - ${serviceOrders.updatedAt})) / 86400)::int`,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
    })
    .from(serviceOrders)
    .innerJoin(vehicles, eq(serviceOrders.vehicleId, vehicles.id))
    .leftJoin(customers, eq(serviceOrders.customerId, customers.id))
    .where(
      and(
        eq(serviceOrders.status, "awaiting_acceptance"),
        sql`${serviceOrders.updatedAt} <= now() - (${minDays} || ' days')::interval`,
      ),
    )
    .orderBy(desc(serviceOrders.updatedAt));
}

export async function getServiceOrderById(id: string) {
  const [order] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, id)).limit(1);
  if (!order) return undefined;

  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, order.vehicleId)).limit(1);
  const customer = order.customerId
    ? (await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1))[0]
    : undefined;
  const [branch] = await db.select().from(branches).where(eq(branches.id, order.branchId)).limit(1);

  // `branchesAlias` vì `branches` đã dùng để join xưởng TIẾP NHẬN của cả lệnh — cần một
  // alias riêng cho xưởng THỰC HIỆN từng dòng công, kẻo Postgres báo lỗi join trùng bảng.
  const laborBranch = alias(branches, "labor_branch");
  const labors = await db
    .select({
      id: serviceOrderLabors.id,
      serviceId: serviceOrderLabors.serviceId,
      name: serviceOrderLabors.name,
      branchId: serviceOrderLabors.branchId,
      branchName: laborBranch.name,
      technicianId: serviceOrderLabors.technicianId,
      technicianName: employees.name,
      unitPrice: serviceOrderLabors.unitPrice,
      quantity: serviceOrderLabors.quantity,
      lineTotal: serviceOrderLabors.lineTotal,
      standardMinutes: serviceOrderLabors.standardMinutes,
      actualMinutes: serviceOrderLabors.actualMinutes,
      status: serviceOrderLabors.status,
      note: serviceOrderLabors.note,
    })
    .from(serviceOrderLabors)
    .leftJoin(employees, eq(serviceOrderLabors.technicianId, employees.id))
    .leftJoin(laborBranch, eq(serviceOrderLabors.branchId, laborBranch.id))
    .where(eq(serviceOrderLabors.serviceOrderId, id));

  const orderParts = await db
    .select()
    .from(serviceOrderParts)
    .where(eq(serviceOrderParts.serviceOrderId, id));

  const specialOrders = await db
    .select()
    .from(serviceOrderSpecialOrders)
    .where(eq(serviceOrderSpecialOrders.serviceOrderId, id))
    .orderBy(desc(serviceOrderSpecialOrders.orderedAt));

  return { order, vehicle, customer, branch, labors, parts: orderParts, specialOrders };
}

// --- Tính tổng ---

// Tính lại 4 cột tổng từ các dòng hiện có, trong CÙNG transaction với thao tác vừa sửa
// dòng. Cột tổng lưu sẵn để danh sách và báo cáo không phải join 2 bảng con (xem
// ARCHITECTURE mục 4.2) — cái giá phải trả là mọi đường ghi đều bắt buộc gọi hàm này.
async function recalcTotals(tx: Tx, orderId: string) {
  const [laborRow] = await tx
    .select({ total: sql<number>`coalesce(sum(${serviceOrderLabors.lineTotal}), 0)::int` })
    .from(serviceOrderLabors)
    .where(eq(serviceOrderLabors.serviceOrderId, orderId));

  const [partRow] = await tx
    .select({ total: sql<number>`coalesce(sum(${serviceOrderParts.lineTotal}), 0)::int` })
    .from(serviceOrderParts)
    .where(eq(serviceOrderParts.serviceOrderId, orderId));

  const [current] = await tx
    .select({ discount: serviceOrders.discount })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, orderId));

  const laborTotal = laborRow?.total ?? 0;
  const partsTotal = partRow?.total ?? 0;
  const discount = current?.discount ?? 0;

  await tx
    .update(serviceOrders)
    .set({
      laborTotal,
      partsTotal,
      // Giảm giá không được đẩy tổng xuống âm — nhập nhầm một số 0 là ra hoá đơn âm tiền.
      total: Math.max(0, laborTotal + partsTotal - discount),
      updatedAt: new Date(),
    })
    .where(eq(serviceOrders.id, orderId));
}

// --- Tạo lệnh ---

export async function createServiceOrder(input: {
  branchId: string;
  vehicleId: string;
  customerId?: string | null;
  advisorId?: string | null;
  odometerIn?: number | null;
  customerComplaint?: string | null;
  promisedAt?: Date | null;
  note?: string | null;
}) {
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, input.vehicleId)).limit(1);
  if (!vehicle) throw new Error("Không tìm thấy xe.");

  const code = await nextServiceOrderCode();

  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(serviceOrders)
      .values({
        code,
        branchId: input.branchId,
        vehicleId: input.vehicleId,
        // Chưa chọn khách thì lấy chủ xe hiện tại — lễ tân không phải nhập lại thứ hệ
        // thống đã biết.
        customerId: input.customerId ?? vehicle.customerId,
        advisorId: input.advisorId ?? null,
        plateSnapshot: vehicle.licensePlate,
        odometerIn: input.odometerIn ?? null,
        customerComplaint: input.customerComplaint ?? null,
        promisedAt: input.promisedAt ?? null,
        note: input.note ?? null,
      })
      .returning();

    // Số km lúc tiếp nhận là số mới nhất ta biết về chiếc xe — cập nhật luôn vào hồ sơ,
    // nhưng chỉ khi nó LỚN HƠN số đang lưu: gõ nhầm thiếu một chữ số không được phép làm
    // lùi đồng hồ và phá luôn mốc bảo dưỡng tính theo km.
    if (input.odometerIn && (!vehicle.odometer || input.odometerIn > vehicle.odometer)) {
      await tx
        .update(vehicles)
        .set({ odometer: input.odometerIn })
        .where(eq(vehicles.id, input.vehicleId));
    }

    return order;
  });
}

// Đặt mốc bảo dưỡng kế tiếp cho xe. Gọi lúc GIAO XE — đó là thời điểm duy nhất ta chắc
// chắn dịch vụ đã hoàn tất và biết số km cuối cùng.
//
// Tính sẵn và lưu vào hồ sơ xe thay vì suy ra lúc chạy, để quy tắc "nhắc bảo dưỡng" trả
// lời được "xe nào tới hạn" bằng một câu WHERE (xem ARCHITECTURE mục 4.2).
async function applyMaintenanceMilestone(tx: Tx, vehicleId: string, odometerIn: number | null) {
  const [settings] = await tx.select().from(companySettings).limit(1);
  if (!settings) return;

  const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return;

  const nextServiceAt = new Date();
  nextServiceAt.setDate(nextServiceAt.getDate() + settings.maintenanceIntervalDays);

  // Mốc km tính từ số km lớn nhất đã biết. Nếu chưa biết km nào thì để null thay vì lấy
  // 0 + chu kỳ — mốc "5.000 km" cho chiếc xe đã chạy 80.000 km sẽ báo tới hạn ngay lập tức.
  const baseOdometer = Math.max(odometerIn ?? 0, vehicle.odometer ?? 0);
  const nextServiceOdometer = baseOdometer > 0 ? baseOdometer + settings.maintenanceIntervalKm : null;

  await tx
    .update(vehicles)
    .set({ nextServiceAt, nextServiceOdometer })
    .where(eq(vehicles.id, vehicleId));
}

export async function updateServiceOrder(
  id: string,
  patch: Partial<{
    status: ServiceOrderStatus;
    advisorId: string | null;
    diagnosis: string | null;
    customerComplaint: string | null;
    promisedAt: Date | null;
    discount: number;
    note: string | null;
    completedAt: Date | null;
    deliveredAt: Date | null;
  }>,
) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .update(serviceOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(serviceOrders.id, id))
      .returning();

    // Đổi giảm giá thì tổng phải tính lại — nếu không, cột `total` giữ nguyên số cũ và
    // hoá đơn lập sau sẽ lấy đúng con số sai đó.
    if (patch.discount !== undefined) await recalcTotals(tx, id);

    if (patch.status === "delivered" && order) {
      await applyMaintenanceMilestone(tx, order.vehicleId, order.odometerIn);
    }

    return order;
  });
}

async function assertUnlocked(tx: Tx, orderId: string) {
  const [order] = await tx
    .select({ status: serviceOrders.status, branchId: serviceOrders.branchId })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, orderId))
    .limit(1);
  if (!order) throw new OrderNotFoundError();
  if (LOCKED_STATUSES.includes(order.status as ServiceOrderStatus)) throw new OrderLockedError();
  return order;
}

// --- Dòng công ---

export async function addLabor(
  orderId: string,
  input: {
    serviceId?: string | null;
    name: string;
    // Xưởng thực hiện dòng công này. `undefined` = chưa rõ, sẽ điền bằng xưởng tiếp nhận
    // của cả lệnh (xem bên dưới) — đúng cho gara chỉ có 1 xưởng, hoặc dòng công không cần
    // phân biệt. Truyền tường minh khi xe cần cả xưởng máy lẫn xưởng sơn trong 1 lệnh.
    branchId?: string | null;
    technicianId?: string | null;
    unitPrice: number;
    quantity: number;
    standardMinutes?: number | null;
    note?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const order = await assertUnlocked(tx, orderId);

    const [labor] = await tx
      .insert(serviceOrderLabors)
      .values({
        serviceOrderId: orderId,
        serviceId: input.serviceId ?? null,
        name: input.name,
        branchId: input.branchId !== undefined ? input.branchId : order.branchId,
        technicianId: input.technicianId ?? null,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        lineTotal: input.unitPrice * input.quantity,
        standardMinutes: input.standardMinutes ?? null,
        note: input.note ?? null,
      })
      .returning();

    await recalcTotals(tx, orderId);
    return labor;
  });
}

export async function updateLabor(
  laborId: string,
  patch: Partial<{
    branchId: string | null;
    technicianId: string | null;
    status: string;
    actualMinutes: number | null;
    unitPrice: number;
    quantity: number;
    note: string | null;
  }>,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(serviceOrderLabors)
      .where(eq(serviceOrderLabors.id, laborId))
      .limit(1);
    if (!existing) throw new Error("Không tìm thấy dòng công.");
    await assertUnlocked(tx, existing.serviceOrderId);

    const unitPrice = patch.unitPrice ?? existing.unitPrice;
    const quantity = patch.quantity ?? existing.quantity;

    const [labor] = await tx
      .update(serviceOrderLabors)
      .set({ ...patch, unitPrice, quantity, lineTotal: unitPrice * quantity })
      .where(eq(serviceOrderLabors.id, laborId))
      .returning();

    await recalcTotals(tx, existing.serviceOrderId);
    return labor;
  });
}

export async function removeLabor(laborId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(serviceOrderLabors)
      .where(eq(serviceOrderLabors.id, laborId))
      .limit(1);
    if (!existing) return;
    await assertUnlocked(tx, existing.serviceOrderId);

    await tx.delete(serviceOrderLabors).where(eq(serviceOrderLabors.id, laborId));
    await recalcTotals(tx, existing.serviceOrderId);
  });
}

// --- Dòng phụ tùng (chạm vào kho) ---

// Thêm phụ tùng vào lệnh làm BỐN việc phải cùng thành hoặc cùng bại:
//   1. kiểm tra + trừ tồn kho
//   2. ghi phiếu xuất kho gắn với lệnh này
//   3. thêm dòng phụ tùng vào lệnh (snapshot tên/giá/giá vốn)
//   4. tính lại tổng tiền của lệnh
// Thiếu bất kỳ bước nào là sổ sách lệch: trừ kho mà không có dòng trên lệnh thì hàng biến
// mất không ai trả tiền; có dòng mà không trừ kho thì kiểm kê thiếu hàng không rõ lý do.
export async function addPart(
  orderId: string,
  input: { partId: string; quantity: number; unitPrice?: number },
) {
  return db.transaction(async (tx) => {
    const order = await assertUnlocked(tx, orderId);

    const [part] = await tx
      .select()
      .from(parts)
      .where(eq(parts.id, input.partId))
      .limit(1)
      // Khoá dòng tới hết transaction: hai lệnh cùng lấy một mã phụ tùng tồn 5, cùng đọc
      // rồi cùng trừ 3, sẽ ra 2 thay vì âm 1 nếu không khoá.
      .for("update");
    if (!part) throw new Error("Không tìm thấy phụ tùng.");
    if (part.branchId !== order.branchId) throw new CrossBranchError();

    if (part.stock < input.quantity) {
      throw new InsufficientStockError(part.name, part.stock, input.quantity);
    }

    const unitPrice = input.unitPrice ?? part.price;

    await tx
      .update(parts)
      .set({ stock: part.stock - input.quantity, updatedAt: new Date() })
      .where(eq(parts.id, input.partId));

    await tx.insert(partTransactions).values({
      partId: input.partId,
      type: "export",
      quantity: input.quantity,
      unitCost: part.cost,
      serviceOrderId: orderId,
      counterparty: "Xuất cho lệnh sửa chữa",
    });

    const [line] = await tx
      .insert(serviceOrderParts)
      .values({
        serviceOrderId: orderId,
        partId: input.partId,
        name: part.name,
        unit: part.unit,
        unitPrice,
        unitCost: part.cost,
        quantity: input.quantity,
        lineTotal: unitPrice * input.quantity,
      })
      .returning();

    await recalcTotals(tx, orderId);
    return line;
  });
}

// Bỏ dòng phụ tùng khỏi lệnh phải TRẢ HÀNG VỀ KHO, và ghi một phiếu nhập đối ứng thay vì
// xoá phiếu xuất cũ: phiếu xuất ghi lại một việc đã thực sự xảy ra, xoá nó đi là sửa lịch sử.
export async function removePart(linePartId: string) {
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(serviceOrderParts)
      .where(eq(serviceOrderParts.id, linePartId))
      .limit(1);
    if (!line) return;
    await assertUnlocked(tx, line.serviceOrderId);

    if (line.partId) {
      const [part] = await tx
        .select()
        .from(parts)
        .where(eq(parts.id, line.partId))
        .limit(1)
        .for("update");
      if (part) {
        await tx
          .update(parts)
          .set({ stock: part.stock + line.quantity, updatedAt: new Date() })
          .where(eq(parts.id, line.partId));

        await tx.insert(partTransactions).values({
          partId: line.partId,
          type: "import",
          quantity: line.quantity,
          unitCost: line.unitCost,
          serviceOrderId: line.serviceOrderId,
          counterparty: "Trả lại kho (bỏ khỏi lệnh sửa chữa)",
        });
      }
    }

    await tx.delete(serviceOrderParts).where(eq(serviceOrderParts.id, linePartId));
    await recalcTotals(tx, line.serviceOrderId);
  });
}
