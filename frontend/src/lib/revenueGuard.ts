// Chặn THẤT THOÁT DOANH THU — logic thuần, không import db, có test (`__tests__/revenueGuard.test.ts`).
//
// Vì sao cần: lúc viết, 781/788 phụ tùng có giá bán 0đ. Lệnh sửa chữa đầu tiên gần như chắc
// chắn có dòng 0đ, tức là khách không bị tính tiền vật tư. App cho thêm (không làm kẹt xưởng
// khi quản lý vắng mặt — đã hỏi chủ gara 20/09/2026), nhưng mọi chỗ rò tiền phải hiện lên
// chuông và TỰ ĐÓNG khi đã sửa (sửa giá, bỏ dòng, quản lý duyệt, lập hoá đơn).
//
// Chỉ xét lệnh CHƯA lập hoá đơn và chưa huỷ: lệnh đã có hoá đơn thì tiền đã chốt — phát hiện
// lúc đó chỉ còn là chuyện quá khứ, không sửa được bằng một cú bấm.

import type { IncidentInput } from "@/lib/opsLoop";

const HOUR = 60 * 60 * 1000;

export type GuardLine = {
  kind: "part" | "labor";
  name: string;
  unitPrice: number;
  /** Giá vốn lúc xuất; `null` = chưa biết (không coi là bán lỗ). Dòng công không có. */
  unitCost: number | null;
  quantity: number;
};

export type GuardOrder = {
  id: string;
  code: string;
  plate: string;
  status: string;
  /** Công + phụ tùng, trước giảm giá. */
  subtotal: number;
  discount: number;
  discountApprovedAmount: number | null;
  deliveredAt: Date | null;
  lines: GuardLine[];
};

/**
 * Giảm giá cần quản lý duyệt khi VỪA lớn theo tỷ lệ VỪA đáng kể theo số tiền: giảm 20% của
 * lệnh thay dầu 400.000đ (80.000đ) không đáng làm phiền ai; giảm 12% của lệnh đồng-sơn 30 triệu
 * (3,6 triệu) thì đáng.
 */
export const DISCOUNT_REVIEW = { percent: 10, minAmount: 500_000 } as const;

/** Giao xe rồi mà quá 24 giờ chưa lập hoá đơn = tiền chưa được ghi nhận. */
export const NOT_INVOICED_GRACE_MS = 24 * HOUR;

const vnd = (n: number) => `${new Intl.NumberFormat("vi-VN").format(n)}đ`;
const listNames = (lines: GuardLine[]) =>
  lines
    .slice(0, 5)
    .map((l) => l.name)
    .join("; ") + (lines.length > 5 ? ` và ${lines.length - 5} dòng nữa` : "");

export function zeroPriceLines(lines: GuardLine[]): GuardLine[] {
  return lines.filter((l) => l.unitPrice === 0);
}

export function belowCostLines(lines: GuardLine[]): GuardLine[] {
  return lines.filter((l) => l.kind === "part" && l.unitCost !== null && l.unitPrice > 0 && l.unitPrice < l.unitCost);
}

export function needsDiscountApproval(order: Pick<GuardOrder, "subtotal" | "discount" | "discountApprovedAmount">): boolean {
  if (order.discount <= 0) return false;
  const large =
    order.discount >= DISCOUNT_REVIEW.minAmount &&
    order.subtotal > 0 &&
    (order.discount * 100) / order.subtotal >= DISCOUNT_REVIEW.percent;
  return large && order.discountApprovedAmount !== order.discount;
}

/** Cảnh báo tức thời khi thêm MỘT dòng — trả lời ngay trên màn hình, trước cả chuông. */
export function lineWarning(line: GuardLine): string | null {
  if (line.unitPrice === 0) {
    return `“${line.name}” đang 0đ — khách sẽ không bị tính tiền dòng này. Đã báo quản lý; sửa giá trong kho hoặc bỏ dòng để thông báo tự đóng.`;
  }
  if (line.kind === "part" && line.unitCost !== null && line.unitPrice < line.unitCost) {
    return `“${line.name}” bán ${vnd(line.unitPrice)}, thấp hơn giá vốn ${vnd(line.unitCost)}. Đã báo quản lý.`;
  }
  return null;
}

/**
 * Mọi chỗ rò tiền trên các lệnh đang mở. Khoá theo lệnh + loại lỗi (không theo dòng): sửa
 * xong một dòng mà lệnh vẫn còn dòng 0đ khác thì sự cố vẫn mở, nội dung cập nhật số dòng.
 */
export function detectRevenueLeaks(orders: GuardOrder[], now: Date): IncidentInput[] {
  const out: IncidentInput[] = [];
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const label = `${o.code} (${o.plate})`;
    const href = `/dashboard/orders/${o.id}`;

    const zero = zeroPriceLines(o.lines);
    if (zero.length > 0) {
      out.push({
        key: `revenue:order:${o.id}:zero`,
        severity: "high",
        title: `${label}: ${zero.length} dòng 0đ`,
        body: `${listNames(zero)}. Khách không bị tính tiền các dòng này. Điền giá bán (Kho phụ tùng / Bảng giá dịch vụ) rồi bỏ dòng và thêm lại, hoặc bỏ dòng nếu thật sự miễn phí.`,
        href,
      });
    }

    const below = belowCostLines(o.lines);
    if (below.length > 0) {
      out.push({
        key: `revenue:order:${o.id}:below-cost`,
        severity: "normal",
        title: `${label}: ${below.length} dòng bán dưới giá vốn`,
        body: below
          .slice(0, 5)
          .map((l) => `${l.name}: bán ${vnd(l.unitPrice)} < vốn ${vnd(l.unitCost ?? 0)}`)
          .join("; "),
        href,
      });
    }

    if (needsDiscountApproval(o)) {
      const pct = Math.round((o.discount * 100) / o.subtotal);
      out.push({
        key: `revenue:order:${o.id}:discount`,
        severity: "normal",
        title: `${label}: giảm giá ${pct}% (${vnd(o.discount)}) chờ quản lý duyệt`,
        body: `Giảm từ ${DISCOUNT_REVIEW.percent}% và từ ${vnd(DISCOUNT_REVIEW.minAmount)} trở lên cần quản lý duyệt. Mở lệnh → "Duyệt giảm giá"; sửa số tiền giảm thì phải duyệt lại.`,
        href,
      });
    }

    if (o.status === "delivered" && o.deliveredAt && now.getTime() - o.deliveredAt.getTime() > NOT_INVOICED_GRACE_MS) {
      const days = Math.floor((now.getTime() - o.deliveredAt.getTime()) / (24 * HOUR));
      out.push({
        key: `revenue:order:${o.id}:not-invoiced`,
        severity: "high",
        title: `${label}: đã giao xe ${days >= 1 ? `${days} ngày` : "hơn 24 giờ"} nhưng chưa lập hoá đơn`,
        body: `Tổng lệnh ${vnd(Math.max(0, o.subtotal - o.discount))} chưa được ghi nhận doanh thu. Vào Hoá đơn → Xuất hoá đơn cho lệnh này.`,
        href: "/dashboard/invoices",
      });
    }
  }
  return out;
}
