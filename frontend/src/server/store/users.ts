import bcrypt from "bcryptjs";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";

export type User = typeof users.$inferSelect;
export const ROLES = ["staff", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];
// "admin" dành riêng cho đội dev — khách hàng chỉ tự quản lý nhân sự của họ ở 2 cấp
// này qua trang Nhân sự (không tạo/thăng cấp lên admin được từ UI/API).
export const ASSIGNABLE_ROLES = ["staff", "manager"] as const;

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return rows[0];
}

export async function findUserById(id: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function listUsers() {
  return db.select().from(users).orderBy(asc(users.firstName));
}

// Đếm tài khoản — `POST /api/auth/register` dùng để biết đây có phải lần cài đặt đầu tiên
// (DB chưa có ai) hay không. Đếm bằng SQL thay vì `listUsers().length`: hàm này chạy ở
// MỌI lần gọi đăng ký, kéo cả bảng về chỉ để đếm là lãng phí không có lý do.
export async function countUsers() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}

export async function createUser(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role?: Role;
  employeeId?: string;
  mustChangePassword?: boolean;
}): Promise<User> {
  const rows = await db
    .insert(users)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: input.role ?? "staff",
      employeeId: input.employeeId,
      mustChangePassword: input.mustChangePassword ?? false,
    })
    .returning();
  return rows[0];
}

export async function updateUser(
  id: string,
  patch: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    passwordHash: string;
    role: Role;
    employeeId: string | null;
    mustChangePassword: boolean;
  }>,
): Promise<User | undefined> {
  const normalized = patch.email ? { ...patch, email: patch.email.toLowerCase() } : patch;
  const rows = await db.update(users).set(normalized).where(eq(users.id, id)).returning();
  return rows[0];
}

export async function deleteUser(id: string) {
  await db.delete(users).where(eq(users.id, id));
}

export async function countAdmins() {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  return rows.length;
}

// Bỏ passwordHash trước khi trả ra ngoài — mọi route trả thông tin user đều phải đi
// qua hàm này thay vì tự chọn field, để thêm cột nhạy cảm sau này không lọt ra API.
export function toPublicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

// Khởi tạo tài khoản quản trị đầu tiên.
//
// THAY CHO `seedDemoUser()` CŨ (17/09/2026). Bản cũ tạo `demo@anser.auto` / `demo1234`
// với role `admin` ở MỌI lần server khởi động, và còn tự nâng lại lên `admin` nếu ai đó
// hạ cấp nó xuống. Mật khẩu đó nằm công khai trong README và trong trang đăng nhập, nên
// trên bản deploy thật nó là một cửa hậu quản trị vĩnh viễn mà không cách nào đóng từ
// trong giao diện — hạ quyền cũng vô ích vì lần khởi động sau nó lên lại.
//
// Nay: chỉ tạo khi được khai báo TƯỜNG MINH bằng env, và chỉ khi DB chưa có tài khoản
// quản trị nào. Không có env thì không tạo gì cả — hệ thống trống sẽ mở đúng một cửa
// đăng ký đầu tiên (xem `POST /api/auth/register`), đó là cách bootstrap an toàn hơn
// một mật khẩu mặc định ai cũng biết.
export async function seedBootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) return;

  if (password.length < 8) {
    console.warn(
      "[seed] Bỏ qua BOOTSTRAP_ADMIN: mật khẩu ngắn hơn 8 ký tự. Đặt một chuỗi dài hơn rồi khởi động lại.",
    );
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    // KHÔNG tự nâng quyền tài khoản đã tồn tại. Hành vi "tự backfill lên admin" của bản
    // cũ nghĩa là ai giữ được env cũ thì vĩnh viễn giành lại được quyền quản trị.
    return;
  }

  if (await countAdmins() > 0) {
    console.warn(
      `[seed] Bỏ qua BOOTSTRAP_ADMIN (${email}): hệ thống đã có quản trị viên. Cấp tài khoản qua trang Tài khoản.`,
    );
    return;
  }

  await createUser({
    firstName: "Quản trị",
    lastName: "Hệ thống",
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: "admin",
    // Mật khẩu này nằm trong file env, thường được chép qua chat/terminal — ép đổi ngay
    // ở lần đăng nhập đầu để nó không trở thành mật khẩu vĩnh viễn.
    mustChangePassword: true,
  });
  console.log(`[seed] Đã tạo tài khoản quản trị đầu tiên: ${email} (bắt buộc đổi mật khẩu khi đăng nhập).`);
}
