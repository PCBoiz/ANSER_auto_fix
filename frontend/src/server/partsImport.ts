import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { parts, partTransactions } from "@/server/db/schema";

// Đọc file Excel/CSV danh mục phụ tùng do gara gửi, khớp cột theo TÊN TIÊU ĐỀ chứ không
// theo vị trí.
//
// Vì sao không khớp theo vị trí cột: file thật do kế toán xuất từ phần mềm khác, mỗi đợt
// một khác — thêm một cột "Ghi chú" ở giữa là toàn bộ ánh xạ lệch đi một ô, và dữ liệu
// vẫn nhập vào được (giá vốn chui vào cột tồn kho) mà không lỗi nào nổ ra.
//
// Tiêu đề được chuẩn hoá trước khi so: bỏ dấu tiếng Việt, hạ chữ thường, bỏ khoảng trắng
// thừa. "Mã phụ tùng", "MA PHU TUNG", "mã_phụ_tùng" đều ra cùng một khoá.

export type ImportRow = {
  /** Số dòng trong file gốc — người dùng cần biết sửa dòng nào trong Excel. */
  line: number;
  code: string;
  name: string;
  category: string | null;
  unit: string | null;
  oemNumber: string | null;
  price: number | null;
  cost: number | null;
  minStock: number | null;
  location: string | null;
  openingStock: number | null;
};

export type ImportIssue = { line: number; message: string };

export type ImportPlan = {
  /** Mã chưa có trong chi nhánh -> sẽ tạo mới. */
  toCreate: ImportRow[];
  /** Mã đã có -> chỉ cập nhật những ô có giá trị trong file (không ghi đè bằng ô trống). */
  toUpdate: Array<{ row: ImportRow; existingId: string; changes: string[] }>;
  /** Dòng không dùng được, kèm lý do. */
  issues: ImportIssue[];
  /** Mã xuất hiện nhiều lần trong CÙNG một file. */
  duplicatesInFile: string[];
  totalRows: number;
};

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    // Bỏ dấu tổ hợp (\u0300-\u036f) — "Mã" -> "Ma". Chữ "đ" không phải dấu tổ hợp nên
    // phải thay riêng ở dưới.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Mỗi trường nhận nhiều cách gọi khác nhau mà các phần mềm kế toán hay dùng.
const COLUMN_ALIASES: Record<keyof Omit<ImportRow, "line">, string[]> = {
  code: ["ma", "ma phu tung", "ma vat tu", "ma hang", "code", "sku", "ma so"],
  name: ["ten", "ten phu tung", "ten vat tu", "ten hang", "dien giai", "name", "mo ta"],
  category: ["nhom", "nhom phu tung", "danh muc", "loai", "category", "nhom hang"],
  unit: ["dvt", "don vi", "don vi tinh", "unit"],
  oemNumber: ["oem", "ma oem", "ma chinh hang", "part number", "oem number"],
  price: ["gia ban", "don gia ban", "gia", "price", "don gia"],
  cost: ["gia von", "gia nhap", "don gia von", "don gia nhap", "cost"],
  minStock: ["nguong", "nguong ton", "ton toi thieu", "min stock", "dinh muc ton"],
  location: ["vi tri", "ke", "vi tri kho", "location"],
  openingStock: ["ton", "ton kho", "so luong", "ton dau", "sl", "quantity", "stock"],
};

export function buildColumnMap(headerRow: string[]): Partial<Record<keyof Omit<ImportRow, "line">, number>> {
  const map: Partial<Record<keyof Omit<ImportRow, "line">, number>> = {};
  const normalized = headerRow.map((h) => normalizeHeader(String(h ?? "")));

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<
    [keyof Omit<ImportRow, "line">, string[]]
  >) {
    // Khớp CHÍNH XÁC trước, rồi mới khớp chứa. "Giá bán" và "Giá vốn" đều chứa "gia" —
    // nếu chỉ khớp chứa thì cả hai cùng nhận về cột đầu tiên có chữ "gia".
    let index = normalized.findIndex((h) => aliases.includes(h));
    if (index === -1) {
      index = normalized.findIndex((h) => h && aliases.some((a) => h === a || h.startsWith(`${a} `)));
    }
    if (index !== -1) map[field] = index;
  }
  return map;
}

/** Rút giá trị thô từ ô ExcelJS: ô công thức là `{ formula, result }`, ô định dạng là `{ richText }`. */
function unwrapCell(value: unknown): unknown {
  if (typeof value === "object" && value !== null) {
    if ("result" in value) return (value as { result?: unknown }).result;
    if ("richText" in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
    }
  }
  return value;
}

/**
 * Đọc số từ ô Excel: chấp nhận "1.250.000", "1,250,000", "1250000", số thật, và ô CÔNG THỨC.
 *
 * Cột giá trong file kế toán thường là công thức (=D2*1.08). ExcelJS trả về object
 * `{ formula, result }` chứ không phải số — bản đầu của hàm này gọi `String(value)` ra
 * "[object Object]" rồi thành null, tức là giá bị bỏ im lặng. Test `partsImport.test.ts`
 * dựng file .xlsx thật có ô công thức để giữ không tái phát.
 */
export function parseNumber(rawValue: unknown): number | null {
  const value = unwrapCell(rawValue);
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;

  const text = String(value).trim();
  if (!text) return null;

  // Bỏ mọi ký tự không phải chữ số và dấu trừ. Dấu chấm/phẩy trong tiền Việt là phân
  // cách hàng nghìn, không phải thập phân — "1.250" là một nghìn hai trăm năm mươi.
  const cleaned = text.replace(/[^\d-]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellText(rawValue: unknown): string | null {
  const value = unwrapCell(rawValue);
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/** Tách file thành mảng dòng thô. Hỗ trợ .xlsx và .csv. */
export async function readSheet(buffer: Buffer, fileName: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();

  if (fileName.toLowerCase().endsWith(".csv")) {
    // ExcelJS đọc CSV qua stream; dựng lại từ text đơn giản và chắc chắn hơn, vì file
    // CSV xuất từ Excel Việt Nam thường là UTF-8 có BOM và phân cách bằng dấu phẩy.
    const text = buffer.toString("utf-8").replace(/^\uFEFF/, "");
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => parseCsvLine(line));
  }

  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // `row.values` có phần tử [0] rỗng vì ExcelJS đánh số cột từ 1.
    const values = (row.values as unknown[]).slice(1);
    rows.push(values);
  });
  return rows;
}

/** Tách một dòng CSV, tôn trọng dấu nháy kép bao quanh ô có chứa dấu phẩy. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      // "" bên trong ô có nháy = một dấu nháy thật.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((v) => v.trim());
}

/** Kết quả đọc file, TRƯỚC khi đối chiếu với DB. Thuần — test được không cần Neon. */
export type ParsedSheet = {
  rows: ImportRow[];
  issues: ImportIssue[];
  duplicatesInFile: string[];
};

/**
 * Bước 1 (thuần): mảng ô thô -> dòng có cấu trúc + danh sách lỗi.
 *
 * Tách khỏi `planPartsImport` để test được với dữ liệu trong bộ nhớ: mọi quy tắc dễ sai
 * (khớp cột theo tên không dấu, đọc "1.850.000", bắt trùng mã, thiếu tên, số âm) đều nằm
 * ở đây, và không cái nào cần DB để kiểm tra.
 */
export function parseImportRows(rows: unknown[][]): ParsedSheet {
  const issues: ImportIssue[] = [];

  if (rows.length < 2) {
    return { rows: [], issues: [{ line: 0, message: "File không có dữ liệu." }], duplicatesInFile: [] };
  }

  const header = rows[0].map((v) => String(cellText(v) ?? ""));
  const map = buildColumnMap(header);

  if (map.code === undefined || map.name === undefined) {
    return {
      rows: [],
      issues: [
        {
          line: 1,
          message: `Không tìm thấy cột mã và tên. Tiêu đề đọc được: ${header.filter(Boolean).join(" | ") || "(trống)"}. Cần ít nhất một cột tên là "Mã" và một cột "Tên".`,
        },
      ],
      duplicatesInFile: [],
    };
  }

  const parsed: ImportRow[] = [];
  const seen = new Map<string, number>();
  const duplicatesInFile: string[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i];
    const line = i + 1; // 1-based, và dòng 1 là tiêu đề

    const at = (field: keyof Omit<ImportRow, "line">) => {
      const index = map[field];
      return index === undefined ? null : cellText(raw[index]);
    };

    const code = at("code")?.toUpperCase() ?? null;
    const name = at("name");

    if (!code && !name) continue; // dòng trống giữa bảng — bỏ qua im lặng
    if (!code) {
      issues.push({ line, message: "Thiếu mã phụ tùng." });
      continue;
    }
    if (!name) {
      issues.push({ line, message: `Mã ${code}: thiếu tên phụ tùng.` });
      continue;
    }

    const previous = seen.get(code);
    if (previous !== undefined) {
      duplicatesInFile.push(code);
      issues.push({ line, message: `Mã ${code} đã xuất hiện ở dòng ${previous} — chỉ lấy dòng đầu tiên.` });
      continue;
    }
    seen.set(code, line);

    const numberAt = (field: "price" | "cost" | "minStock" | "openingStock") => {
      const index = map[field];
      return index === undefined ? null : parseNumber(raw[index]);
    };

    const price = numberAt("price");
    const cost = numberAt("cost");
    const minStock = numberAt("minStock");
    const openingStock = numberAt("openingStock");

    // Số âm ở bất kỳ cột nào đều là dữ liệu hỏng (thường do cột bị lệch sang cột "chênh
    // lệch" hay "trả hàng"). Bỏ cả dòng thay vì nhập nửa vời rồi để người dùng tự phát hiện.
    const negative = [
      price !== null && price < 0 ? "giá bán" : null,
      cost !== null && cost < 0 ? "giá vốn" : null,
      minStock !== null && minStock < 0 ? "ngưỡng tồn" : null,
      openingStock !== null && openingStock < 0 ? "tồn kho" : null,
    ].filter(Boolean);
    if (negative.length > 0) {
      issues.push({ line, message: `Mã ${code}: ${negative.join(", ")} bị âm.` });
      continue;
    }

    parsed.push({
      line,
      code,
      name,
      category: at("category"),
      unit: at("unit"),
      oemNumber: at("oemNumber"),
      price,
      cost,
      minStock,
      location: at("location"),
      openingStock,
    });
  }

  return { rows: parsed, issues, duplicatesInFile };
}

/** Bản ghi đang có trong kho, đúng các cột cần để so sánh. */
export type ExistingPart = {
  id: string;
  code: string;
  name: string;
  price: number;
  cost: number | null;
  minStock: number | null;
};

/**
 * Bước 2 (thuần): chia dòng đã đọc thành "tạo mới" và "cập nhật", theo danh sách mã đang có.
 *
 * Chỉ coi là thay đổi khi file CÓ giá trị và giá trị đó khác cái đang lưu. Ô trống trong
 * file nghĩa là "không nói gì", không phải "xoá đi" — file đợt sau thường chỉ điền vài cột.
 */
export function diffAgainstExisting(
  rows: ImportRow[],
  existing: ExistingPart[],
): Pick<ImportPlan, "toCreate" | "toUpdate"> {
  const existingByCode = new Map(existing.map((e) => [e.code, e]));
  const toCreate: ImportRow[] = [];
  const toUpdate: ImportPlan["toUpdate"] = [];

  for (const row of rows) {
    const match = existingByCode.get(row.code);
    if (!match) {
      toCreate.push(row);
      continue;
    }

    const changes: string[] = [];
    if (row.name && row.name !== match.name) changes.push(`tên: "${match.name}" → "${row.name}"`);
    if (row.price !== null && row.price !== match.price) {
      changes.push(`giá bán: ${match.price.toLocaleString("vi-VN")} → ${row.price.toLocaleString("vi-VN")}`);
    }
    if (row.cost !== null && row.cost !== match.cost) {
      changes.push(`giá vốn: ${match.cost?.toLocaleString("vi-VN") ?? "chưa biết"} → ${row.cost.toLocaleString("vi-VN")}`);
    }
    if (row.minStock !== null && row.minStock !== match.minStock) {
      changes.push(`ngưỡng tồn: ${match.minStock ?? "chung"} → ${row.minStock}`);
    }

    if (changes.length > 0) toUpdate.push({ row, existingId: match.id, changes });
  }

  return { toCreate, toUpdate };
}

/**
 * Đọc file và đối chiếu với kho của một chi nhánh, trả về KẾ HOẠCH nhập.
 *
 * Không ghi gì vào DB — đây là bước xem trước. Người dùng phải nhìn thấy "sẽ tạo mới bao
 * nhiêu, cập nhật bao nhiêu, bỏ qua dòng nào vì sao" TRƯỚC khi đồng ý, vì một file sai
 * cột có thể tạo hàng trăm mã rác mà dọn lại rất lâu.
 *
 * Đây là hàm DUY NHẤT trong bước lập kế hoạch chạm DB; hai bước thuần ở trên đã có test.
 */
export async function planPartsImport(
  buffer: Buffer,
  fileName: string,
  branchId: string,
): Promise<ImportPlan> {
  const sheet = parseImportRows(await readSheet(buffer, fileName));

  // Một truy vấn cho toàn bộ mã trong file, thay vì một truy vấn mỗi dòng.
  const codes = sheet.rows.map((r) => r.code);
  const existing: ExistingPart[] = codes.length
    ? await db
        .select({ id: parts.id, code: parts.code, price: parts.price, cost: parts.cost, minStock: parts.minStock, name: parts.name })
        .from(parts)
        .where(and(eq(parts.branchId, branchId), inArray(parts.code, codes)))
    : [];

  return {
    ...diffAgainstExisting(sheet.rows, existing),
    issues: sheet.issues,
    duplicatesInFile: sheet.duplicatesInFile,
    totalRows: sheet.rows.length,
  };
}

export type ImportResult = { created: number; updated: number; openingTransactions: number };

/**
 * Thực hiện kế hoạch nhập trong MỘT transaction.
 *
 * Tồn kho ban đầu KHÔNG ghi thẳng vào `parts.stock` mà đi qua một phiếu nhập kho. Quy
 * tắc xuyên suốt của hệ thống là mọi biến động tồn phải có dòng lịch sử đối chiếu
 * (xem `createPart`, `createPartTransaction`); ghi thẳng ở đây sẽ tạo ra một lượng tồn
 * không ai giải thích được từ đâu ra khi thủ kho đi kiểm kê. Script nhập dữ liệu cũ
 * (`import-legacy-2025.mjs`) ghi thẳng — đó là lý do 788 phụ tùng hôm nay chỉ có đúng
 * một phiếu kho trong lịch sử.
 */
export async function applyPartsImport(plan: ImportPlan, branchId: string): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    let openingTransactions = 0;

    for (const row of plan.toCreate) {
      const [inserted] = await tx
        .insert(parts)
        .values({
          code: row.code,
          name: row.name,
          category: row.category ?? "Chưa phân nhóm",
          unit: row.unit ?? "Cái",
          oemNumber: row.oemNumber,
          price: row.price ?? 0,
          cost: row.cost,
          minStock: row.minStock,
          location: row.location,
          branchId,
          stock: 0,
        })
        .returning({ id: parts.id });
      created += 1;

      if (row.openingStock && row.openingStock > 0) {
        await tx.insert(partTransactions).values({
          partId: inserted.id,
          type: "import",
          quantity: row.openingStock,
          unitCost: row.cost,
          counterparty: "Tồn đầu kỳ (nhập từ file)",
          note: `Dòng ${row.line} của file nhập`,
        });
        await tx.update(parts).set({ stock: row.openingStock }).where(eq(parts.id, inserted.id));
        openingTransactions += 1;
      }
    }

    for (const item of plan.toUpdate) {
      // Chỉ ghi ĐÚNG những trường đã liệt kê ở bước xem trước. Lén cập nhật thêm vị trí
      // kho hay mã OEM mà màn xem trước không nói tới là phá lời hứa "thấy gì được nấy".
      // Tồn kho của mã đã có KHÔNG bao giờ bị ghi đè từ file: tồn thật có thể đã đổi qua
      // phiếu nhập/xuất kể từ lúc xuất file.
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (item.row.name) set.name = item.row.name;
      if (item.row.price !== null) set.price = item.row.price;
      if (item.row.cost !== null) set.cost = item.row.cost;
      if (item.row.minStock !== null) set.minStock = item.row.minStock;

      await tx.update(parts).set(set).where(eq(parts.id, item.existingId));
      updated += 1;
    }

    return { created, updated, openingTransactions };
  });
}
