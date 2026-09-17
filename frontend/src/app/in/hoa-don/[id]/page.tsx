import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { getInvoiceDetail } from "@/server/store/invoices";
import { getCompanySettings } from "@/server/store/settings";
import { formatDate, formatVnd } from "@/lib/format";
import { vndToWords } from "@/lib/vndWords";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  insurance: "Bảo hiểm chi trả",
};

/**
 * Bản in hoá đơn cho khách, khổ A4.
 *
 * Nằm ngoài `/dashboard` để không bị bọc sidebar + topbar của layout dashboard — bản in
 * chỉ được có đúng tờ hoá đơn. Đổi lại `proxy.ts` không gác đường dẫn này, nên trang tự
 * gọi `requireUser()` (cùng lớp chặn với mọi API, kể cả chặn tài khoản mật khẩu tạm).
 *
 * Màu nền trắng, chữ đen, không dùng biến theme của app: bản in phải đọc được trên máy in
 * đen trắng, và giao diện tối của dashboard in ra là tốn cả hộp mực.
 */
export default async function PrintInvoicePage({ params }: Params) {
  const user = await requireUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const [detail, company] = await Promise.all([getInvoiceDetail(id), getCompanySettings()]);
  if (!detail) notFound();

  const { invoice, order, customer, labors, parts } = detail;
  const outstanding = Math.max(0, invoice.total - invoice.paidAmount);
  // Phần khách thực trả khi có bảo hiểm chi trả một phần — trường hợp rất phổ biến với
  // xe đồng-sơn sau va chạm, và là con số khách quan tâm nhất trên tờ giấy.
  const customerPays = Math.max(0, invoice.total - invoice.insuranceAmount);

  const companyIncomplete = !company.address || !company.taxCode || company.name === "ANSER Auto";

  return (
    <div className="min-h-screen bg-zinc-200 py-8 text-black print:bg-white print:py-0">
      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4">
        <a href="/dashboard/invoices" className="text-sm font-semibold text-zinc-700 hover:text-black">
          ← Về danh sách hoá đơn
        </a>
        <PrintButton />
      </div>

      {companyIncomplete && (
        <div className="no-print mx-auto mb-4 max-w-[210mm] rounded-lg border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Thông tin doanh nghiệp chưa đầy đủ (tên, địa chỉ hoặc mã số thuế) — tờ hoá đơn này sẽ in
          ra thiếu thông tin người bán. Điền tại{" "}
          <a href="/dashboard/settings" className="font-semibold underline">
            Cài đặt
          </a>
          . Dòng cảnh báo này không in ra giấy.
        </div>
      )}

      <article className="mx-auto max-w-[210mm] bg-white px-10 py-10 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
          <div>
            <h1 className="text-xl font-extrabold uppercase">{company.name}</h1>
            {company.address && <p className="mt-1 text-sm">{company.address}</p>}
            <p className="text-sm">
              {company.phone && <>ĐT: {company.phone}</>}
              {company.phone && company.email && " · "}
              {company.email}
            </p>
            {company.taxCode && <p className="text-sm">MST: {company.taxCode}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold uppercase">Hoá đơn</p>
            <p className="text-sm">dịch vụ sửa chữa ô tô</p>
            <p className="mt-2 font-mono text-sm font-bold">Số: {invoice.code}</p>
            <p className="text-sm">Ngày: {formatDate(invoice.issuedAt)}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b border-zinc-300 py-5 text-sm">
          <div className="space-y-1">
            <p className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">Khách hàng</p>
            <p className="font-bold">{invoice.customerName}</p>
            {customer?.address && <p>{customer.address}</p>}
            {customer?.phone && <p>ĐT: {customer.phone}</p>}
            {customer?.taxCode && <p>MST: {customer.taxCode}</p>}
          </div>
          <div className="space-y-1">
            <p className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">Phương tiện</p>
            <p className="font-mono font-bold">{invoice.plateSnapshot}</p>
            {order && (
              <>
                <p>
                  {order.vehicleMake} {order.vehicleModel}
                  {order.vehicleYear ? ` (${order.vehicleYear})` : ""}
                </p>
                {order.vehicleVin && <p className="font-mono text-xs">VIN: {order.vehicleVin}</p>}
                {order.odometerIn !== null && (
                  <p>Số km vào xưởng: {order.odometerIn.toLocaleString("vi-VN")} km</p>
                )}
                <p>
                  Lệnh sửa chữa: <span className="font-mono">{order.code}</span>
                </p>
              </>
            )}
          </div>
        </section>

        {order?.customerComplaint && (
          <section className="border-b border-zinc-300 py-3 text-sm">
            <span className="font-bold">Yêu cầu của khách: </span>
            {order.customerComplaint}
          </section>
        )}

        <LineTable
          title="I. Tiền công"
          rows={labors.map((l) => ({
            name: l.name,
            unit: "Lần",
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          }))}
          subtotal={order?.laborTotal ?? labors.reduce((s, l) => s + l.lineTotal, 0)}
        />

        <LineTable
          title="II. Phụ tùng, vật tư"
          rows={parts}
          subtotal={order?.partsTotal ?? parts.reduce((s, p) => s + p.lineTotal, 0)}
        />

        <section className="mt-6 ml-auto w-full max-w-[95mm] text-sm">
          <Row label="Cộng tiền công và phụ tùng" value={formatVnd(invoice.subtotal)} />
          {invoice.discount > 0 && <Row label="Giảm giá" value={`− ${formatVnd(invoice.discount)}`} />}
          <Row label="Thành tiền trước thuế" value={formatVnd(invoice.subtotal - invoice.discount)} />
          <Row label={`Thuế GTGT (${invoice.taxRate}%)`} value={formatVnd(invoice.taxAmount)} />
          <Row label="TỔNG CỘNG" value={formatVnd(invoice.total)} strong />
          {invoice.insuranceAmount > 0 && (
            <>
              <Row
                label={`Bảo hiểm chi trả${invoice.insuranceProvider ? ` (${invoice.insuranceProvider})` : ""}`}
                value={`− ${formatVnd(invoice.insuranceAmount)}`}
              />
              <Row label="Khách thanh toán" value={formatVnd(customerPays)} strong />
            </>
          )}
          <Row label="Đã thu" value={formatVnd(invoice.paidAmount)} />
          <Row label="Còn phải thu" value={formatVnd(outstanding)} strong={outstanding > 0} />
        </section>

        <p className="mt-4 border-t border-zinc-300 pt-3 text-sm">
          <span className="font-bold">Số tiền bằng chữ: </span>
          <em>{vndToWords(invoice.total)}.</em>
        </p>

        {invoice.paymentMethod && (
          <p className="mt-1 text-sm">
            <span className="font-bold">Hình thức thanh toán: </span>
            {PAYMENT_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod}
          </p>
        )}
        {invoice.note && (
          <p className="mt-1 text-sm">
            <span className="font-bold">Ghi chú: </span>
            {invoice.note}
          </p>
        )}

        <footer className="mt-12 grid grid-cols-2 gap-6 text-center text-sm break-inside-avoid">
          <div>
            <p className="font-bold">Khách hàng</p>
            <p className="text-xs text-zinc-500 italic">(Ký, ghi rõ họ tên)</p>
            <div className="h-24" />
          </div>
          <div>
            <p className="font-bold">Người lập hoá đơn</p>
            <p className="text-xs text-zinc-500 italic">(Ký, ghi rõ họ tên)</p>
            <div className="h-24" />
            <p>{order?.advisorName ?? `${user.lastName} ${user.firstName}`}</p>
          </div>
        </footer>

        <p className="mt-6 text-center text-[11px] text-zinc-500">
          Đây là hoá đơn dịch vụ nội bộ của gara, không thay thế hoá đơn giá trị gia tăng điện tử
          theo quy định.
        </p>
      </article>
    </div>
  );
}

function LineTable({
  title,
  rows,
  subtotal,
}: {
  title: string;
  rows: Array<{ name: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }>;
  subtotal: number;
}) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 italic">Không có.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black text-left">
              <th className="w-8 py-1.5 pr-2 font-bold">TT</th>
              <th className="py-1.5 pr-2 font-bold">Nội dung</th>
              <th className="w-14 py-1.5 pr-2 font-bold">ĐVT</th>
              <th className="w-12 py-1.5 pr-2 text-right font-bold">SL</th>
              <th className="w-28 py-1.5 pr-2 text-right font-bold">Đơn giá</th>
              <th className="w-28 py-1.5 text-right font-bold">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              // break-inside-avoid: một dòng không bị cắt đôi giữa hai trang giấy.
              <tr key={i} className="border-b border-zinc-200 break-inside-avoid">
                <td className="py-1.5 pr-2 align-top">{i + 1}</td>
                <td className="py-1.5 pr-2 align-top">{row.name}</td>
                <td className="py-1.5 pr-2 align-top">{row.unit}</td>
                <td className="py-1.5 pr-2 text-right align-top tabular-nums">{row.quantity}</td>
                <td className="py-1.5 pr-2 text-right align-top tabular-nums">{formatVnd(row.unitPrice)}</td>
                <td className="py-1.5 text-right align-top tabular-nums">{formatVnd(row.lineTotal)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="pt-1.5 pr-2 text-right font-bold">
                Cộng
              </td>
              <td className="pt-1.5 text-right font-bold tabular-nums">{formatVnd(subtotal)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${strong ? "border-t border-black font-bold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
