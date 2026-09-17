import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, invoices, parts, salesLedger, serviceOrders, vehicles } from "@/server/db/schema";
import type { UserFlow } from "@/server/session";
import { normalizePlate } from "@/server/store/vehicles";

// Tìm kiếm nhanh ở Topbar — trước đây ô tìm kiếm chỉ là hình vẽ, gõ vào không làm gì.
//
// Kết quả phụ thuộc LUỒNG người dùng, không chỉ đăng nhập hay chưa: KTV không có trang khách
// hàng hay hoá đơn, nên trả về những thứ đó là chìa ra dữ liệu mà menu của họ cố ý giấu.

export type SearchHit = {
  group: "Lệnh sửa chữa" | "Xe" | "Khách hàng" | "Hoá đơn" | "Phụ tùng" | "Sổ bán hàng";
  title: string;
  subtitle: string;
  href: string;
};

const PER_GROUP = 5;

export async function globalSearch(rawTerm: string, flow: UserFlow): Promise<SearchHit[]> {
  const term = rawTerm.trim();
  // Dưới 2 ký tự thì mọi thứ đều khớp — trả cả trăm dòng vô nghĩa và quét toàn bảng.
  if (term.length < 2 || flow === "technician") return [];

  const like = `%${term}%`;
  // Biển số lưu đã chuẩn hoá ("30A12345"), người dùng gõ "30A-123.45" — phải chuẩn hoá cả
  // chuỗi tìm, nếu không thì tìm biển số, đúng thứ hay tìm nhất, lại không bao giờ ra.
  const plateLike = `%${normalizePlate(term)}%`;

  if (flow === "accountant") {
    const [invoiceRows, ledgerRows] = await Promise.all([searchInvoices(like, plateLike), searchSalesLedger(like)]);
    return [...invoiceRows, ...ledgerRows];
  }

  const [orderRows, vehicleRows, customerRows, invoiceRows, partRows, ledgerRows] = await Promise.all([
    db
      .select({
        id: serviceOrders.id,
        code: serviceOrders.code,
        plate: serviceOrders.plateSnapshot,
        status: serviceOrders.status,
      })
      .from(serviceOrders)
      .where(or(ilike(serviceOrders.code, like), ilike(serviceOrders.plateSnapshot, plateLike)))
      .orderBy(desc(serviceOrders.receivedAt))
      .limit(PER_GROUP),
    db
      .select({
        id: vehicles.id,
        plate: vehicles.licensePlate,
        make: vehicles.make,
        model: vehicles.model,
        customerName: customers.name,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(or(ilike(vehicles.licensePlate, plateLike), ilike(vehicles.vin, like)))
      .limit(PER_GROUP),
    db
      .select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers)
      .where(or(ilike(customers.name, like), ilike(customers.phone, like)))
      .limit(PER_GROUP),
    searchInvoices(like, plateLike),
    db
      .select({ id: parts.id, code: parts.code, name: parts.name, stock: parts.stock, unit: parts.unit })
      .from(parts)
      .where(or(ilike(parts.code, like), ilike(parts.name, like), ilike(parts.oemNumber, like)))
      .limit(PER_GROUP),
    // Quản lý cũng tìm được sổ bán hàng: hôm nay mảng sửa xe chưa có lệnh nào, còn sổ bán có
    // 232 chứng từ thật — tìm "bảo hiểm" mà không ra gì là ô tìm kiếm vô dụng đúng lúc cần.
    searchSalesLedger(like),
  ]);

  return [
    ...orderRows.map((o) => ({
      group: "Lệnh sửa chữa" as const,
      title: o.code,
      subtitle: o.plate,
      href: `/dashboard/orders/${o.id}`,
    })),
    ...vehicleRows.map((v) => ({
      group: "Xe" as const,
      title: v.plate,
      subtitle: `${v.make} ${v.model}${v.customerName ? ` · ${v.customerName}` : ""}`,
      href: `/dashboard/vehicles`,
    })),
    ...customerRows.map((c) => ({
      group: "Khách hàng" as const,
      title: c.name,
      subtitle: c.phone ?? "chưa có số điện thoại",
      href: `/dashboard/customers`,
    })),
    ...invoiceRows,
    ...partRows.map((p) => ({
      group: "Phụ tùng" as const,
      title: `${p.code} · ${p.name}`,
      subtitle: `Tồn ${p.stock} ${p.unit}`,
      href: `/dashboard/parts`,
    })),
    ...ledgerRows,
  ];
}

async function searchSalesLedger(like: string): Promise<SearchHit[]> {
  const rows = await db
    .select({
      partnerName: salesLedger.partnerName,
      voucherNo: salesLedger.voucherNo,
      totalAmount: salesLedger.totalAmount,
    })
    .from(salesLedger)
    .where(or(ilike(salesLedger.partnerName, like), ilike(salesLedger.voucherNo, like), ilike(salesLedger.invoiceNo, like)))
    .orderBy(desc(salesLedger.voucherDate))
    .limit(PER_GROUP);
  return rows.map((r) => ({
    group: "Sổ bán hàng" as const,
    title: r.partnerName,
    subtitle: `${r.voucherNo ?? "không số"} · ${r.totalAmount.toLocaleString("vi-VN")}₫`,
    href: `/dashboard/sales-ledger`,
  }));
}

async function searchInvoices(like: string, plateLike: string): Promise<SearchHit[]> {
  const rows = await db
    .select({
      id: invoices.id,
      code: invoices.code,
      customerName: invoices.customerName,
      total: invoices.total,
    })
    .from(invoices)
    .where(or(ilike(invoices.code, like), ilike(invoices.customerName, like), ilike(invoices.plateSnapshot, plateLike)))
    .orderBy(desc(invoices.issuedAt))
    .limit(PER_GROUP);
  return rows.map((i) => ({
    group: "Hoá đơn" as const,
    title: i.code,
    subtitle: `${i.customerName} · ${i.total.toLocaleString("vi-VN")}₫`,
    href: `/in/hoa-don/${i.id}`,
  }));
}
