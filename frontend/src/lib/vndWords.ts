// Đọc số tiền thành chữ tiếng Việt — dòng "Số tiền bằng chữ" bắt buộc trên hoá đơn.
//
// Module thuần (không "use client") để trang in hoá đơn chạy phía server dùng được. Xem
// ARCHITECTURE.md §5.1 về cái bẫy formatVnd đã dính khi đặt hàm dùng chung trong file client.
//
// Các quy tắc đọc số dễ sai, và vì sao chúng quan trọng: hoá đơn là chứng từ — "một trăm
// năm" thay vì "một trăm linh năm" là đọc sai số tiền, không phải lỗi văn phong.
//   - 0 ở hàng chục, có hàng đơn vị  -> "linh"   (105 = một trăm linh năm)
//   - 10..19                          -> "mười"   (15 = mười lăm, không phải "một mươi")
//   - chục >= 2                       -> "mươi"   (25 = hai mươi lăm)
//   - đơn vị 1 khi chục >= 2          -> "mốt"    (21 = hai mươi mốt; 11 vẫn là "mười một")
//   - đơn vị 5 khi có chục            -> "lăm"    (15, 25; 105 vẫn là "linh năm")
//   - đơn vị 4 khi chục >= 2          -> "tư"     (24 = hai mươi tư)
//   - nhóm giữa có hàng trăm = 0      -> "không trăm" (1.005.000 = một triệu không trăm linh năm nghìn)

const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

/**
 * Đọc một nhóm 3 chữ số (0..999).
 * `full` = nhóm này đứng SAU một nhóm khác khác 0, nên phải đọc đủ "không trăm", "linh".
 */
function readTriple(n: number, full: boolean): string {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const units = n % 10;
  const words: string[] = [];

  if (hundreds > 0 || full) {
    words.push(DIGITS[hundreds], "trăm");
  }

  if (tens === 0) {
    // "linh" chỉ khi đằng trước đã có "trăm" được đọc ra.
    if (units > 0 && (hundreds > 0 || full)) words.push("linh");
  } else if (tens === 1) {
    words.push("mười");
  } else {
    words.push(DIGITS[tens], "mươi");
  }

  if (units > 0) {
    if (units === 1 && tens >= 2) words.push("mốt");
    else if (units === 5 && tens >= 1) words.push("lăm");
    else if (units === 4 && tens >= 2) words.push("tư");
    else words.push(DIGITS[units]);
  }

  return words.join(" ");
}

const GROUP_NAMES = ["", "nghìn", "triệu"];

function readBelowBillion(n: number, full: boolean): string {
  // Tách thành [đơn vị, nghìn, triệu].
  const groups = [n % 1000, Math.floor(n / 1000) % 1000, Math.floor(n / 1_000_000) % 1000];
  const parts: string[] = [];

  // Nhóm cao nhất khác 0 — các nhóm SAU nó phải đọc đầy đủ.
  let highest = -1;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] > 0) {
      highest = i;
      break;
    }
  }

  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const value = groups[i];
    if (value === 0) continue;
    const mustReadFull = full || i < highest;
    parts.push(readTriple(value, mustReadFull));
    if (GROUP_NAMES[i]) parts.push(GROUP_NAMES[i]);
  }

  return parts.join(" ");
}

function readNumber(n: number): string {
  if (n === 0) return "không";

  // "tỷ" lặp lại cho số rất lớn (1 nghìn tỷ = "một nghìn tỷ"), nên xử lý đệ quy phần trên tỷ.
  const billions = Math.floor(n / 1_000_000_000);
  const rest = n % 1_000_000_000;
  const parts: string[] = [];

  if (billions > 0) {
    parts.push(readNumber(billions), "tỷ");
  }
  if (rest > 0) {
    parts.push(readBelowBillion(rest, billions > 0));
  }

  return parts.join(" ");
}

/**
 * `1250000` -> "Một triệu hai trăm năm mươi nghìn đồng"
 *
 * Làm tròn về đồng nguyên: tiền trong hệ thống này luôn là số nguyên VND, nhưng hàm vẫn
 * có thể nhận kết quả phép nhân thuế — đọc "phẩy năm đồng" trên hoá đơn là vô nghĩa.
 */
export function vndToWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  const text = readNumber(n);
  const sentence = `${amount < 0 ? "âm " : ""}${text} đồng`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
