// Tiện ích tiếng Việt thuần — dùng chung server lẫn client (không import db, không "use client").

export const VIETNAMESE_DIACRITICS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

// Từ tiếng Việt hay gặp trong tên xưởng, viết KHÔNG dấu.
const UNACCENTED_VI_WORDS = new Set([
  "xuong", "son", "go", "han", "may", "dong", "sua", "chua", "xe", "oto",
  "chi", "nhanh", "trung", "tam", "co", "khi", "gam", "dien",
]);

/**
 * Tên có vẻ bị mất dấu tiếng Việt hay không.
 *
 * Không thể chỉ kiểm tra "có dấu hay không": "Gara Ford" là tên đúng và không có dấu nào.
 * Điều kiện là KHÔNG có dấu nào VÀ có từ 2 từ tiếng Việt viết không dấu trở lên —
 * "Xuong son go han" khớp 4 từ, còn "Gara Ford" khớp 0.
 */
export function looksUnaccented(name: string): boolean {
  if (!name.trim() || VIETNAMESE_DIACRITICS.test(name)) return false;
  const hits = name
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .filter((w) => UNACCENTED_VI_WORDS.has(w));
  return hits.length >= 2;
}
