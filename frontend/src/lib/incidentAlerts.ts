// Email báo nhanh sự cố — dựng nội dung, logic thuần, có test (`__tests__/incidentAlerts.test.ts`).
//
// Chuông trong app chỉ có ích khi có người đang mở app. Chủ gara đã chọn email (20/09/2026)
// làm kênh báo nhanh: sự cố MỨC CAO mới mở thì báo ngay trong lượt canh gác kế tiếp (tối đa 30
// phút), không đợi bản tin sáng hôm sau; sự cố đã được báo mà nay tự đóng thì báo "đã khắc
// phục" — để người nhận không phải tự đi kiểm tra xem xong chưa.
//
// Gom mọi thay đổi của một lượt vào MỘT email: 5 dòng 0đ mở cùng lúc là 1 email, không phải 5.

import { escapeHtml as esc } from "@/lib/html";
import { formatDuration } from "@/lib/opsLoop";

/** Loại sự cố được báo nhanh. Việc chặn go-live (`readiness`) là việc cài đặt, đã có trang riêng. */
export const ALERT_KINDS = ["watchdog", "revenue", "usage"] as const;

export type AlertItem = {
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolution?: string | null;
};

export type AlertEmail = { subject: string; html: string; text: string };

function link(appUrl: string | null, href: string | null) {
  if (!appUrl || !href) return null;
  return `${appUrl.replace(/\/+$/, "")}${href}`;
}

export function buildAlertEmail(input: {
  companyName: string;
  appUrl: string | null;
  opened: AlertItem[];
  resolved: AlertItem[];
}): AlertEmail {
  const { opened, resolved } = input;
  const parts: string[] = [];
  if (opened.length) parts.push(`${opened.length} sự cố mới`);
  if (resolved.length) parts.push(`${resolved.length} đã khắc phục`);
  const icon = opened.length ? "🔴" : "🟢";
  const subject = `${icon} ${input.companyName}: ${parts.join(", ")}`;

  const openedHtml = opened
    .map((o) => {
      const url = link(input.appUrl, o.href);
      return `<li style="margin:8px 0"><b>${esc(o.title)}</b>${o.body ? `<br><span style="color:#52525b">${esc(o.body)}</span>` : ""}${url ? `<br><a href="${esc(url)}">Mở trang xử lý</a>` : ""}</li>`;
    })
    .join("");
  const resolvedHtml = resolved
    .map((r) => {
      const after = r.resolvedAt ? formatDuration(r.resolvedAt.getTime() - r.createdAt.getTime()) : null;
      const how = r.resolution === "auto" ? "hệ thống tự khắc phục" : "đã khắc phục";
      return `<li style="margin:6px 0">${esc(r.title)} <span style="color:#15803d">— ${how}${after ? ` sau ${after}` : ""}</span></li>`;
    })
    .join("");

  const html =
    (opened.length ? `<h3 style="color:#b91c1c;margin:12px 0 4px">Sự cố mới cần xử lý</h3><ul>${openedHtml}</ul>` : "") +
    (resolved.length ? `<h3 style="color:#15803d;margin:12px 0 4px">Đã khắc phục</h3><ul>${resolvedHtml}</ul>` : "") +
    `<p style="color:#71717a;font-size:12px">Email tự động từ bộ canh gác của ${esc(input.companyName)}. Mỗi sự cố chỉ báo một lần khi mở và một lần khi đóng.</p>`;

  const text = [
    ...(opened.length ? ["SỰ CỐ MỚI:", ...opened.map((o) => `- ${o.title}${o.body ? `: ${o.body}` : ""}`)] : []),
    ...(resolved.length ? ["ĐÃ KHẮC PHỤC:", ...resolved.map((r) => `- ${r.title}`)] : []),
  ].join("\n");

  return { subject, html, text };
}
