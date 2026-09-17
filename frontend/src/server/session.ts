import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/server/auth";
import { getEmployeeById } from "@/server/store/employees";
import { findUserById, type Role, type User } from "@/server/store/users";

export async function getSessionUser(): Promise<User | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return undefined;
  return findUserById(payload.sub);
}

const ROLE_RANK: Record<Role, number> = { staff: 1, manager: 2, admin: 3 };

// Tài khoản đang mang mật khẩu tạm chưa đổi thì KHÔNG được chạm vào dữ liệu nghiệp vụ.
//
// Chặn ở đây, không chỉ ở giao diện: mật khẩu tạm thường do quản lý đọc qua điện thoại
// hoặc nhắn tin, tức là đã đi qua kênh không an toàn. Nếu chỉ chặn bằng cách chuyển
// hướng trang, người biết mật khẩu đó vẫn gọi thẳng `/api/customers` bằng curl và đọc
// sạch danh sách khách hàng. `requireUser()` là cửa chung của 44/51 route nên vá một
// chỗ là kín cả hệ thống.
//
// `getSessionUser()` CỐ Ý không chặn — `/api/auth/me` (xem mình là ai) và chính thao
// tác đổi mật khẩu vẫn phải chạy được, nếu không người dùng bị khoá vĩnh viễn ở ngoài.
function blockedByTempPassword(user: User | undefined): boolean {
  return Boolean(user?.mustChangePassword);
}

// Kiểm tra quyền ở TỪNG route, không dựa vào proxy.ts: proxy chỉ chặn theo đường
// dẫn, một lần đổi matcher là mất sạch lớp bảo vệ mà không ai nhận ra.
export async function requireRole(minimum: Role): Promise<User | undefined> {
  const user = await getSessionUser();
  if (!user || blockedByTempPassword(user)) return undefined;
  const rank = ROLE_RANK[user.role as Role];
  if (!rank || rank < ROLE_RANK[minimum]) return undefined;
  return user;
}

export async function requireUser() {
  const user = await getSessionUser();
  return blockedByTempPassword(user) ? undefined : user;
}

export async function requireManager() {
  return requireRole("manager");
}

export async function requireAdmin() {
  return requireRole("admin");
}

// "Luồng" giao diện — khác role (staff/manager/admin, cấp QUYỀN): flow chọn BỘ TÍNH NĂNG
// hiển thị, suy từ chức vụ hồ sơ nhân sự liên kết (users.employeeId). manager/admin luôn
// thấy đủ tính năng (cần bao quát toàn xưởng); chỉ tài khoản "staff" mới bị thu hẹp xuống
// luồng kế toán/KTV, và chỉ khi có liên kết nhân sự đúng chức vụ — chưa liên kết thì vẫn
// coi như "manager" (hành vi hôm nay, để tài khoản staff cũ không đột nhiên mất tính năng).
export type UserFlow = "manager" | "accountant" | "technician";

export async function resolveUserFlow(user: User): Promise<UserFlow> {
  if (user.role !== "staff") return "manager";
  if (!user.employeeId) return "manager";

  const employee = await getEmployeeById(user.employeeId);
  if (employee?.position === "Kế toán") return "accountant";
  if (employee?.position === "Kỹ thuật viên") return "technician";
  return "manager";
}

// Trả cả nhân sự liên kết (nếu có) — trang chấm công/nhận việc cần biết đúng employeeId
// của người đang đăng nhập để tự lọc dữ liệu, không nhận employeeId từ phía client.
export async function requireEmployeeLink() {
  const user = await getSessionUser();
  if (!user || blockedByTempPassword(user)) return undefined;
  if (!user.employeeId) return { user, employee: undefined };
  const employee = await getEmployeeById(user.employeeId);
  return { user, employee };
}

// Ai được xem TỔNG HỢP giờ công của toàn bộ nhân sự (để tính lương) — theo quyết định
// 20/08/2026: cả quản lý/admin lẫn tài khoản đã gán luồng kế toán, KHÔNG phải staff
// thường (kể cả khi staff đó rơi vào flow "manager" mặc định vì chưa liên kết nhân sự —
// mặc định đó chỉ dùng để không mất MENU, không phải để mở dữ liệu nhạy cảm).
export async function requirePayrollViewer(): Promise<User | undefined> {
  const user = await getSessionUser();
  if (!user || blockedByTempPassword(user)) return undefined;
  if (user.role !== "staff") return user;
  const flow = await resolveUserFlow(user);
  return flow === "accountant" ? user : undefined;
}
