import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  automationRules,
  branches,
  companySettings,
  employees,
  parts,
  services,
  users,
} from "@/server/db/schema";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/server/domain";
import { belowThresholdSql } from "@/server/store/parts";

// "Kiểm tra sẵn sàng vận hành" — trả lời một câu hỏi duy nhất: hệ thống này đã dùng được
// cho gara thật chưa, hay còn dữ liệu mẫu và cấu hình bỏ trống?
//
// Vì sao là code chứ không phải một checklist trong tài liệu: checklist trong tài liệu
// mô tả tình trạng tại lúc viết nó. Cái này ĐỌC DB ngay lúc mở trang, nên không bao giờ
// nói sai về hiện trạng — và tự tắt khi việc đã xong, thay vì nằm lại trong file .md mà
// không ai biết còn đúng hay không.

export type ReadinessSeverity = "blocker" | "warning" | "ok";

export type ReadinessItem = {
  id: string;
  /** "blocker" = không được đưa vào dùng thật; "warning" = dùng được nhưng sẽ vướng. */
  severity: ReadinessSeverity;
  group: "Bảo mật" | "Dữ liệu" | "Cấu hình" | "Tự động hoá";
  title: string;
  /** Hiện trạng đo được. Luôn kèm CON SỐ — "còn vài mã chưa có giá" không hành động được. */
  detail: string;
  /** Làm gì để hết. Một câu, chỉ đúng nơi cần bấm. */
  fix: string;
  href?: string;
};

// Mã phụ tùng và dịch vụ do `seedInitialData()` tạo lúc DB còn rỗng. Chúng là dữ liệu
// MINH HOẠ (lọc dầu Toyota, lốp 205/55 R16...), không phải hàng thật của gara — nằm lẫn
// trong kho thật thì thủ kho sẽ xuất nhầm một mặt hàng không hề tồn tại trên kệ.
const DEMO_PART_CODES = ["PT-001", "PT-002", "PT-003", "PT-004", "PT-005", "PT-006", "PT-007"];
const DEMO_SERVICE_CODES = ["DV-001", "DV-002", "DV-003", "DV-004", "DV-005", "DV-006", "DV-007", "DV-008"];

// Mật khẩu từng nằm CÔNG KHAI trong mã nguồn (trang đăng nhập + README + lịch sử git).
//
// Liệt kê lại ở đây không làm lộ thêm gì — chúng đã nằm vĩnh viễn trong lịch sử git của repo.
// Mục đích ngược lại: dò xem tài khoản nào VẪN đang dùng chúng. Đổi email mà giữ mật khẩu cũ
// thì vẫn là cửa mở; kiểm tra theo đuôi email "@anser.auto" không bắt được trường hợp đó.
const LEAKED_PASSWORDS = ["demo1234", "aa660156", "f7820a49"];

const VIETNAMESE_DIACRITICS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

// Từ tiếng Việt hay gặp trong tên xưởng, viết KHÔNG dấu.
const UNACCENTED_VI_WORDS = new Set([
  "xuong", "son", "go", "han", "may", "dong", "sua", "chua", "xe", "oto",
  "chi", "nhanh", "trung", "tam", "co", "khi", "gam", "dien",
]);

/**
 * Tên chi nhánh có vẻ bị mất dấu tiếng Việt hay không.
 *
 * Không thể chỉ kiểm tra "có dấu hay không": "Gara Ford" là tên đúng và không có dấu nào.
 * Điều kiện là KHÔNG có dấu nào VÀ có từ 2 từ tiếng Việt viết không dấu trở lên —
 * "Xuong son go han" khớp 4 từ, còn "Gara Ford" khớp 0.
 */
export function looksUnaccented(name: string): boolean {
  if (VIETNAMESE_DIACRITICS.test(name)) return false;
  const hits = name
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .filter((w) => UNACCENTED_VI_WORDS.has(w));
  return hits.length >= 2;
}

export type ReadinessReport = {
  checkedAt: Date;
  blockers: number;
  warnings: number;
  items: ReadinessItem[];
};

export async function getReadinessReport(): Promise<ReadinessReport> {
  const items: ReadinessItem[] = [];

  // Gom mọi phép đếm vào MỘT câu truy vấn. Trang này mở ra để xem "còn vướng gì" — chạy
  // 12 truy vấn tuần tự qua WebSocket tới Neon (mỗi cái ~250ms từ Việt Nam) là 3 giây
  // chờ cho một bảng tổng hợp.
  const [counts] = await db
    .select({
      usersTotal: sql<number>`(select count(*) from ${users})::int`,
      usersTempPassword: sql<number>`(select count(*) from ${users} where ${users.mustChangePassword})::int`,
      admins: sql<number>`(select count(*) from ${users} where ${users.role} = 'admin')::int`,
      demoDomainUsers: sql<number>`(select count(*) from ${users} where ${users.email} like '%@anser.auto')::int`,
      partsTotal: sql<number>`(select count(*) from ${parts})::int`,
      partsNoPrice: sql<number>`(select count(*) from ${parts} where ${parts.price} = 0)::int`,
      partsNoThreshold: sql<number>`(select count(*) from ${parts} where ${parts.minStock} is null)::int`,
      partsNoCost: sql<number>`(select count(*) from ${parts} where ${parts.cost} is null)::int`,
      lowStockRows: sql<number>`(select count(*) from ${parts} where ${belowThresholdSql(DEFAULT_LOW_STOCK_THRESHOLD)})::int`,
      demoParts: sql<number>`(select count(*) from ${parts} where ${parts.code} in ${DEMO_PART_CODES})::int`,
      demoServices: sql<number>`(select count(*) from ${services} where ${services.code} in ${DEMO_SERVICE_CODES})::int`,
      testEmployees: sql<number>`(select count(*) from ${employees} where ${employees.name} ilike '%(test)%')::int`,
      branchesNoEmail: sql<number>`(select count(*) from ${branches} where ${branches.notificationEmail} is null)::int`,
      branchesNoSpecialty: sql<number>`(select count(*) from ${branches} where ${branches.specialty} is null)::int`,
      rulesTotal: sql<number>`(select count(*) from ${automationRules})::int`,
      rulesUnlinked: sql<number>`(select count(*) from ${automationRules} where ${automationRules.enabled} and ${automationRules.n8nWorkflowId} is null)::int`,
      // "Chưa từng chạy" = chưa có nhịp nào từ nguồn LỊCH (n8n/cron). Lần gọi thử bằng tay
      // không được tính — xem SCHEDULED_SOURCES trong automation/rules.ts.
      rulesNeverRan: sql<number>`(select count(*) from ${automationRules} where ${automationRules.enabled} and (${automationRules.lastRunAt} is null or ${automationRules.lastRunSource} not in ('schedule', 'n8n', 'cron')))::int`,
      rulesStale: sql<number>`(select count(*) from ${automationRules} where ${automationRules.enabled} and ${automationRules.lastRunAt} < now() - interval '48 hours')::int`,
    })
    .from(sql`(select 1) as _`);

  const [settings] = await db.select().from(companySettings).limit(1);
  const allBranches = await db.select().from(branches);
  const allUsers = await db
    .select({ email: users.email, passwordHash: users.passwordHash, mustChangePassword: users.mustChangePassword })
    .from(users);

  // bcrypt cố ý chậm (~70ms mỗi lần so) — gara có vài tài khoản nên vài trăm ms là chấp nhận
  // được cho một trang mở vài lần mỗi tuần. Tài khoản đang bị bắt đổi mật khẩu thì bỏ qua:
  // họ không vào được dữ liệu cho tới khi đổi xong.
  const leakedAccounts: string[] = [];
  for (const u of allUsers) {
    if (u.mustChangePassword) continue;
    for (const leaked of LEAKED_PASSWORDS) {
      if (await bcrypt.compare(leaked, u.passwordHash)) {
        leakedAccounts.push(u.email);
        break;
      }
    }
  }

  // --- Bảo mật ---

  if (counts.admins === 0) {
    items.push({
      id: "no-admin",
      severity: "blocker",
      group: "Bảo mật",
      title: "Không có quản trị viên nào",
      detail: "Không tài khoản nào mang vai trò admin.",
      fix: "Đặt BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD rồi khởi động lại server.",
    });
  }

  if (process.env.ALLOW_PUBLIC_REGISTER === "true") {
    items.push({
      id: "public-register-open",
      severity: "blocker",
      group: "Bảo mật",
      title: "Đăng ký công khai đang mở",
      detail:
        "ALLOW_PUBLIC_REGISTER=true — bất kỳ ai biết địa chỉ trang đều tự tạo được tài khoản và xem được khách hàng, xe, hoá đơn, kho.",
      fix: "Xoá biến ALLOW_PUBLIC_REGISTER khỏi môi trường production rồi khởi động lại.",
    });
  }

  if (leakedAccounts.length > 0) {
    items.push({
      id: "leaked-passwords",
      severity: "blocker",
      group: "Bảo mật",
      title: `${leakedAccounts.length} tài khoản vẫn dùng mật khẩu đã lộ`,
      detail: `${leakedAccounts.join(", ")} — mật khẩu của các tài khoản này từng nằm công khai trong mã nguồn và lịch sử git. Ai đọc được repo đều đăng nhập được.`,
      fix: "Vào Tài khoản → Đặt lại mật khẩu (hệ thống bắt đổi tiếp ở lần đăng nhập sau). Tài khoản demo là admin duy nhất thì đổi luôn email sang email thật của chủ gara.",
      href: "/dashboard/accounts",
    });
  }

  if (counts.demoDomainUsers > 0) {
    items.push({
      id: "demo-accounts",
      severity: "warning",
      group: "Bảo mật",
      title: `Còn ${counts.demoDomainUsers} tài khoản dùng email mẫu @anser.auto`,
      detail: "Tên miền anser.auto không phải email thật của ai — thư đặt lại mật khẩu hay thông báo gửi tới đó đều mất.",
      fix: "Vào Tài khoản → Sửa → đổi sang email thật của người dùng, hoặc xoá nếu không dùng.",
      href: "/dashboard/accounts",
    });
  }

  if (counts.usersTempPassword > 0) {
    items.push({
      id: "temp-passwords",
      severity: "warning",
      group: "Bảo mật",
      title: `${counts.usersTempPassword} tài khoản chưa đổi mật khẩu tạm`,
      detail: "Các tài khoản này chưa đăng nhập lần nào, hoặc đăng nhập rồi nhưng bỏ qua bước đổi mật khẩu.",
      fix: "Nhắc người dùng đăng nhập — hệ thống sẽ tự chặn ở trang đổi mật khẩu, họ không vào được nơi khác.",
      href: "/dashboard/accounts",
    });
  }

  if (process.env.NODE_ENV === "production" && !process.env.N8N_INTERNAL_TOKEN) {
    items.push({
      id: "no-internal-token",
      severity: "warning",
      group: "Bảo mật",
      title: "Chưa đặt N8N_INTERNAL_TOKEN",
      detail:
        "Các endpoint /api/n8n/internal/* đang trả 503 ở production, nên mọi workflow tự động hoá đều hỏng.",
      fix: "Sinh một chuỗi ngẫu nhiên dài, đặt vào biến môi trường và dán đúng chuỗi đó vào các node HTTP Request trong n8n.",
    });
  }

  // --- Dữ liệu ---

  if (counts.demoParts > 0 || counts.demoServices > 0 || counts.testEmployees > 0) {
    const bits = [
      counts.demoParts > 0 ? `${counts.demoParts} phụ tùng mẫu` : null,
      counts.demoServices > 0 ? `${counts.demoServices} hạng mục dịch vụ mẫu` : null,
      counts.testEmployees > 0 ? `${counts.testEmployees} hồ sơ nhân sự ghi "(test)"` : null,
    ].filter(Boolean);
    items.push({
      id: "demo-data",
      severity: "blocker",
      group: "Dữ liệu",
      title: "Dữ liệu mẫu còn lẫn với dữ liệu thật",
      detail: `Còn ${bits.join(", ")}. Đây là dữ liệu minh hoạ do hệ thống tự tạo lúc DB còn rỗng, không phải hàng và người thật của gara.`,
      fix: "Chạy `npm run data:clean-demo` để xem trước và xoá (script từ chối xoá thứ đã phát sinh giao dịch).",
      href: "/dashboard/parts",
    });
  }

  if (counts.partsNoPrice > 0) {
    items.push({
      id: "parts-no-price",
      severity: "blocker",
      group: "Dữ liệu",
      title: `${counts.partsNoPrice}/${counts.partsTotal} phụ tùng chưa có giá bán`,
      detail:
        "Giá bán đang là 0đ. Xuất những phụ tùng này vào lệnh sửa chữa sẽ ra dòng 0đ, khách không bị tính tiền vật tư.",
      fix: "Mở Kho phụ tùng → Nhập giá hàng loạt, lọc “chưa có giá bán” rồi điền theo lô.",
      href: "/dashboard/parts/bulk",
    });
  }

  if (counts.partsNoCost > 0) {
    items.push({
      id: "parts-no-cost",
      severity: "warning",
      group: "Dữ liệu",
      title: `${counts.partsNoCost} phụ tùng chưa có giá vốn`,
      detail:
        "Báo cáo lãi gộp bỏ qua các mặt hàng này (giá vốn null = chưa biết, cố ý khác 0), nên con số lãi sẽ thiếu phần của chúng.",
      fix: "Điền dần khi nhập kho — mỗi phiếu nhập có ghi đơn giá sẽ tự cập nhật giá vốn.",
      href: "/dashboard/parts",
    });
  }

  // --- Cấu hình ---

  const missingCompanyFields = [
    !settings?.address ? "địa chỉ" : null,
    !settings?.phone ? "điện thoại" : null,
    !settings?.taxCode ? "mã số thuế" : null,
    !settings?.email ? "email" : null,
  ].filter(Boolean);

  if (!settings || settings.name === "ANSER Auto" || missingCompanyFields.length > 0) {
    items.push({
      id: "company-placeholder",
      severity: "blocker",
      group: "Cấu hình",
      title: "Thông tin doanh nghiệp còn để trống",
      detail:
        settings?.name === "ANSER Auto"
          ? `Tên vẫn là "ANSER Auto" (giá trị mặc định của hệ thống)${missingCompanyFields.length ? `, và còn thiếu ${missingCompanyFields.join(", ")}` : ""}.`
          : `Còn thiếu ${missingCompanyFields.join(", ")}.`,
      fix: "Vào Cài đặt → điền tên gara, địa chỉ, điện thoại, mã số thuế. Những thông tin này in lên hoá đơn giao cho khách.",
      href: "/dashboard/settings",
    });
  }

  const unaccentedBranches = allBranches.filter((b) => looksUnaccented(b.name));
  if (unaccentedBranches.length > 0) {
    items.push({
      id: "branch-unaccented",
      severity: "warning",
      group: "Cấu hình",
      title: `${unaccentedBranches.length} chi nhánh có tên thiếu dấu tiếng Việt`,
      detail: `Tên hiện tại: ${unaccentedBranches.map((b) => `"${b.name}"`).join(", ")}. Tên này in lên phiếu giao khách.`,
      fix: "Vào Chi nhánh → sửa lại tên có dấu.",
      href: "/dashboard/branches",
    });
  }

  if (counts.branchesNoSpecialty > 0) {
    items.push({
      id: "branch-no-specialty",
      severity: "warning",
      group: "Cấu hình",
      title: `${counts.branchesNoSpecialty} chi nhánh chưa khai chuyên môn`,
      detail:
        "Không phân biệt được xưởng máy với xưởng đồng-sơn, nên lúc thêm dòng công hệ thống không gợi ý được xưởng nào làm việc đó.",
      fix: "Vào Chi nhánh → chọn chuyên môn cho từng xưởng.",
      href: "/dashboard/branches",
    });
  }

  if (counts.branchesNoEmail > 0) {
    items.push({
      id: "branch-no-email",
      severity: "warning",
      group: "Cấu hình",
      title: `${counts.branchesNoEmail} chi nhánh chưa có email nhận cảnh báo`,
      detail:
        "Cảnh báo tồn kho thấp của chi nhánh sẽ rơi về email chung trong N8N_NOTIFY_EMAIL thay vì tới đúng thủ kho phụ trách.",
      fix: "Vào Chi nhánh → điền email nhận cảnh báo cho từng xưởng.",
      href: "/dashboard/branches",
    });
  }

  // --- Tự động hoá ---

  // Ngưỡng tồn kho bỏ trống thì mọi mặt hàng dùng chung mức mặc định 5. Với kho đồng-sơn
  // (phần lớn là vật tư đặt theo xe, tồn 0 là bình thường), điều đó biến cảnh báo thành
  // một email liệt kê gần như TOÀN BỘ kho, gửi lại mỗi 6 giờ. Cảnh báo mà lần nào cũng
  // kêu thì chỉ dạy người nhận bỏ qua nó.
  if (counts.lowStockRows > 50) {
    items.push({
      id: "low-stock-noise",
      severity: "blocker",
      group: "Tự động hoá",
      title: `Cảnh báo tồn kho sẽ liệt kê ${counts.lowStockRows} mặt hàng mỗi lần chạy`,
      detail: `${counts.partsNoThreshold} phụ tùng chưa đặt ngưỡng riêng nên dùng chung mức mặc định 5. Email dài như vậy sẽ bị bỏ qua ngay từ lần thứ hai.`,
      fix: "Đặt ngưỡng cho nhóm phụ tùng thật sự cần giữ tồn, và để 0 cho vật tư đặt theo xe. Kho phụ tùng → Đặt ngưỡng hàng loạt.",
      href: "/dashboard/parts/bulk",
    });
  }

  if (counts.rulesUnlinked > 0) {
    items.push({
      id: "rules-unlinked",
      severity: "warning",
      group: "Tự động hoá",
      title: `${counts.rulesUnlinked} quy tắc đang bật nhưng chưa nối với workflow n8n`,
      detail:
        "Quy tắc hiện “Đang bật” trong app nhưng không có workflow nào thực thi — bật ở đây chỉ là ghi chú trong DB.",
      fix: "Vào Tự động hoá → bấm “Dò workflow” để nối, hoặc import file JSON mẫu vào n8n trước.",
      href: "/dashboard/automation",
    });
  }

  if (counts.rulesNeverRan > 0) {
    items.push({
      id: "rules-never-ran",
      severity: "warning",
      group: "Tự động hoá",
      title: `${counts.rulesNeverRan} quy tắc chưa từng chạy lần nào`,
      detail:
        "Chưa có nhịp tim nào gửi về từ workflow. Đây chính là câu hỏi “n8n có tự chạy đúng lịch không” — và câu trả lời hiện tại là chưa xác nhận được.",
      fix: "Bật n8n (docker compose up -d), import workflow, rồi đợi tới giờ chạy. Cột “Lần chạy gần nhất” sẽ tự có dữ liệu.",
      href: "/dashboard/automation",
    });
  } else if (counts.rulesStale > 0) {
    items.push({
      id: "rules-stale",
      severity: "warning",
      group: "Tự động hoá",
      title: `${counts.rulesStale} quy tắc quá 48 giờ không chạy`,
      detail: "Quy tắc từng chạy được nhưng đã im lặng hơn 2 ngày — nhiều khả năng n8n đang tắt.",
      fix: "Kiểm tra container n8n còn sống không, và xem lịch sử chạy ở trang Tự động hoá.",
      href: "/dashboard/automation",
    });
  }

  const blockers = items.filter((i) => i.severity === "blocker").length;
  const warnings = items.filter((i) => i.severity === "warning").length;

  return { checkedAt: new Date(), blockers, warnings, items };
}
