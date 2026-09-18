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
import { isN8nApiConfigured, listN8nWorkflows } from "@/server/n8nApi";
import { WORKFLOW_NAMES } from "@/server/store/automation";
import { belowThresholdSql } from "@/server/store/parts";
import { SEED_PARTS, SEED_SERVICES } from "@/server/store/seed";
import { looksUnaccented } from "@/lib/vietnamese";
import { getSystemState } from "@/server/store/systemState";

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

// Dữ liệu MINH HOẠ do `seedDemoData()` tạo (lọc dầu Toyota, lốp 205/55 R16...) — không phải
// hàng thật của gara. Đối chiếu bằng CẢ mã LẪN tên đúng như bản seed: nếu chỉ dò theo mã,
// ngày gara tự đặt "DV-001" cho một hạng mục thật, bộ kiểm tra sẽ đòi xoá nó.
const DEMO_PART_CODES = SEED_PARTS.map((p) => p.code);
const DEMO_PART_NAMES = SEED_PARTS.map((p) => p.name);
const DEMO_SERVICE_CODES = SEED_SERVICES.map((s) => s.code);
const DEMO_SERVICE_NAMES = SEED_SERVICES.map((s) => s.name);

// Mật khẩu từng nằm CÔNG KHAI trong mã nguồn (trang đăng nhập + README + lịch sử git).
//
// Liệt kê lại ở đây không làm lộ thêm gì — chúng đã nằm vĩnh viễn trong lịch sử git của repo.
// Mục đích ngược lại: dò xem tài khoản nào VẪN đang dùng chúng. Đổi email mà giữ mật khẩu cũ
// thì vẫn là cửa mở; kiểm tra theo đuôi email "@anser.auto" không bắt được trường hợp đó.
const LEAKED_PASSWORDS = ["demo1234", "aa660156", "f7820a49"];

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
      demoParts: sql<number>`(select count(*) from ${parts} where ${parts.code} in ${DEMO_PART_CODES} and ${parts.name} in ${DEMO_PART_NAMES})::int`,
      demoServices: sql<number>`(select count(*) from ${services} where ${services.code} in ${DEMO_SERVICE_CODES} and ${services.name} in ${DEMO_SERVICE_NAMES})::int`,
      testEmployees: sql<number>`(select count(*) from ${employees} where ${employees.name} ilike '%(test)%')::int`,
      branchesNoEmail: sql<number>`(select count(*) from ${branches} where ${branches.notificationEmail} is null)::int`,
      branchesNoSpecialty: sql<number>`(select count(*) from ${branches} where ${branches.specialty} is null)::int`,
      rulesTotal: sql<number>`(select count(*) from ${automationRules})::int`,
      // "Chưa từng chạy" = chưa có nhịp nào từ nguồn LỊCH (n8n/cron). Lần gọi thử bằng tay
      // không được tính — xem SCHEDULED_SOURCES trong automation/rules.ts.
      rulesNeverRan: sql<number>`(select count(*) from ${automationRules} where ${automationRules.enabled} and (${automationRules.lastRunAt} is null or ${automationRules.lastRunSource} not in ('schedule', 'n8n', 'cron')))::int`,
      rulesStale: sql<number>`(select count(*) from ${automationRules} where ${automationRules.enabled} and ${automationRules.lastRunAt} < now() - interval '48 hours')::int`,
    })
    .from(sql`(select 1) as _`);

  const [settings] = await db.select().from(companySettings).limit(1);
  const allBranches = await db.select().from(branches);
  const enabledRules = await db
    .select({ type: automationRules.type, name: automationRules.name })
    .from(automationRules)
    .where(sql`${automationRules.enabled}`);

  // Hỏi THẲNG n8n xem workflow nào đã import, thay vì đọc cột `n8n_workflow_id` trong DB —
  // cột đó chỉ được ghi khi bật/tắt qua app, nên 3 workflow import tay từ tháng 8 vẫn bị
  // đếm là "chưa nối". Không gọi được n8n thì không kết luận gì, chỉ báo là không hỏi được.
  let n8nReachable: boolean | null = null; // null = chưa cấu hình API
  let missingWorkflows: string[] = [];
  if (isN8nApiConfigured()) {
    try {
      const workflows = await listN8nWorkflows();
      n8nReachable = true;
      const names = new Set(workflows.map((w) => w.name));
      missingWorkflows = enabledRules
        .map((r) => WORKFLOW_NAMES[r.type as keyof typeof WORKFLOW_NAMES])
        .filter((name): name is string => Boolean(name) && !names.has(name));
    } catch {
      n8nReachable = false;
    }
  }
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

  // Sao lưu: đọc mốc do cả lịch tự động lẫn `npm run db:backup` ghi lại. Không cần biết bản
  // sao nằm ở đâu — chỉ cần biết lần cuối có một bản ĐỌC LẠI ĐƯỢC là bao giờ.
  const lastBackup = await getSystemState<{ at: string }>("backup:lastOk").catch(() => null);
  const backupAgeDays = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup.value.at).getTime()) / 86_400_000)
    : null;
  if (backupAgeDays === null || backupAgeDays > 7) {
    items.push({
      id: "no-recent-backup",
      severity: "warning",
      group: "Dữ liệu",
      title: backupAgeDays === null ? "Chưa có bản sao lưu nào" : `Bản sao lưu gần nhất đã ${backupAgeDays} ngày`,
      detail:
        "Neon có khôi phục theo thời điểm, nhưng nó nằm trong tài khoản Neon — mất tài khoản là mất luôn đường khôi phục. Cần một bản sao độc lập.",
      fix: "Tự host: đặt BACKUP_DIR (docker-compose.yml đã đặt sẵn) để sao lưu mỗi ngày lúc 2h. Máy khác: chạy `npm run db:backup` rồi chép file ra ổ ngoài.",
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

  if (n8nReachable === false) {
    items.push({
      id: "n8n-unreachable",
      severity: "warning",
      group: "Tự động hoá",
      title: "Không liên lạc được với n8n",
      detail:
        "Đã cấu hình N8N_API_URL nhưng n8n không phản hồi — thường là Docker chưa chạy. Mọi email tự động (nhắc khách, cảnh báo kho, báo cáo) đều không gửi cho tới khi n8n bật lại. Chuông thông báo trong app vẫn hoạt động.",
      fix: "Chạy `docker compose up -d` trong thư mục frontend, đợi ~30 giây rồi tải lại trang này.",
      href: "/dashboard/automation",
    });
  } else if (missingWorkflows.length > 0) {
    items.push({
      id: "rules-unlinked",
      severity: "warning",
      group: "Tự động hoá",
      title: `${missingWorkflows.length} quy tắc đang bật nhưng chưa có workflow trong n8n`,
      detail: `Thiếu: ${missingWorkflows.join("; ")}. Quy tắc bật trong app nhưng không có gì thực thi.`,
      fix: "Bộ canh gác sẽ tự tạo ở lượt tới; hoặc vào Tự động hoá → Đồng bộ workflow để tạo ngay. App tự nối theo tên workflow, không cần dán ID.",
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
      fix: "Bật n8n (docker compose up -d), vào Tự động hoá → Đồng bộ workflow, rồi đợi tới giờ chạy. Cột “Lần chạy gần nhất” sẽ tự có dữ liệu.",
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
