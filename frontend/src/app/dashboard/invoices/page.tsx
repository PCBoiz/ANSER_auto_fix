"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "@/components/dashboard/icons";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  GhostButton,
  PageHeader,
  PrimaryButton,
  TableWrap,
  formatDate,
  formatVnd,
} from "@/components/ui/PageShell";

const PAYMENT_METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "transfer", label: "Chuyển khoản" },
  { value: "card", label: "Thẻ" },
  { value: "insurance", label: "Bảo hiểm" },
];

const STATUS_LABELS: Record<string, string> = {
  unpaid: "Chưa thu",
  partial: "Thu một phần",
  paid: "Đã thu đủ",
};

const STATUS_TONES: Record<string, "red" | "orange" | "emerald"> = {
  unpaid: "red",
  partial: "orange",
  paid: "emerald",
};

type Invoice = {
  id: string;
  code: string;
  customerName: string;
  plateSnapshot: string;
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  status: string;
  paymentMethod: string | null;
  insuranceAmount: number;
  insuranceProvider: string | null;
  issuedAt: string;
  orderCode: string;
};

type InvoiceableOrder = {
  id: string;
  code: string;
  plateSnapshot: string;
  total: number;
  customerName: string | null;
};

function InvoicesContent() {
  const searchParams = useSearchParams();
  const presetOrderId = searchParams.get("orderId");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<InvoiceableOrder[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    serviceOrderId: "",
    taxRate: "8",
    paidAmount: 0,
    paymentMethod: "cash",
    insuranceAmount: 0,
    insuranceProvider: "",
    note: "",
  });

  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");

  const load = useCallback(async (term: string, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (term) params.set("search", term);
      if (status) params.set("status", status);
      const res = await fetch(`/api/invoices?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được hoá đơn.");
      setInvoices(data.invoices);
      setOrders(data.invoiceableOrders);
      setError(null);
      return data.invoiceableOrders as InvoiceableOrder[];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(search, statusFilter), 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter, load]);

  // Vào từ trang chi tiết lệnh (?orderId=...) thì mở sẵn form với đúng lệnh đó — người
  // dùng vừa bấm "Xuất hoá đơn" ở đó, bắt họ chọn lại từ dropdown là thừa.
  useEffect(() => {
    if (!presetOrderId) return;
    let cancelled = false;
    fetch("/api/invoices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const match = (data.invoiceableOrders as InvoiceableOrder[]).find(
          (o) => o.id === presetOrderId,
        );
        if (!match) return;
        setForm((prev) => ({ ...prev, serviceOrderId: presetOrderId }));
        setCreating(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [presetOrderId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const post = (confirmZeroPrice: boolean) =>
        fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, confirmZeroPrice }),
        });
      let res = await post(false);
      let data = await res.json().catch(() => null);
      // Lệnh còn dòng 0đ: hỏi lại một lần — hoá đơn là chỗ chốt tiền, sau đó không sửa được.
      if (res.status === 409 && data?.code === "ZERO_PRICE_LINES") {
        if (!window.confirm(`${data.message}\n\nVẫn xuất hoá đơn?`)) return;
        res = await post(true);
        data = await res.json().catch(() => null);
      }
      if (!res.ok) throw new Error(data?.message ?? "Không xuất được hoá đơn.");
      setCreating(false);
      await load(search, statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePay(e: FormEvent) {
    e.preventDefault();
    if (!paying) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${paying.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidAmount: payAmount, paymentMethod: payMethod }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không ghi nhận được.");
      setPaying(null);
      await load(search, statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  const selectedOrder = orders.find((o) => o.id === form.serviceOrderId);

  return (
    <div>
      <PageHeader
        title="Hoá đơn"
        subtitle="Xuất hoá đơn từ lệnh đã hoàn tất, theo dõi công nợ."
        action={
          <PrimaryButton
            onClick={() => {
              setForm((p) => ({ ...p, serviceOrderId: orders[0]?.id ?? "", paidAmount: 0 }));
              setCreating(true);
            }}
            disabled={orders.length === 0}
          >
            <PlusIcon className="h-4 w-4" /> Xuất hoá đơn
          </PrimaryButton>
        }
      />

      <ErrorBanner message={error} />

      {orders.length === 0 && !loading && invoices.length === 0 && (
        <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-sm text-orange-200">
          Chưa có lệnh sửa chữa nào ở trạng thái Hoàn tất hoặc Đã giao xe để xuất hoá đơn.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo mã hoá đơn, khách hàng hoặc biển số..."
          className="min-w-64 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-orange-500 sm:max-w-sm sm:flex-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none focus:border-orange-500 [&>option]:bg-zinc-900"
        >
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {loading ? (
          <EmptyState title="Đang tải..." />
        ) : invoices.length === 0 ? (
          <EmptyState title="Chưa có hoá đơn nào." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                <tr>
                  <th className="px-5 py-3 font-semibold">Mã hoá đơn</th>
                  <th className="px-5 py-3 font-semibold">Khách / Xe</th>
                  <th className="px-5 py-3 font-semibold">Ngày xuất</th>
                  <th className="px-5 py-3 text-right font-semibold">Tổng tiền</th>
                  <th className="px-5 py-3 text-right font-semibold">Đã thu</th>
                  <th className="px-5 py-3 font-semibold">Trạng thái</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-mono text-xs font-semibold">{inv.code}</div>
                      <div className="font-mono text-[11px] text-zinc-500">{inv.orderCode}</div>
                    </td>
                    <td className="px-5 py-3">
                      <div>{inv.customerName}</div>
                      <div className="font-mono text-xs text-zinc-500">{inv.plateSnapshot}</div>
                    </td>
                    <td className="px-5 py-3 text-zinc-400">{formatDate(inv.issuedAt)}</td>
                    <td className="px-5 py-3 text-right font-semibold">{formatVnd(inv.total)}</td>
                    <td className="px-5 py-3 text-right">
                      <div>{formatVnd(inv.paidAmount)}</div>
                      {inv.paidAmount < inv.total && (
                        <div className="text-[11px] text-red-400">
                          còn {formatVnd(inv.total - inv.paidAmount)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONES[inv.status] ?? "zinc"}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {/* Mở tab mới: bản in là trang riêng không có sidebar, và người dùng
                            thường cần quay lại đúng vị trí đang xem trong danh sách. */}
                        <a
                          href={`/in/hoa-don/${inv.id}`}
                          target="_blank"
                          rel="noopener"
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/[0.06]"
                        >
                          In
                        </a>
                        {inv.status !== "paid" && (
                          <button
                            onClick={() => {
                              setPaying(inv);
                              setPayAmount(inv.total);
                              setPayMethod(inv.paymentMethod ?? "cash");
                            }}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10"
                          >
                            Ghi nhận thu
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {creating && (
        <Modal
          title="Xuất hoá đơn"
          onClose={() => setCreating(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setCreating(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="invoice-form" disabled={saving}>
                {saving ? "Đang xuất..." : "Xuất hoá đơn"}
              </PrimaryButton>
            </>
          }
        >
          <form id="invoice-form" onSubmit={handleCreate} className="flex flex-col gap-4">
            <SelectField
              label="Lệnh sửa chữa"
              required
              value={form.serviceOrderId}
              onChange={(e) => setForm((p) => ({ ...p, serviceOrderId: e.target.value }))}
            >
              <option value="">— Chọn lệnh —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} — {o.plateSnapshot} — {formatVnd(o.total)}
                  {o.customerName ? ` (${o.customerName})` : ""}
                </option>
              ))}
            </SelectField>

            {selectedOrder && (
              <div className="rounded-xl bg-black/30 px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Tiền hàng + công (sau giảm giá)</span>
                  <span>{formatVnd(selectedOrder.total)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-zinc-400">Thuế {form.taxRate}%</span>
                  <span>
                    {formatVnd(Math.round((selectedOrder.total * Number(form.taxRate || 0)) / 100))}
                  </span>
                </div>
                <div className="mt-2 flex justify-between border-t border-white/[0.08] pt-2 font-bold">
                  <span>Tổng thanh toán</span>
                  <span>
                    {formatVnd(
                      selectedOrder.total +
                        Math.round((selectedOrder.total * Number(form.taxRate || 0)) / 100),
                    )}
                  </span>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Thuế suất (%)"
                type="number"
                min={0}
                max={100}
                value={form.taxRate}
                onChange={(e) => setForm((p) => ({ ...p, taxRate: e.target.value }))}
              />
              <SelectField
                label="Hình thức thanh toán"
                value={form.paymentMethod}
                onChange={(e) => setForm((p) => ({ ...p, paymentMethod: e.target.value }))}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </SelectField>
            </div>

            <MoneyField
              label="Thu ngay"
              hint="để 0 nếu khách chưa trả"
              value={form.paidAmount}
              onValueChange={(v) => setForm((p) => ({ ...p, paidAmount: v }))}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                label="Bảo hiểm chi trả"
                value={form.insuranceAmount}
                onValueChange={(v) => setForm((p) => ({ ...p, insuranceAmount: v }))}
              />
              <TextField
                label="Đơn vị bảo hiểm"
                value={form.insuranceProvider}
                onChange={(e) => setForm((p) => ({ ...p, insuranceProvider: e.target.value }))}
              />
            </div>

            <TextAreaField
              label="Ghi chú"
              value={form.note}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            />
          </form>
        </Modal>
      )}

      {paying && (
        <Modal
          title={`Ghi nhận thanh toán — ${paying.code}`}
          onClose={() => setPaying(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setPaying(null)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="pay-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu"}
              </PrimaryButton>
            </>
          }
        >
          <form id="pay-form" onSubmit={handlePay} className="flex flex-col gap-4">
            <div className="rounded-xl bg-black/30 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Tổng hoá đơn</span>
                <span className="font-semibold">{formatVnd(paying.total)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-zinc-400">Đã thu trước đó</span>
                <span>{formatVnd(paying.paidAmount)}</span>
              </div>
            </div>
            <MoneyField
              label="Tổng đã thu (luỹ kế)"
              hint="nhập tổng số đã thu, không phải số cộng thêm"
              value={payAmount}
              onValueChange={setPayAmount}
            />
            <SelectField
              label="Hình thức"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<EmptyState title="Đang tải..." />}>
      <InvoicesContent />
    </Suspense>
  );
}
