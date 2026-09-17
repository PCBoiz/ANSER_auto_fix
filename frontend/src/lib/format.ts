// Hàm định dạng thuần — KHÔNG đặt trong file có "use client".
//
// Trước đây chúng nằm trong `components/ui/PageShell.tsx`, vốn là client module; Server
// Component (trang Báo cáo) import vào là lỗi runtime "Attempted to call formatVnd() from
// the server but formatVnd is on the client". Tách ra đây để cả hai phía dùng chung.

export function formatVnd(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("vi-VN").format(amount) + "₫";
}

// Múi giờ của gara. Mọi hàm định dạng ngày/giờ PHẢI truyền tham số này.
//
// Bẫy đã dính: `formatDate` từng gọi `toLocaleDateString("vi-VN")` không kèm `timeZone`,
// tức là lấy múi giờ của MÁY đang chạy. Trên máy dev (ICT) thì đúng, nhưng server deploy
// hầu như luôn chạy UTC — và một chứng từ ngày 02/01/2025 lưu thành `2025-01-01T17:00Z`
// sẽ hiện ra "1/1/2025". Toàn bộ 368 chứng từ trong sổ kế toán lùi đúng một ngày, con số
// vẫn cộng đúng nên không ai nghi ngờ tới lúc đối chiếu với cơ quan thuế.
//
// Đây là loại lỗi chỉ xuất hiện SAU khi rời localhost, nên không thể phát hiện bằng cách
// dùng thử trên máy.
export const GARAGE_TIME_ZONE = "Asia/Ho_Chi_Minh";

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", { timeZone: GARAGE_TIME_ZONE });
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", { timeZone: GARAGE_TIME_ZONE });
}

// Ngày dạng `yyyy-mm-dd` THEO GIỜ GARA — dùng cho `<input type="date">` và cho khoá nhóm
// theo ngày trong báo cáo. `toISOString().slice(0,10)` là cách viết sai kinh điển ở đây:
// nó cắt theo UTC, nên 7 giờ sáng ở Việt Nam vẫn đang là ngày hôm trước.
export function toGarageDateInput(value: string | Date | null | undefined) {
  if (!value) return "";
  // en-CA cho ra đúng định dạng ISO `yyyy-mm-dd`.
  return new Date(value).toLocaleDateString("en-CA", { timeZone: GARAGE_TIME_ZONE });
}
