import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dateField,
  emailField,
  pickDefined,
  optionalNonNegativeInt,
  optionalText,
  optionalUuid,
  parseValue,
  passwordField,
  positiveQuantity,
  vndAmount,
} from "@/server/validation";
import {
  purchaseLedgerPatchSchema,
  salesLedgerPatchSchema,
  salesLedgerSchema,
} from "@/server/ledgerSchemas";

describe("vndAmount", () => {
  it("nhận số và chuỗi số", () => {
    expect(vndAmount.parse(1500000)).toBe(1500000);
    expect(vndAmount.parse("1500000")).toBe(1500000);
  });
  it("chặn âm, lẻ, chữ, vượt integer Postgres", () => {
    expect(vndAmount.safeParse(-1).success).toBe(false);
    expect(vndAmount.safeParse(10.5).success).toBe(false);
    expect(vndAmount.safeParse("abc").success).toBe(false);
    expect(vndAmount.safeParse(3_000_000_000).success).toBe(false);
  });
});

describe("positiveQuantity", () => {
  it("0 và số âm đều bị từ chối — xuất 0 cái không có nghĩa", () => {
    expect(positiveQuantity.safeParse(0).success).toBe(false);
    expect(positiveQuantity.safeParse(-3).success).toBe(false);
    expect(positiveQuantity.parse("2")).toBe(2);
  });
});

describe("optionalNonNegativeInt — null, 0 và không-gửi là ba thứ khác nhau", () => {
  it("chuỗi rỗng và null đều quy về null (chưa biết)", () => {
    expect(optionalNonNegativeInt.parse("")).toBeNull();
    expect(optionalNonNegativeInt.parse(null)).toBeNull();
  });
  it("0 giữ nguyên là 0 (cố ý), không biến thành null", () => {
    expect(optionalNonNegativeInt.parse(0)).toBe(0);
    expect(optionalNonNegativeInt.parse("0")).toBe(0);
  });
  it("số âm bị từ chối với thông báo tiếng Việt", () => {
    const r = optionalNonNegativeInt.safeParse(-5);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Không được âm.");
  });
});

describe("dateField", () => {
  it("chuỗi ISO và yyyy-mm-dd thành Date", () => {
    expect(dateField.parse("2025-03-01")).toBeInstanceOf(Date);
  });
  it("chuỗi rác không thành 'Invalid Date' lọt xuống Postgres", () => {
    const r = dateField.safeParse("hôm qua");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Ngày không hợp lệ.");
  });
});

describe("emailField / passwordField", () => {
  it("email hạ chữ thường và trim", () => {
    expect(emailField.parse("  Chu@Gara.VN ")).toBe("chu@gara.vn");
  });
  it("mật khẩu tối thiểu 8 ký tự", () => {
    expect(passwordField.safeParse("1234567").success).toBe(false);
    expect(passwordField.safeParse("12345678").success).toBe(true);
  });
});

describe("BẪY PATCH — helper optional* biến 'không gửi' thành null", () => {
  // Lỗi có thật trong bản đầu của PATCH /api/users/[id]: `employeeId: optionalUuid` không
  // bọc .optional() → PATCH chỉ để đặt lại mật khẩu lặng lẽ gỡ liên kết nhân sự.
  it("optionalUuid KHÔNG bọc: trường vắng mặt thành null (đúng cho TẠO, sai cho SỬA)", () => {
    const create = z.object({ employeeId: optionalUuid });
    expect(create.parse({})).toEqual({ employeeId: null });
  });
  it("optionalUuid.optional(): trường vắng mặt giữ undefined (đúng cho SỬA)", () => {
    const patch = z.object({ employeeId: optionalUuid.optional(), newPassword: z.string() });
    expect(patch.parse({ newPassword: "matkhau123" })).toEqual({ newPassword: "matkhau123" });
    // Gửi "" vẫn là gỡ liên kết có chủ đích.
    expect(patch.parse({ employeeId: "", newPassword: "x" })).toEqual({ employeeId: null, newPassword: "x" });
  });
  it("optionalText cùng hành vi", () => {
    expect(z.object({ note: optionalText(10) }).parse({})).toEqual({ note: null });
    expect(z.object({ note: optionalText(10).optional() }).parse({})).toEqual({});
  });
});

describe("Lược đồ sổ kế toán", () => {
  it("tạo mới: default 0/false cho các cột số và cờ", () => {
    const r = salesLedgerSchema.parse({ voucherDate: "2025-03-01", partnerName: "A" });
    expect(r.amountBeforeTax).toBe(0);
    expect(r.invoiceIssued).toBe(false);
    expect(r.voucherNo).toBeNull();
  });

  // zod 4: `.partial()` KHÔNG bỏ `.default()`. Nếu suy bản PATCH từ lược đồ có default thì
  // PATCH chỉ sửa tên khách sẽ đặt VAT/tổng tiền về 0. Đã chạy thử và thấy — test này giữ
  // cho lỗi đó không quay lại.
  it("PATCH chỉ gửi tên -> KHÔNG có trường tiền/cờ nào bị điền default", () => {
    expect(salesLedgerPatchSchema.parse({ partnerName: "Sửa tên" })).toEqual({ partnerName: "Sửa tên" });
    expect(purchaseLedgerPatchSchema.parse({ note: "ghi chú" })).toEqual({ note: "ghi chú" });
  });

  it("PATCH vẫn từ chối tiền âm và ngày sai", () => {
    expect(salesLedgerPatchSchema.safeParse({ totalAmount: -1 }).success).toBe(false);
    expect(salesLedgerPatchSchema.safeParse({ voucherDate: "linh tinh" }).success).toBe(false);
  });

  it("KHÔNG ép trước thuế + VAT = tổng (213/232 chứng từ thật không thoả vì thuế trực tiếp)", () => {
    const r = salesLedgerSchema.safeParse({
      voucherDate: "2025-01-02",
      partnerName: "Bảo hiểm",
      amountBeforeTax: 1700000,
      vatAmount: 0,
      totalAmount: 1689800,
    });
    expect(r.success).toBe(true);
  });
});

describe("parseValue — thông báo lỗi trả về cho người dùng", () => {
  it("lấy lỗi đầu tiên, kèm tên trường khi zod chỉ nói chung chung", () => {
    const r = parseValue({ email: 123 }, z.object({ email: z.string() }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const body = r.response as unknown as { status: number };
      expect(body.status).toBe(400);
    }
  });
});

describe("pickDefined — object cho db.update().set()", () => {
  it("bỏ undefined, GIỮ null và 0 và false (chúng là giá trị có nghĩa)", () => {
    expect(pickDefined({ a: undefined, b: null, c: 0, d: false, e: "" })).toEqual({ b: null, c: 0, d: false, e: "" });
  });
  it("object rỗng khi không có gì -> route trả 'Không có thay đổi nào'", () => {
    expect(Object.keys(pickDefined({ a: undefined }))).toHaveLength(0);
  });
});
