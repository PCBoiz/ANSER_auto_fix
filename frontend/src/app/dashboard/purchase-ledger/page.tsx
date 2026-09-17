"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { toGarageDateInput } from "@/lib/format";
import { EditIcon, TrashIcon } from "@/components/dashboard/icons";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import {
  Badge,
  Card,
  DangerButton,
  EmptyState,
  ErrorBanner,
  GhostButton,
  PageHeader,
  PrimaryButton,
  TableWrap,
  formatDate,
  formatVnd,
} from "@/components/ui/PageShell";

type PurchaseLedgerEntry = {
  id: string;
  postingDate: string;
  voucherDate: string | null;
  voucherNo: string | null;
  invoiceNo: string | null;
  partnerName: string;
  description: string | null;
  amountBeforeTax: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  purchaseCost: number;
  inventoryValue: number;
  invoiceStatus: "not_received" | "received" | "none";
  isPurchaseCost: boolean;
  documentType: string | null;
};

const INVOICE_STATUS_LABEL: Record<PurchaseLedgerEntry["invoiceStatus"], string> = {
  not_received: "Chưa nhận HĐ",
  received: "Đã nhận HĐ",
  none: "Không có HĐ",
};

const INVOICE_STATUS_TONE: Record<PurchaseLedgerEntry["invoiceStatus"], "emerald" | "orange" | "zinc"> = {
  not_received: "orange",
  received: "emerald",
  none: "zinc",
};

const EMPTY_FORM = {
  postingDate: toGarageDateInput(new Date()),
  voucherDate: "",
  voucherNo: "",
  invoiceNo: "",
  partnerName: "",
  description: "",
  amountBeforeTax: 0,
  discountAmount: 0,
  vatAmount: 0,
  totalAmount: 0,
  purchaseCost: 0,
  inventoryValue: 0,
  invoiceStatus: "not_received" as PurchaseLedgerEntry["invoiceStatus"],
  isPurchaseCost: false,
  documentType: "",
};

export default function PurchaseLedgerPage() {
  const [entries, setEntries] = useState<PurchaseLedgerEntry[]>([]);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  // Dùng CHUNG modal với "Thêm chứng từ" — xem ghi chú cùng chỗ ở trang Sổ bán hàng.
  const [editing, setEditing] = useState<PurchaseLedgerEntry | null>(null);
  const [deleting, setDeleting] = useState<PurchaseLedgerEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async (term: string, fromDate: string, toDate: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (term) params.set("search", term);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(`/api/purchase-ledger?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được sổ mua hàng.");
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(search, from, to), 300);
    return () => clearTimeout(timer);
  }, [search, from, to, load]);

  const totalAmount = entries.reduce((sum, e) => sum + e.totalAmount, 0);

  function openCreate() {
    // Ngày mặc định tính lại mỗi lần mở, không chốt từ lúc tải trang.
    setForm({ ...EMPTY_FORM, postingDate: toGarageDateInput(new Date()) });
    setCreateError(null);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(entry: PurchaseLedgerEntry) {
    setForm({
      postingDate: toGarageDateInput(entry.postingDate),
      voucherDate: toGarageDateInput(entry.voucherDate),
      voucherNo: entry.voucherNo ?? "",
      invoiceNo: entry.invoiceNo ?? "",
      partnerName: entry.partnerName,
      description: entry.description ?? "",
      amountBeforeTax: entry.amountBeforeTax,
      discountAmount: entry.discountAmount,
      vatAmount: entry.vatAmount,
      totalAmount: entry.totalAmount,
      purchaseCost: entry.purchaseCost,
      inventoryValue: entry.inventoryValue,
      invoiceStatus: entry.invoiceStatus,
      isPurchaseCost: entry.isPurchaseCost,
      documentType: entry.documentType ?? "",
    });
    setCreateError(null);
    setEditing(entry);
    setCreating(true);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/purchase-ledger/${deleting.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không xoá được chứng từ.");
      setDeleting(null);
      await load(search, from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
      setDeleting(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCreateError(null);
    try {
      const res = await fetch(editing ? `/api/purchase-ledger/${editing.id}` : "/api/purchase-ledger", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        // Ô "Ngày chứng từ" để trống nghĩa là không có — gửi null thay vì chuỗi rỗng, để
        // server không phải đoán "" là "xoá ngày" hay "ngày không hợp lệ".
        body: JSON.stringify({ ...form, voucherDate: form.voucherDate || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không lưu được.");
      closeForm();
      await load(search, from, to);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sổ mua hàng"
        subtitle="Hoá đơn mua hàng hoá, dịch vụ từ nhà cung cấp — sổ kế toán khai thuế."
        action={<PrimaryButton onClick={openCreate}>+ Thêm chứng từ</PrimaryButton>}
      />

      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên nhà cung cấp..."
          className="w-full max-w-md rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-orange-500"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none focus:border-orange-500"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none focus:border-orange-500"
        />
      </div>

      <Card>
        {loading ? (
          <EmptyState title="Đang tải..." />
        ) : entries.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                <tr>
                  <th className="px-5 py-3 font-semibold">Ngày</th>
                  <th className="px-5 py-3 font-semibold">Số chứng từ</th>
                  <th className="px-5 py-3 font-semibold">Nhà cung cấp</th>
                  <th className="px-5 py-3 font-semibold">Diễn giải</th>
                  <th className="px-5 py-3 text-right font-semibold">Tiền hàng</th>
                  <th className="px-5 py-3 text-right font-semibold">Thuế GTGT</th>
                  <th className="px-5 py-3 text-right font-semibold">Thanh toán</th>
                  <th className="px-5 py-3 font-semibold">Hoá đơn</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 whitespace-nowrap text-zinc-300">
                      {formatDate(e.postingDate)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-zinc-400">
                      {e.voucherNo ?? "—"}
                    </td>
                    <td className="px-5 py-3">{e.partnerName}</td>
                    <td className="px-5 py-3 text-zinc-400">{e.description ?? "—"}</td>
                    <td className="px-5 py-3 text-right text-zinc-300">
                      {formatVnd(e.amountBeforeTax)}
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-300">{formatVnd(e.vatAmount)}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatVnd(e.totalAmount)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={INVOICE_STATUS_TONE[e.invoiceStatus]}>
                        {INVOICE_STATUS_LABEL[e.invoiceStatus]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(e)}
                          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                          aria-label={`Sửa chứng từ ${e.voucherNo ?? e.partnerName}`}
                        >
                          <EditIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(e)}
                          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          aria-label={`Xoá chứng từ ${e.voucherNo ?? e.partnerName}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.08] text-sm font-semibold">
                  <td className="px-5 py-3" colSpan={6}>
                    Tổng ({entries.length} hoá đơn)
                  </td>
                  <td className="px-5 py-3 text-right">{formatVnd(totalAmount)}</td>
                  <td className="px-5 py-3" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      {creating && (
        <Modal
          title={editing ? `Sửa chứng từ ${editing.voucherNo ?? ""}`.trim() : "Thêm chứng từ mua hàng"}
          onClose={closeForm}
          footer={
            <>
              <GhostButton type="button" onClick={closeForm}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="purchase-ledger-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu"}
              </PrimaryButton>
            </>
          }
        >
          <form
            id="purchase-ledger-form"
            onSubmit={handleCreateSubmit}
            className="flex flex-col gap-4"
          >
            <ErrorBanner message={createError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Ngày hạch toán"
                type="date"
                required
                value={form.postingDate}
                onChange={(e) => setForm((p) => ({ ...p, postingDate: e.target.value }))}
              />
              <TextField
                label="Nhà cung cấp"
                required
                value={form.partnerName}
                onChange={(e) => setForm((p) => ({ ...p, partnerName: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="Ngày chứng từ"
                type="date"
                value={form.voucherDate}
                onChange={(e) => setForm((p) => ({ ...p, voucherDate: e.target.value }))}
              />
              <TextField
                label="Số chứng từ"
                value={form.voucherNo}
                onChange={(e) => setForm((p) => ({ ...p, voucherNo: e.target.value }))}
              />
              <TextField
                label="Số hoá đơn"
                value={form.invoiceNo}
                onChange={(e) => setForm((p) => ({ ...p, invoiceNo: e.target.value }))}
              />
            </div>
            <TextAreaField
              label="Diễn giải"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <MoneyField
                label="Tiền hàng"
                value={form.amountBeforeTax}
                onValueChange={(v) => setForm((p) => ({ ...p, amountBeforeTax: v }))}
              />
              <MoneyField
                label="Chiết khấu"
                value={form.discountAmount}
                onValueChange={(v) => setForm((p) => ({ ...p, discountAmount: v }))}
              />
              <MoneyField
                label="Thuế GTGT"
                value={form.vatAmount}
                onValueChange={(v) => setForm((p) => ({ ...p, vatAmount: v }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <MoneyField
                label="Tổng thanh toán"
                value={form.totalAmount}
                onValueChange={(v) => setForm((p) => ({ ...p, totalAmount: v }))}
              />
              <MoneyField
                label="Chi phí mua hàng"
                value={form.purchaseCost}
                onValueChange={(v) => setForm((p) => ({ ...p, purchaseCost: v }))}
              />
              <MoneyField
                label="Giá trị nhập kho"
                value={form.inventoryValue}
                onValueChange={(v) => setForm((p) => ({ ...p, inventoryValue: v }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Trạng thái hoá đơn"
                value={form.invoiceStatus}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    invoiceStatus: e.target.value as PurchaseLedgerEntry["invoiceStatus"],
                  }))
                }
              >
                <option value="not_received">Chưa nhận HĐ</option>
                <option value="received">Đã nhận HĐ</option>
                <option value="none">Không có HĐ</option>
              </SelectField>
              <TextField
                label="Loại chứng từ"
                value={form.documentType}
                onChange={(e) => setForm((p) => ({ ...p, documentType: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.isPurchaseCost}
                onChange={(e) => setForm((p) => ({ ...p, isPurchaseCost: e.target.checked }))}
                className="h-4 w-4 accent-orange-500"
              />
              Là chi phí mua hàng
            </label>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Xoá chứng từ"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setDeleting(null)} disabled={saving}>
                Huỷ
              </GhostButton>
              <DangerButton type="button" onClick={handleDelete} disabled={saving}>
                {saving ? "Đang xoá..." : "Xoá chứng từ"}
              </DangerButton>
            </>
          }
        >
          <p className="text-sm text-zinc-300">
            Xoá chứng từ <span className="font-mono">{deleting.voucherNo ?? "(không số)"}</span> ngày{" "}
            {formatDate(deleting.postingDate)} của{" "}
            <span className="font-semibold">{deleting.partnerName}</span>, tổng{" "}
            {formatVnd(deleting.totalAmount)}?
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Không hoàn tác được. Dùng cho dòng nhập trùng hoặc nhập nhầm sổ — nếu chỉ sai số tiền
            thì nên bấm Sửa.
          </p>
        </Modal>
      )}
    </div>
  );
}
