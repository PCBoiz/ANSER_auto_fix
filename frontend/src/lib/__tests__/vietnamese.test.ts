import { describe, expect, it } from "vitest";
import { looksUnaccented } from "@/lib/vietnamese";

describe("looksUnaccented — nhận diện tên chi nhánh bị mất dấu", () => {
  it("tên thật của kho đồng-sơn trong DB: 'Xuong son go han' -> đúng là thiếu dấu", () => {
    expect(looksUnaccented("Xuong son go han")).toBe(true);
  });
  it("có dấu thì không bao giờ báo", () => {
    expect(looksUnaccented("Xưởng sơn gò hàn")).toBe(false);
    expect(looksUnaccented("Gara trung tâm")).toBe(false);
  });
  it("tên không dấu nhưng KHÔNG phải tiếng Việt thì không báo nhầm", () => {
    expect(looksUnaccented("Gara Ford")).toBe(false);
    expect(looksUnaccented("Toyota Service")).toBe(false);
  });
  it("cần ít nhất 2 từ tiếng Việt không dấu — một từ trùng ngẫu nhiên không đủ", () => {
    expect(looksUnaccented("Gara Son")).toBe(false); // "Son" có thể là tên người
    expect(looksUnaccented("Xuong Son")).toBe(true);
  });
  it("chuỗi rỗng không báo", () => {
    expect(looksUnaccented("   ")).toBe(false);
  });
});
