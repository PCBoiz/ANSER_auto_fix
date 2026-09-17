import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatVnd, toGarageDateInput } from "@/lib/format";
import { escapeHtml } from "@/lib/html";

describe("formatDate — luôn theo giờ Việt Nam, bất kể máy chạy ở múi giờ nào", () => {
  // Mốc 23:30 UTC ngày 17/09 = 06:30 sáng 18/09 giờ Việt Nam. Trên server UTC mà quên
  // timeZone thì hiện "17/9" — chấm công vào ca sáng bị ghi sang hôm trước.
  it("mốc 00:00–07:00 giờ VN không bị lùi một ngày", () => {
    expect(formatDate("2026-09-17T23:30:00.000Z")).toBe("18/9/2026");
    expect(formatDateTime("2026-09-17T23:30:00.000Z")).toContain("18/9/2026");
  });

  it("chứng từ sổ kế toán (lưu 00:00Z) hiện đúng ngày", () => {
    expect(formatDate("2025-01-02T00:00:00.000Z")).toBe("2/1/2025");
  });

  it("null/undefined ra gạch ngang, không phải 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("toGarageDateInput — giá trị cho <input type=date>", () => {
  it("cắt theo giờ VN, không theo UTC", () => {
    // 23:30 UTC 17/09 là sáng 18/09 ở VN. `toISOString().slice(0,10)` sẽ cho 2026-09-17.
    expect(toGarageDateInput("2026-09-17T23:30:00.000Z")).toBe("2026-09-18");
  });
  it("rỗng khi không có giá trị", () => {
    expect(toGarageDateInput(null)).toBe("");
  });
});

describe("formatVnd", () => {
  it("phân cách hàng nghìn kiểu Việt Nam và ký hiệu đồng", () => {
    expect(formatVnd(1250000)).toBe("1.250.000₫");
    expect(formatVnd(0)).toBe("0₫");
  });
  it("null = chưa biết, không phải 0đ", () => {
    expect(formatVnd(null)).toBe("—");
  });
});

describe("escapeHtml", () => {
  it("thoát 4 ký tự nguy hiểm — tên khách chèn vào email không được thành thẻ", () => {
    expect(escapeHtml(`<script>alert("x")</script> & co`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co",
    );
  });
  it("null/undefined ra chuỗi rỗng", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
