import { z } from "zod";
import { badRequest } from "@/server/api";

// Validate đầu vào API bằng zod, thay cho chuỗi `if (!x) return badRequest(...)` rải khắp
// 51 route.
//
// Vì sao đáng đổi: kiểm tra thủ công chỉ bắt được thứ người viết NHỚ kiểm tra. Ba lỗ đã
// thật sự tồn tại trong repo này trước khi thay:
//   - `Number(body.amountBeforeTax) || 0` — gõ "abc" vào ô tiền thì lặng lẽ thành 0, chứng
//     từ vẫn được tạo với số tiền sai thay vì báo lỗi.
//   - `body.voucherNo?.trim()` — client gửi `voucherNo: 123` (số) là nổ 500 ở `.trim()`.
//   - không route nào chặn số âm, nên giảm giá -1.000.000 là một cách cộng tiền hợp lệ.
//
// Quy ước: mọi schema ở đây mô tả DỮ LIỆU THÔ TỪ CLIENT (chuỗi ngày, số có thể là chuỗi),
// và `transform` sang đúng kiểu mà tầng store cần (Date, number). Store không bao giờ phải
// tự đoán kiểu nữa.

/** Số tiền VND: số nguyên không âm. Tiền âm không phải nghiệp vụ nào ở đây cả. */
export const vndAmount = z.coerce
  .number({ message: "Số tiền không hợp lệ." })
  .int("Số tiền phải là số nguyên đồng.")
  .min(0, "Số tiền không được âm.")
  // Cột tiền là `integer` Postgres (tối đa ~2,147 tỷ). Chặn ở 2 tỷ để lỗi gõ thừa chữ số
  // báo ngay tại đây bằng tiếng Việt, thay vì nổ "integer out of range" từ DB.
  .max(2_000_000_000, "Số tiền vượt quá giới hạn cho phép.");

/** Số lượng: nguyên dương. Xuất kho 0 cái hoặc -3 cái đều không có nghĩa. */
export const positiveQuantity = z.coerce
  .number({ message: "Số lượng không hợp lệ." })
  .int("Số lượng phải là số nguyên.")
  .positive("Số lượng phải lớn hơn 0.")
  .max(1_000_000, "Số lượng vượt quá giới hạn cho phép.");

/**
 * Số nguyên không âm, cho phép bỏ trống (null = chưa biết, khác 0).
 *
 * `z.null()` và `z.literal("")` đứng TRƯỚC nhánh số: union thử từng nhánh theo thứ tự, mà
 * `z.coerce.number()` ép "" thành 0 thành công — nên nếu nhánh số đứng đầu, xoá trống ô
 * "ngưỡng tồn" (ý là quay về ngưỡng chung) lại thành 0 (ý là cố ý không cảnh báo). Test
 * `validation.test.ts` bắt được đúng lỗi này ở bản đầu.
 */
export const optionalNonNegativeInt = z
  .union(
    [
      z.null(),
      z.literal(""),
      z.coerce
        .number()
        .int("Phải là số nguyên.")
        .min(0, "Không được âm."),
    ],
    { message: "Phải là số nguyên từ 0 trở lên, hoặc để trống." },
  )
  .transform((v) => (v === "" || v === null ? null : (v as number)));

/** Chuỗi bắt buộc, đã trim, không rỗng. */
export const requiredText = (label: string, max = 500) =>
  z
    .string({ message: `${label} không hợp lệ.` })
    .trim()
    .min(1, `${label} không được để trống.`)
    .max(max, `${label} quá dài (tối đa ${max} ký tự).`);

// BẪY KHI DÙNG CHO PATCH — áp cho optionalText / optionalEmail / optionalUuid:
// các helper này biến "KHÔNG GỬI TRƯỜNG" thành `null`. Đúng cho lược đồ TẠO MỚI (không gửi =
// để trống), nhưng trong lược đồ SỬA thì "không gửi" phải nghĩa là "giữ nguyên". Khi dùng
// trong PATCH, luôn bọc thêm `.optional()` bên ngoài (hoặc dùng `.partial()` cho cả object):
//     employeeId: optionalUuid.optional()   // không gửi -> undefined -> không đụng tới
// Quên lớp này là xoá dữ liệu một cách im lặng mỗi lần sửa một trường khác.

/** Chuỗi tuỳ chọn: "" và null đều quy về null, để DB không lưu chuỗi rỗng lẫn null. */
export const optionalText = (max = 500) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

export const emailField = z
  .string({ message: "Email không hợp lệ." })
  .trim()
  .toLowerCase()
  .email("Email không đúng định dạng.")
  .max(255);

export const optionalEmail = z
  .union([z.string().trim().toLowerCase().email("Email không đúng định dạng.").max(255), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

/**
 * Mật khẩu. 8 ký tự thay vì 6 như trước: 6 ký tự chữ thường là ~300 triệu tổ hợp, máy
 * bàn thường dò xong trong vài giờ nếu lấy được bản hash. Không ép ký tự đặc biệt —
 * quy tắc đó đẩy người dùng tới `Matkhau@1` rồi dán lên màn hình, độ dài mới là thứ
 * thật sự làm tăng chi phí dò.
 */
export const passwordField = z
  .string({ message: "Mật khẩu không hợp lệ." })
  .min(8, "Mật khẩu phải có ít nhất 8 ký tự.")
  .max(200, "Mật khẩu quá dài.");

export const uuidField = z.string().uuid("Mã định danh không hợp lệ.");

export const optionalUuid = z
  .union([z.string().uuid("Mã định danh không hợp lệ."), z.literal(""), z.null()], {
    message: "Mã định danh không hợp lệ.",
  })
  .optional()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

/**
 * Ngày gửi từ client (chuỗi ISO hoặc `yyyy-mm-dd`) -> `Date`.
 *
 * `new Date("linh tinh")` cho ra `Invalid Date` — một object Date hợp lệ về kiểu, nhưng
 * ném vào Postgres là lỗi 500 khó hiểu. Chặn ngay tại cửa.
 */
export const dateField = z
  .union([z.string(), z.date()])
  .transform((v, ctx) => {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Ngày không hợp lệ." });
      return z.NEVER;
    }
    return d;
  });

export const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Ngày không hợp lệ." });
      return z.NEVER;
    }
    return d;
  });

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: ReturnType<typeof badRequest> };

/**
 * Đọc JSON body và validate. Trả về thẳng `badRequest` kèm thông điệp tiếng Việt của
 * trường đầu tiên sai — người dùng cần biết SỬA Ô NÀO, không cần cả cây lỗi zod.
 *
 * Dùng:
 * ```ts
 * const parsed = await parseBody(request, schema);
 * if (!parsed.ok) return parsed.response;
 * // parsed.data đã đúng kiểu
 * ```
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  const raw = await request.json().catch(() => undefined);
  if (raw === undefined) {
    return { ok: false, response: badRequest("Nội dung gửi lên không phải JSON hợp lệ.") };
  }
  return parseValue(raw, schema);
}

/** Như `parseBody` nhưng nhận sẵn giá trị — dùng cho query string đã gom thành object. */
export function parseValue<S extends z.ZodTypeAny>(
  value: unknown,
  schema: S,
): ParseResult<z.infer<S>> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };

  const first = result.error.issues[0];
  // Ghép đường dẫn trường vào thông điệp khi zod chỉ trả lỗi chung chung ("Required"),
  // để "Thiếu trường" còn biết là thiếu trường nào.
  const path = first?.path?.join(".");
  const message = first?.message ?? "Dữ liệu không hợp lệ.";
  const withField = path && !message.includes(path) && /required|invalid|expected/i.test(message)
    ? `Trường "${path}": ${message}`
    : message;

  return { ok: false, response: badRequest(withField) };
}

/**
 * Bỏ mọi khoá có giá trị `undefined` — biến kết quả của lược đồ PATCH thành đúng object
 * "chỉ những trường có gửi" để đưa thẳng vào `db.update().set()`.
 *
 * Drizzle `.set({})` với toàn undefined sinh câu UPDATE rỗng và ném lỗi; và route cần biết
 * "không có thay đổi nào" để trả 400 thay vì 500. Mọi route PATCH dùng hàm này thay vì viết
 * tay 10 dòng `if ("x" in body) patch.x = ...` — 24 route từng viết tay như thế, mỗi cái một
 * kiểu ép số, và đó là nơi các lỗi "0 thành null", "abc thành NaN" sinh ra.
 */
export function pickDefined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) out[key] = v;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}
