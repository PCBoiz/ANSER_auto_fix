// Thoát ký tự HTML. Tên khách hàng, ghi chú, tên phụ tùng là dữ liệu người dùng nhập —
// không được chèn thô vào email hay bất kỳ chuỗi HTML nào. Module thuần, dùng chung.
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
