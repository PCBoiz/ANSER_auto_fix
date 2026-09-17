import { z } from "zod";
import { dateField, optionalDate, optionalText, requiredText, vndAmount } from "@/server/validation";

// Lược đồ validate cho sổ bán hàng / sổ mua hàng — dùng chung giữa POST (tạo) và PATCH
// (sửa), để hai đường ghi không bao giờ chấp nhận hai bộ quy tắc khác nhau.
//
// CỐ Ý KHÔNG ép `trước thuế + VAT = tổng`. Đã đo trên dữ liệu thật (17/09/2026):
//   - Sổ bán: 213/232 chứng từ KHÔNG thoả công thức đó. Cả 232 đều VAT = 0, và tổng thấp
//     hơn trước thuế đúng 0,6% hoặc 0,2%. Khớp mức giảm 20% tỷ lệ % tính thuế GTGT theo
//     phương pháp TRỰC TIẾP (dịch vụ gắn hàng hoá 3% -> giảm 0,6%; bán hàng hoá 1% -> giảm
//     0,2%) theo các nghị quyết giảm thuế 2023–2025.
//   - Sổ mua: 8/136 chứng từ lệch đúng 0,2% — nhà cung cấp cũng nộp thuế trực tiếp.
// Tức là dữ liệu gốc ĐÚNG; bảng chỉ thiếu một cột "tiền thuế được giảm". Ép công thức ở
// đây sẽ chặn luôn việc sửa lỗi chính tả trên 213 chứng từ hợp lệ.
//
// BẪY ZOD 4 — vì sao có hai tầng "gốc" và "tạo": `.partial()` KHÔNG bỏ `.default()`.
// `z.object({ vat: z.number().default(0) }).partial().parse({})` vẫn ra `{ vat: 0 }`
// (đã chạy thử). Nếu suy bản PATCH từ bản có default, thì PATCH chỉ sửa tên khách sẽ
// lặng lẽ đặt VAT, tổng tiền và mọi cờ về 0/false — sửa một lỗi chính tả là mất số liệu.
// Nên bản PATCH suy từ tầng gốc KHÔNG có default, còn default chỉ gắn ở bản tạo.

const salesBase = {
  voucherDate: dateField,
  voucherNo: optionalText(50),
  invoiceNo: optionalText(50),
  partnerName: requiredText("Tên khách hàng", 300),
  amountBeforeTax: vndAmount,
  vatAmount: vndAmount,
  totalAmount: vndAmount,
  invoiceIssued: z.boolean(),
  goodsDelivered: z.boolean(),
  note: optionalText(1000),
};

export const salesLedgerSchema = z.object({
  ...salesBase,
  amountBeforeTax: vndAmount.default(0),
  vatAmount: vndAmount.default(0),
  totalAmount: vndAmount.default(0),
  invoiceIssued: z.boolean().default(false),
  goodsDelivered: z.boolean().default(false),
});

export const salesLedgerPatchSchema = z.object(salesBase).partial();

export const INVOICE_STATUSES = ["not_received", "received", "none"] as const;

const purchaseBase = {
  postingDate: dateField,
  voucherDate: optionalDate,
  voucherNo: optionalText(50),
  invoiceNo: optionalText(50),
  partnerName: requiredText("Tên nhà cung cấp", 300),
  description: optionalText(1000),
  amountBeforeTax: vndAmount,
  discountAmount: vndAmount,
  vatAmount: vndAmount,
  totalAmount: vndAmount,
  purchaseCost: vndAmount,
  inventoryValue: vndAmount,
  invoiceStatus: z.enum(INVOICE_STATUSES),
  isPurchaseCost: z.boolean(),
  documentType: optionalText(100),
  note: optionalText(1000),
};

export const purchaseLedgerSchema = z.object({
  ...purchaseBase,
  amountBeforeTax: vndAmount.default(0),
  discountAmount: vndAmount.default(0),
  vatAmount: vndAmount.default(0),
  totalAmount: vndAmount.default(0),
  purchaseCost: vndAmount.default(0),
  inventoryValue: vndAmount.default(0),
  invoiceStatus: z.enum(INVOICE_STATUSES).default("not_received"),
  isPurchaseCost: z.boolean().default(false),
});

export const purchaseLedgerPatchSchema = z.object(purchaseBase).partial();
