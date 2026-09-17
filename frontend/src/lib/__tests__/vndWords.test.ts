import { describe, expect, it } from "vitest";
import { vndToWords } from "@/lib/vndWords";

// Dòng "Số tiền bằng chữ" trên hoá đơn. Mỗi ca dưới đây là một quy tắc đọc số tiếng Việt
// mà máy hay đọc sai — "một trăm năm" thay vì "một trăm linh năm" là đọc SAI số tiền trên
// một chứng từ, không phải lỗi văn phong.
describe("vndToWords", () => {
  const cases: Array<[number, string]> = [
    [0, "Không đồng"],
    [5, "Năm đồng"],
    [10, "Mười đồng"],
    [11, "Mười một đồng"],
    [15, "Mười lăm đồng"], // "lăm" sau chục
    [21, "Hai mươi mốt đồng"], // "mốt" sau chục >= 2
    [24, "Hai mươi tư đồng"], // "tư" sau chục >= 2
    [25, "Hai mươi lăm đồng"],
    [100, "Một trăm đồng"],
    [105, "Một trăm linh năm đồng"], // "linh" khi chục = 0 và có đơn vị
    [115, "Một trăm mười lăm đồng"],
    [1000, "Một nghìn đồng"],
    [1005, "Một nghìn không trăm linh năm đồng"], // "không trăm" ở nhóm sau
    [1050, "Một nghìn không trăm năm mươi đồng"],
    [350000, "Ba trăm năm mươi nghìn đồng"],
    [1005000, "Một triệu không trăm linh năm nghìn đồng"],
    [1250000, "Một triệu hai trăm năm mươi nghìn đồng"],
    [1000001, "Một triệu không trăm linh một đồng"],
    [2000000000, "Hai tỷ đồng"],
    [2000500000, "Hai tỷ năm trăm nghìn đồng"],
    // Tổng sổ bán hàng 2025 thật của gara.
    [1838606218, "Một tỷ tám trăm ba mươi tám triệu sáu trăm linh sáu nghìn hai trăm mười tám đồng"],
  ];

  it.each(cases)("%i -> %s", (amount, expected) => {
    expect(vndToWords(amount)).toBe(expected);
  });

  it("làm tròn về đồng nguyên — tiền thuế nhân ra có thể lẻ", () => {
    expect(vndToWords(1250000.4)).toBe("Một triệu hai trăm năm mươi nghìn đồng");
    expect(vndToWords(1250000.6)).toBe("Một triệu hai trăm năm mươi nghìn không trăm linh một đồng");
  });

  it("số âm có tiền tố 'âm' — không im lặng bỏ dấu", () => {
    expect(vndToWords(-5)).toBe("Âm năm đồng");
  });
});
