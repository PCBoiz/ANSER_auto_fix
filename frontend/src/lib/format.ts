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
// `formatDate` từng gọi `toLocaleDateString("vi-VN")` không kèm `timeZone`, tức là lấy
// múi giờ của MÁY đang chạy hàm. Trong trình duyệt ở Việt Nam thì luôn đúng, nên lỗi này
// nằm im chừng nào mọi nơi gọi `formatDate` còn là client component.
//
// Nó nổ khi hàm chạy PHÍA SERVER (Server Component, trang in hoá đơn) trên máy chủ UTC —
// gần như mọi nơi deploy. Mốc thời gian tạo trong khoảng 00:00–07:00 giờ Việt Nam rơi vào
// NGÀY HÔM TRƯỚC theo UTC: chấm công vào ca 6h30 sáng 18/09 lưu thành `17/09 23:30Z` và
// hiện ra "17/9". Hoá đơn lập sớm cũng vậy.
//
// Không ảnh hưởng chứng từ sổ kế toán: chúng là ngày thuần, lưu ở `00:00Z`, nên hiện đúng
// ngày ở cả hai múi giờ. (Đã đo trên 368 chứng từ thật ngày 17/09/2026 để chắc chắn.)
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
