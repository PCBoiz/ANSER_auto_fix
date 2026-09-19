import { inArray, sql } from "drizzle-orm";
import { detectRevenueLeaks, type GuardLine, type GuardOrder } from "@/lib/revenueGuard";
import { db } from "@/server/db/client";
import { invoices, serviceOrderLabors, serviceOrderParts, serviceOrders } from "@/server/db/schema";
import { syncIncidents, type IncidentSyncResult } from "@/server/store/notifications";

// Nửa "chạm DB" của bộ chặn thất thoát — logic phát hiện nằm ở `lib/revenueGuard.ts`.
//
// Chạy ở hai chỗ:
//   - NGAY sau mỗi lần sửa lệnh (thêm/bỏ dòng, đổi giảm giá, đổi trạng thái, lập hoá đơn),
//     qua `after()` của Next — người dùng không phải chờ, chuông có ngay;
//   - trong mỗi lượt canh gác — bắt nốt những gì đổi theo thời gian (giao xe quá 24 giờ chưa
//     lập hoá đơn) và tự đóng những gì đã được sửa ở chỗ khác.

/** Lệnh chưa huỷ và chưa có hoá đơn, kèm mọi dòng công/phụ tùng. */
export async function loadGuardOrders(): Promise<GuardOrder[]> {
  const orders = await db
    .select({
      id: serviceOrders.id,
      code: serviceOrders.code,
      plate: serviceOrders.plateSnapshot,
      status: serviceOrders.status,
      laborTotal: serviceOrders.laborTotal,
      partsTotal: serviceOrders.partsTotal,
      discount: serviceOrders.discount,
      discountApprovedAmount: serviceOrders.discountApprovedAmount,
      deliveredAt: serviceOrders.deliveredAt,
    })
    .from(serviceOrders)
    .where(
      sql`${serviceOrders.status} <> 'cancelled' and not exists (select 1 from ${invoices} where ${invoices.serviceOrderId} = ${serviceOrders.id})`,
    );
  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);
  const [partRows, laborRows] = await Promise.all([
    db
      .select({
        orderId: serviceOrderParts.serviceOrderId,
        name: serviceOrderParts.name,
        unitPrice: serviceOrderParts.unitPrice,
        unitCost: serviceOrderParts.unitCost,
        quantity: serviceOrderParts.quantity,
      })
      .from(serviceOrderParts)
      .where(inArray(serviceOrderParts.serviceOrderId, ids)),
    db
      .select({
        orderId: serviceOrderLabors.serviceOrderId,
        name: serviceOrderLabors.name,
        unitPrice: serviceOrderLabors.unitPrice,
        quantity: serviceOrderLabors.quantity,
      })
      .from(serviceOrderLabors)
      .where(inArray(serviceOrderLabors.serviceOrderId, ids)),
  ]);

  const linesByOrder = new Map<string, GuardLine[]>();
  const push = (orderId: string, line: GuardLine) => {
    const list = linesByOrder.get(orderId) ?? [];
    list.push(line);
    linesByOrder.set(orderId, list);
  };
  for (const p of partRows) push(p.orderId, { kind: "part", name: p.name, unitPrice: p.unitPrice, unitCost: p.unitCost, quantity: p.quantity });
  for (const l of laborRows) push(l.orderId, { kind: "labor", name: l.name, unitPrice: l.unitPrice, unitCost: null, quantity: l.quantity });

  return orders.map((o) => ({
    id: o.id,
    code: o.code,
    plate: o.plate,
    status: o.status,
    subtotal: o.laborTotal + o.partsTotal,
    discount: o.discount,
    discountApprovedAmount: o.discountApprovedAmount,
    deliveredAt: o.deliveredAt,
    lines: linesByOrder.get(o.id) ?? [],
  }));
}

export async function syncRevenueIncidents(now = new Date()): Promise<IncidentSyncResult> {
  const orders = await loadGuardOrders();
  return syncIncidents("revenue", "manager", detectRevenueLeaks(orders, now));
}

/** Cho route: không bao giờ throw — chuông chậm một nhịp còn hơn làm hỏng thao tác của người dùng. */
export async function syncRevenueIncidentsSafe() {
  try {
    await syncRevenueIncidents();
  } catch (error) {
    console.error("[revenue-guard] Không đồng bộ được sự cố thất thoát:", error);
  }
}
