import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildColumnMap,
  diffAgainstExisting,
  normalizeHeader,
  parseCsvLine,
  parseImportRows,
  parseNumber,
  readSheet,
  type ExistingPart,
} from "@/server/partsImport";

describe("normalizeHeader — khớp cột theo tên, bỏ dấu, không phân biệt hoa thường", () => {
  it.each([
    ["Mã phụ tùng", "ma phu tung"],
    ["MÃ PHỤ TÙNG", "ma phu tung"],
    ["mã_phụ_tùng", "ma phu tung"],
    ["Đơn vị tính", "don vi tinh"], // "đ" không phải dấu tổ hợp, phải thay riêng
    ["  Giá   bán ", "gia ban"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe("buildColumnMap", () => {
  it("khớp theo tên, không theo vị trí — thêm cột thừa ở giữa không lệch", () => {
    const map = buildColumnMap(["STT", "Tên vật tư", "Ghi chú", "Mã vật tư", "ĐVT", "Giá vốn", "Giá bán", "Tồn kho"]);
    expect(map).toMatchObject({ name: 1, code: 3, unit: 4, cost: 5, price: 6, openingStock: 7 });
  });
  it("'Giá bán' và 'Giá vốn' không nhận nhầm nhau dù cùng chứa 'gia'", () => {
    const map = buildColumnMap(["Giá vốn", "Giá bán"]);
    expect(map.cost).toBe(0);
    expect(map.price).toBe(1);
  });
});

describe("parseNumber — tiền Việt viết đủ kiểu", () => {
  it.each([
    ["1.850.000", 1850000],
    ["1,850,000", 1850000],
    ["1850000", 1850000],
    [1850000, 1850000],
    ["1.250", 1250], // dấu chấm là phân cách nghìn, không phải thập phân
    ["-5", -5],
    ["", null],
    [null, null],
    ["abc", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe("parseCsvLine", () => {
  it("tôn trọng nháy kép bao ô có dấu phẩy, và nháy kép kép bên trong", () => {
    expect(parseCsvLine('"Cửa trước, trái","Cái",3')).toEqual(["Cửa trước, trái", "Cái", "3"]);
    expect(parseCsvLine('"Kính ""cong""",1')).toEqual(['Kính "cong"', "1"]);
  });
});

describe("parseImportRows — các dòng hỏng được báo kèm số dòng, không chặn cả file", () => {
  const header = ["Mã", "Tên", "Giá bán", "Giá vốn", "Tồn kho"];

  it("đọc dòng hợp lệ, viết hoa mã", () => {
    const r = parseImportRows([header, ["vt-01", "Cửa trước", "1.850.000", 1200000, 3]]);
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ line: 2, code: "VT-01", name: "Cửa trước", price: 1850000, cost: 1200000, openingStock: 3 });
  });

  it("trùng mã trong file: lấy dòng đầu, báo dòng sau", () => {
    const r = parseImportRows([header, ["A1", "Một"], ["A1", "Hai"]]);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicatesInFile).toEqual(["A1"]);
    expect(r.issues[0]).toMatchObject({ line: 3 });
    expect(r.issues[0].message).toContain("dòng 2");
  });

  it("thiếu mã / thiếu tên / số âm -> bỏ dòng đó, báo lý do", () => {
    const r = parseImportRows([
      header,
      ["", "Không mã"],
      ["B2", ""],
      ["C3", "Giá âm", "-1"],
      ["D4", "Hợp lệ", "5"],
    ]);
    expect(r.rows.map((x) => x.code)).toEqual(["D4"]);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4]);
    expect(r.issues[2].message).toContain("giá bán");
  });

  it("dòng trống giữa bảng bị bỏ qua im lặng", () => {
    const r = parseImportRows([header, ["A1", "Một"], [null, null], ["A2", "Hai"]]);
    expect(r.rows).toHaveLength(2);
    expect(r.issues).toEqual([]);
  });

  it("không có cột Mã/Tên -> một lỗi duy nhất kể lại tiêu đề đọc được", () => {
    const r = parseImportRows([["Cột lạ", "Cột khác"], ["x", "y"]]);
    expect(r.rows).toEqual([]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toContain("Cột lạ | Cột khác");
  });

  it("file chỉ có tiêu đề -> 'không có dữ liệu'", () => {
    expect(parseImportRows([header]).issues[0].message).toBe("File không có dữ liệu.");
  });
});

describe("diffAgainstExisting — ô trống trong file nghĩa là 'không nói gì', không phải 'xoá'", () => {
  const existing: ExistingPart[] = [{ id: "id-1", code: "A1", name: "Cửa", price: 0, cost: 500, minStock: null }];
  const row = (over: Partial<ReturnType<typeof parseImportRows>["rows"][number]>) => ({
    line: 2, code: "A1", name: "Cửa", category: null, unit: null, oemNumber: null,
    price: null, cost: null, minStock: null, location: null, openingStock: null, ...over,
  });

  it("mã chưa có -> tạo mới", () => {
    const r = diffAgainstExisting([row({ code: "MOI" })], existing);
    expect(r.toCreate).toHaveLength(1);
    expect(r.toUpdate).toHaveLength(0);
  });

  it("mã đã có, file không có giá -> không có thay đổi nào", () => {
    const r = diffAgainstExisting([row({})], existing);
    expect(r.toUpdate).toHaveLength(0);
  });

  it("mã đã có, file có giá bán khác -> cập nhật, liệt kê đúng thay đổi", () => {
    const r = diffAgainstExisting([row({ price: 2500000, minStock: 0 })], existing);
    expect(r.toUpdate).toHaveLength(1);
    expect(r.toUpdate[0].changes).toEqual(["giá bán: 0 → 2.500.000", "ngưỡng tồn: chung → 0"]);
  });

  it("tồn kho trong file KHÔNG bao giờ là một 'thay đổi' của mã đã có", () => {
    const r = diffAgainstExisting([row({ openingStock: 999 })], existing);
    expect(r.toUpdate).toHaveLength(0);
  });
});

describe("readSheet — file .xlsx thật sinh bằng ExcelJS", () => {
  it("đọc đúng ô số, ô chuỗi, ô công thức", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Kho");
    ws.addRow(["Mã", "Tên", "Giá bán"]);
    ws.addRow(["A1", "Cửa", 1000]);
    ws.addRow(["A2", "Kính", { formula: "C2*2", result: 2000 }]);
    // Ô định dạng một phần (in đậm nửa tên) — ExcelJS trả về { richText: [...] }.
    ws.addRow(["A3", { richText: [{ text: "Gương " }, { text: "chiếu hậu", font: { bold: true } }] }, 800]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const rows = await readSheet(buffer, "kho.xlsx");
    const parsed = parseImportRows(rows);
    expect(parsed.rows.map((r) => [r.code, r.name, r.price])).toEqual([
      ["A1", "Cửa", 1000],
      ["A2", "Kính", 2000],
      ["A3", "Gương chiếu hậu", 800],
    ]);
  });

  it("CSV có BOM UTF-8 (Excel Việt Nam xuất ra) vẫn khớp cột đầu tiên", async () => {
    const csv = "\uFEFFMã,Tên,Giá bán\nA1,Cửa,1500\n";
    const rows = await readSheet(Buffer.from(csv, "utf-8"), "kho.csv");
    const parsed = parseImportRows(rows);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ code: "A1", price: 1500 });
  });
});
