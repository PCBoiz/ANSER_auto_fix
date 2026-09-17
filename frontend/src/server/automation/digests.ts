import { and, asc, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  customers,
  purchaseLedger,
  salesLedger,
  serviceOrders,
  serviceOrderSpecialOrders,
  vehicles,
} from "@/server/db/schema";
import {
  ACTIVE_ORDER_STATUSES,
  SERVICE_ORDER_STATUS_LABELS,
  type ServiceOrderStatus,
} from "@/server/domain";
import { formatDate, formatDateTime, formatVnd } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { listUpcomingAppointments } from "@/server/store/appointments";
import { listUnpaidInvoicesOlderThan } from "@/server/store/invoices";
import { countLowStockParts, listLowStockParts } from "@/server/store/parts";
import { listOrdersAwaitingAcceptanceTooLong } from "@/server/store/serviceOrders";

// Bản tin tổng hợp — dựng NỘI DUNG email ngay trong app, không trong node Code của n8n.
//
// Vì sao: nội dung email là nghiệp vụ (chọn gì để báo, gộp thế nào, câu chữ ra sao). Viết
// trong node Code của n8n thì nó nằm trong một file JSON không ai review, không typecheck,
// không test được, và phải import lại bằng tay mỗi lần sửa một chữ. Dựng ở đây thì:
//   - mẫu email đi qua git và code review như mọi thứ khác;
//   - workflow n8n chỉ còn là "hẹn giờ -> gọi URL -> gửi email", gần như không bao giờ phải sửa;
//   - chuông thông báo trong app dùng CHÍNH dữ liệu này, nên email và màn hình không bao
//     giờ nói hai con số khác nhau.
//
// Vì sao GỘP thành bản tin: trước đây mỗi loại cảnh báo là một email rời, gửi theo lịch
// riêng. Quản lý xưởng nhận 4–5 email mỗi ngày từ cùng một hệ thống là công thức để tất cả
// bị bỏ qua. Một bản tin buổi sáng, sắp theo mức cần xử lý, là thứ người ta thực sự đọc.

// `esc` — xem lib/html.ts (module thuần, có test).
const esc = escapeHtml;

export type DigestSection = {
  key: string;
  title: string;
  /** "high" = cần xử lý hôm nay; "normal" = nên biết. Dùng để sắp thứ tự và tô màu. */
  priority: "high" | "normal";
  count: number;
  /** Câu tóm tắt một dòng — dùng làm nội dung chuông thông báo. */
  headline: string;
  rows: string[][];
  columns: string[];
  /** Dòng ghi chú dưới bảng, ví dụ "còn 694 mã nữa không liệt kê". */
  footnote?: string;
  href?: string;
};

export type Digest = {
  kind: "morning_brief" | "accounting_digest";
  subject: string;
  generatedAt: Date;
  sections: DigestSection[];
  /** Tổng số việc ở mọi mục — 0 thì workflow không cần gửi. */
  totalItems: number;
  html: string;
  text: string;
};

function renderHtml(title: string, intro: string, sections: DigestSection[], footer: string) {
  const blocks = sections
    .map((section) => {
      const color = section.priority === "high" ? "#b91c1c" : "#1f2937";
      const table =
        section.rows.length === 0
          ? ""
          : `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;margin-top:6px">`
            + `<tr>${section.columns.map((c) => `<th align="left" style="border-bottom:1px solid #d4d4d8;color:#52525b">${esc(c)}</th>`).join("")}</tr>`
            + section.rows
              .map((r) => `<tr>${r.map((cell) => `<td style="border-bottom:1px solid #f4f4f5">${esc(cell)}</td>`).join("")}</tr>`)
              .join("")
            + `</table>`;
      return `<div style="margin:18px 0">`
        + `<h3 style="margin:0;font-size:15px;color:${color}">${esc(section.title)} <span style="font-weight:normal;color:#71717a">(${section.count})</span></h3>`
        + `<p style="margin:4px 0 0;color:#3f3f46">${esc(section.headline)}</p>`
        + table
        + (section.footnote ? `<p style="margin:6px 0 0;color:#71717a;font-size:12px">${esc(section.footnote)}</p>` : "")
        + `</div>`;
    })
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;color:#18181b">`
    + `<h2 style="margin:0 0 4px">${esc(title)}</h2>`
    + `<p style="margin:0;color:#52525b">${esc(intro)}</p>`
    + blocks
    + `<p style="margin-top:24px;color:#a1a1aa;font-size:12px">${esc(footer)}</p>`
    + `</div>`;
}

function renderText(title: string, sections: DigestSection[]) {
  const lines = [title, ""];
  for (const s of sections) {
    lines.push(`## ${s.title} (${s.count})`, s.headline);
    for (const r of s.rows.slice(0, 10)) lines.push(`  - ${r.join(" | ")}`);
    if (s.footnote) lines.push(`  ${s.footnote}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Bản tin sáng cho quản lý xưởng
// ---------------------------------------------------------------------------

export async function buildMorningBrief(options: {
  companyName: string;
  /** Lệnh "chờ nghiệm thu" quá bao nhiêu ngày thì đưa vào bản tin. */
  awaitingDays: number;
  /** Liệt kê tối đa bao nhiêu phụ tùng sắp hết. */
  lowStockLimit: number;
  lowStockFallback: number;
}): Promise<Digest> {
  const now = new Date();
  // Đặt hàng ngoài chờ quá 3 ngày: xe đang nằm xưởng đợi đồ, là chi phí chỗ đỗ và là cuộc
  // gọi phàn nàn của khách sắp tới.
  const specialOrderStaleBefore = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const [
    activeByStatus,
    overdueOrders,
    appointmentsToday,
    awaiting,
    lowStockTotal,
    lowStockItems,
    staleSpecialOrders,
    unpaid,
  ] = await Promise.all([
    db
      .select({ status: serviceOrders.status, n: sql<number>`count(*)::int` })
      .from(serviceOrders)
      .where(inArray(serviceOrders.status, ACTIVE_ORDER_STATUSES))
      .groupBy(serviceOrders.status),
    // Quá hẹn trả xe: đã qua giờ hẹn mà xe chưa tới bước chờ nghiệm thu. Đây là thứ khách
    // sẽ gọi điện hỏi — quản lý phải biết TRƯỚC khi điện thoại reo.
    db
      .select({
        code: serviceOrders.code,
        plate: serviceOrders.plateSnapshot,
        status: serviceOrders.status,
        promisedAt: serviceOrders.promisedAt,
        customerName: customers.name,
        customerPhone: customers.phone,
      })
      .from(serviceOrders)
      .leftJoin(customers, eq(serviceOrders.customerId, customers.id))
      .where(
        and(
          lt(serviceOrders.promisedAt, now),
          notInArray(serviceOrders.status, ["awaiting_acceptance", "delivered", "cancelled"]),
        ),
      )
      .orderBy(asc(serviceOrders.promisedAt))
      .limit(50),
    listUpcomingAppointments(24),
    listOrdersAwaitingAcceptanceTooLong(options.awaitingDays),
    countLowStockParts({ fallbackThreshold: options.lowStockFallback }),
    listLowStockParts({ fallbackThreshold: options.lowStockFallback, limit: options.lowStockLimit }),
    db
      .select({
        name: serviceOrderSpecialOrders.name,
        supplier: serviceOrderSpecialOrders.supplier,
        orderedAt: serviceOrderSpecialOrders.orderedAt,
        orderCode: serviceOrders.code,
        plate: serviceOrders.plateSnapshot,
      })
      .from(serviceOrderSpecialOrders)
      .innerJoin(serviceOrders, eq(serviceOrderSpecialOrders.serviceOrderId, serviceOrders.id))
      .innerJoin(vehicles, eq(serviceOrders.vehicleId, vehicles.id))
      .where(
        and(
          eq(serviceOrderSpecialOrders.status, "ordered"),
          lt(serviceOrderSpecialOrders.orderedAt, specialOrderStaleBefore),
        ),
      )
      .orderBy(asc(serviceOrderSpecialOrders.orderedAt))
      .limit(30),
    listUnpaidInvoicesOlderThan(0),
  ]);

  const activeTotal = activeByStatus.reduce((sum, r) => sum + r.n, 0);
  const unpaidTotal = unpaid.reduce((sum, r) => sum + r.outstanding, 0);

  const sections: DigestSection[] = [
    {
      key: "overdue",
      title: "Xe quá hẹn trả",
      priority: "high",
      count: overdueOrders.length,
      headline:
        overdueOrders.length === 0
          ? "Không có xe nào quá hẹn trả."
          : `${overdueOrders.length} xe đã qua giờ hẹn trả mà chưa sửa xong — nên gọi báo khách trước.`,
      columns: ["Lệnh", "Biển số", "Trạng thái", "Hẹn trả", "Khách", "Điện thoại"],
      rows: overdueOrders.map((o) => [
        o.code,
        o.plate,
        SERVICE_ORDER_STATUS_LABELS[o.status as ServiceOrderStatus] ?? o.status,
        formatDateTime(o.promisedAt),
        o.customerName ?? "—",
        o.customerPhone ?? "—",
      ]),
      href: "/dashboard/orders",
    },
    {
      key: "awaiting",
      title: `Chờ nghiệm thu quá ${options.awaitingDays} ngày`,
      priority: "high",
      count: awaiting.length,
      headline:
        awaiting.length === 0
          ? "Không có xe nào nằm chờ khách tới nhận quá lâu."
          : `${awaiting.length} xe sửa xong nhưng khách chưa tới nhận — đang chiếm chỗ trong xưởng.`,
      columns: ["Lệnh", "Biển số", "Số ngày chờ", "Khách", "Điện thoại"],
      rows: awaiting.map((a) => [
        a.code,
        a.plateSnapshot,
        String(a.daysWaiting),
        a.customerName ?? "—",
        a.customerPhone ?? "—",
      ]),
      href: "/dashboard/orders",
    },
    {
      key: "special_orders",
      title: "Đặt hàng ngoài chờ quá 3 ngày",
      priority: "high",
      count: staleSpecialOrders.length,
      headline:
        staleSpecialOrders.length === 0
          ? "Không có phụ tùng đặt ngoài nào về trễ."
          : `${staleSpecialOrders.length} phụ tùng đặt ngoài chưa về sau 3 ngày — xe đang nằm đợi đồ.`,
      columns: ["Phụ tùng", "Nhà cung cấp", "Đặt ngày", "Lệnh", "Biển số"],
      rows: staleSpecialOrders.map((s) => [
        s.name,
        s.supplier ?? "—",
        formatDate(s.orderedAt),
        s.orderCode,
        s.plate,
      ]),
    },
    {
      key: "appointments",
      title: "Lịch hẹn 24 giờ tới",
      priority: "normal",
      count: appointmentsToday.length,
      headline:
        appointmentsToday.length === 0
          ? "Không có lịch hẹn nào trong 24 giờ tới."
          : `${appointmentsToday.length} lịch hẹn — ${appointmentsToday.filter((a) => !a.contactEmail).length} khách không có email, không nhận được thư nhắc tự động.`,
      columns: ["Giờ hẹn", "Khách", "Điện thoại", "Biển số", "Yêu cầu"],
      rows: appointmentsToday.map((a) => [
        formatDateTime(a.scheduledAt),
        a.contactName ?? "—",
        a.contactPhone ?? "—",
        a.plate ?? "—",
        a.requestNote ?? "",
      ]),
      href: "/dashboard/appointments",
    },
    {
      key: "low_stock",
      title: "Phụ tùng sắp hết",
      priority: "normal",
      count: lowStockTotal,
      headline:
        lowStockTotal === 0
          ? "Không có phụ tùng nào dưới ngưỡng."
          : `${lowStockTotal} mã dưới ngưỡng tồn${lowStockTotal > lowStockItems.length ? ` — liệt kê ${lowStockItems.length} mã tồn thấp nhất` : ""}.`,
      columns: ["Mã", "Tên", "Còn", "Ngưỡng", "Vị trí"],
      rows: lowStockItems.map((p) => [p.code, p.name, `${p.stock} ${p.unit}`, String(p.threshold), p.location ?? "—"]),
      footnote:
        lowStockTotal > 50
          ? `Hơn 50 mã dưới ngưỡng thường nghĩa là kho chưa đặt ngưỡng riêng cho vật tư đặt theo xe. Đặt ngưỡng 0 cho nhóm đó tại Kho phụ tùng → Nhập giá hàng loạt.`
          : undefined,
      href: "/dashboard/parts",
    },
    {
      key: "unpaid",
      title: "Hoá đơn chưa thu đủ",
      priority: "normal",
      count: unpaid.length,
      headline:
        unpaid.length === 0
          ? "Mọi hoá đơn đã thu đủ."
          : `${unpaid.length} hoá đơn còn nợ, tổng ${formatVnd(unpaidTotal)}.`,
      columns: ["Hoá đơn", "Khách", "Biển số", "Còn nợ", "Số ngày"],
      rows: unpaid.slice(0, 15).map((u) => [
        u.code,
        u.customerName,
        u.plateSnapshot,
        formatVnd(u.outstanding),
        String(u.daysOld),
      ]),
      footnote: unpaid.length > 15 ? `Còn ${unpaid.length - 15} hoá đơn nữa — xem đủ ở trang Hoá đơn.` : undefined,
      href: "/dashboard/invoices",
    },
  ];

  // Mục rỗng không đưa vào email: một bản tin toàn "không có gì" là bản tin dạy người ta
  // thôi mở. Nếu mọi mục đều rỗng thì `totalItems = 0` và workflow không gửi luôn.
  const nonEmpty = sections.filter((s) => s.count > 0);
  const actionable = sections.filter((s) => s.priority === "high").reduce((sum, s) => sum + s.count, 0);
  const totalItems = nonEmpty.reduce((sum, s) => sum + s.count, 0);

  const dateLabel = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const subject =
    actionable > 0
      ? `☀️ ${dateLabel}: ${actionable} việc cần xử lý hôm nay — ${activeTotal} xe trong xưởng`
      : `☀️ ${dateLabel}: ${activeTotal} xe trong xưởng, không có việc gấp`;

  const intro = `${activeTotal} xe đang trong xưởng${
    activeByStatus.length
      ? ` (${activeByStatus
          .map((r) => `${r.n} ${SERVICE_ORDER_STATUS_LABELS[r.status as ServiceOrderStatus]?.toLowerCase() ?? r.status}`)
          .join(", ")})`
      : ""
  }.`;
  const footer = `${options.companyName} — bản tin tạo lúc ${formatDateTime(now)}`;

  return {
    kind: "morning_brief",
    subject,
    generatedAt: now,
    sections: nonEmpty,
    totalItems,
    html: renderHtml(`Bản tin sáng ${dateLabel}`, intro, nonEmpty, footer),
    text: renderText(subject, nonEmpty),
  };
}

// ---------------------------------------------------------------------------
// Tổng hợp tuần cho kế toán
// ---------------------------------------------------------------------------

// Khoá gộp tên đối tác: bỏ khoảng trắng thừa + chữ thường. Đo trên dữ liệu thật: 5 khách
// trong sổ bán bị tách thành 2 dòng chỉ vì viết hoa khác nhau ("CÔNG TY BẢO HIỂM..." và
// "Công ty Bảo hiểm..."). Không gộp thì khách lớn nhất (319 triệu) xếp sau một khách 259
// triệu — mọi báo cáo theo khách đều sai thứ hạng.
const partnerKey = (column: typeof salesLedger.partnerName | typeof purchaseLedger.partnerName) =>
  sql<string>`lower(regexp_replace(trim(${column}), '\\s+', ' ', 'g'))`;

export async function buildAccountingDigest(options: {
  companyName: string;
  /** Chứng từ mua "chưa nhận hoá đơn" quá bao nhiêu ngày thì coi là cần đòi. */
  pendingInvoiceDays: number;
}): Promise<Digest> {
  const now = new Date();
  const pendingBefore = new Date(now.getTime() - options.pendingInvoiceDays * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [pendingBySupplier, deliveredNotInvoiced, splitPartners, weekSales, weekPurchases] =
    await Promise.all([
      // Hoá đơn đầu vào chưa nhận, gộp theo nhà cung cấp: kế toán đòi hoá đơn theo từng
      // nhà cung cấp, không phải theo từng chứng từ. Không có hoá đơn đầu vào hợp lệ thì
      // khoản chi đó không đủ hồ sơ khi quyết toán.
      db
        .select({
          partner: sql<string>`min(${purchaseLedger.partnerName})`,
          n: sql<number>`count(*)::int`,
          total: sql<number>`sum(${purchaseLedger.totalAmount})::bigint`,
          oldest: sql<Date>`min(${purchaseLedger.postingDate})`,
        })
        .from(purchaseLedger)
        .where(
          and(
            eq(purchaseLedger.invoiceStatus, "not_received"),
            lt(purchaseLedger.postingDate, pendingBefore),
          ),
        )
        .groupBy(partnerKey(purchaseLedger.partnerName))
        .orderBy(desc(sql`sum(${purchaseLedger.totalAmount})`)),
      // Đã giao hàng/hoàn thành dịch vụ mà chưa lập hoá đơn — thời điểm lập hoá đơn gắn với
      // thời điểm giao hàng/hoàn thành dịch vụ, để lâu là sai thời điểm lập hoá đơn.
      db
        .select({
          voucherNo: salesLedger.voucherNo,
          voucherDate: salesLedger.voucherDate,
          partnerName: salesLedger.partnerName,
          totalAmount: salesLedger.totalAmount,
        })
        .from(salesLedger)
        .where(and(eq(salesLedger.goodsDelivered, true), eq(salesLedger.invoiceIssued, false)))
        .orderBy(asc(salesLedger.voucherDate)),
      db
        .select({
          variants: sql<string>`string_agg(distinct ${salesLedger.partnerName}, ' | ')`,
          n: sql<number>`count(distinct ${salesLedger.partnerName})::int`,
          total: sql<number>`sum(${salesLedger.totalAmount})::bigint`,
        })
        .from(salesLedger)
        .groupBy(partnerKey(salesLedger.partnerName))
        .having(sql`count(distinct ${salesLedger.partnerName}) > 1`)
        .orderBy(desc(sql`sum(${salesLedger.totalAmount})`)),
      db
        .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${salesLedger.totalAmount}), 0)::bigint` })
        .from(salesLedger)
        .where(sql`${salesLedger.voucherDate} >= ${weekAgo}`),
      db
        .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${purchaseLedger.totalAmount}), 0)::bigint` })
        .from(purchaseLedger)
        .where(sql`${purchaseLedger.postingDate} >= ${weekAgo}`),
    ]);

  const pendingCount = pendingBySupplier.reduce((sum, r) => sum + r.n, 0);
  const pendingTotal = pendingBySupplier.reduce((sum, r) => sum + Number(r.total), 0);

  const sections: DigestSection[] = [
    {
      key: "pending_input_invoices",
      title: `Hoá đơn mua hàng chưa nhận quá ${options.pendingInvoiceDays} ngày`,
      priority: "high",
      count: pendingCount,
      headline:
        pendingCount === 0
          ? "Đã nhận đủ hoá đơn đầu vào."
          : `${pendingCount} chứng từ mua, tổng ${formatVnd(pendingTotal)}, từ ${pendingBySupplier.length} nhà cung cấp chưa gửi hoá đơn.`,
      columns: ["Nhà cung cấp", "Số chứng từ", "Tổng tiền", "Cũ nhất"],
      rows: pendingBySupplier.map((r) => [r.partner, String(r.n), formatVnd(Number(r.total)), formatDate(r.oldest)]),
      href: "/dashboard/purchase-ledger",
    },
    {
      key: "delivered_not_invoiced",
      title: "Đã xuất hàng nhưng chưa lập hoá đơn",
      priority: "high",
      count: deliveredNotInvoiced.length,
      headline:
        deliveredNotInvoiced.length === 0
          ? "Không có chứng từ nào đã giao hàng mà chưa lập hoá đơn."
          : `${deliveredNotInvoiced.length} chứng từ đã giao hàng/hoàn thành dịch vụ mà chưa lập hoá đơn.`,
      columns: ["Số chứng từ", "Ngày", "Khách hàng", "Tổng tiền"],
      rows: deliveredNotInvoiced.map((r) => [
        r.voucherNo ?? "—",
        formatDate(r.voucherDate),
        r.partnerName,
        formatVnd(r.totalAmount),
      ]),
      href: "/dashboard/sales-ledger",
    },
    {
      key: "split_partners",
      title: "Một khách hàng bị ghi thành nhiều tên",
      priority: "normal",
      count: splitPartners.length,
      headline:
        splitPartners.length === 0
          ? "Tên khách hàng trong sổ bán đã thống nhất."
          : `${splitPartners.length} khách hàng được ghi với nhiều cách viết hoa khác nhau, nên doanh thu theo khách bị tách đôi.`,
      columns: ["Các cách viết", "Tổng doanh thu gộp"],
      rows: splitPartners.map((r) => [r.variants, formatVnd(Number(r.total))]),
      footnote:
        splitPartners.length > 0
          ? "Sửa về một cách viết thống nhất tại Sổ bán hàng → Sửa chứng từ."
          : undefined,
      href: "/dashboard/sales-ledger",
    },
    {
      key: "week_totals",
      title: "7 ngày qua",
      priority: "normal",
      count: (weekSales[0]?.n ?? 0) + (weekPurchases[0]?.n ?? 0),
      headline: `Bán: ${weekSales[0]?.n ?? 0} chứng từ, ${formatVnd(Number(weekSales[0]?.total ?? 0))}. Mua: ${weekPurchases[0]?.n ?? 0} chứng từ, ${formatVnd(Number(weekPurchases[0]?.total ?? 0))}.`,
      columns: [],
      rows: [],
    },
  ];

  const nonEmpty = sections.filter((s) => s.count > 0 || s.key === "week_totals");
  const actionable = sections.filter((s) => s.priority === "high").reduce((sum, s) => sum + s.count, 0);
  const totalItems = sections.filter((s) => s.key !== "week_totals").reduce((sum, s) => sum + s.count, 0);

  const subject =
    actionable > 0
      ? `📒 Kế toán tuần: ${actionable} chứng từ cần xử lý (${formatVnd(pendingTotal)} chưa có hoá đơn đầu vào)`
      : "📒 Kế toán tuần: không có chứng từ tồn đọng";

  return {
    kind: "accounting_digest",
    subject,
    generatedAt: now,
    sections: nonEmpty,
    totalItems,
    html: renderHtml(
      "Tổng hợp tuần cho kế toán",
      "Các chứng từ cần xử lý trong sổ bán hàng và sổ mua hàng.",
      nonEmpty,
      `${options.companyName} — tạo lúc ${formatDateTime(now)}`,
    ),
    text: renderText(subject, nonEmpty),
  };
}
