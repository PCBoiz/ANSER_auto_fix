"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { toGarageDateInput } from "@/lib/format";
import { MoneyField, TextField } from "@/components/ui/Field";
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

type SalesLedgerEntry = {
  id: string;
  voucherDate: string;
  voucherNo: string | null;
  invoiceNo: string | null;
  partnerName: string;
  amountBeforeTax: number;
  vatAmount: number;
  totalAmount: number;
  invoiceIssued: boolean;
  goodsDelivered: boolean;
};

const EMPTY_FORM = {
  voucherDate: toGarageDateInput(new Date()),
  voucherNo: "",
  invoiceNo: "",
  partnerName: "",
  amountBeforeTax: 0,
  vatAmount: 0,
  totalAmount: 0,
  invoiceIssued: false,
  goodsDelivered: false,
};

export default function SalesLedgerPage() {
  const [entries, setEntries] = useState<SalesLedgerEntry[]>([]);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
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
      const res = await fetch(`/api/sales-ledger?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được sổ bán hàng.");
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
    setForm(EMPTY_FORM);
    setCreateError(null);
    setCreating(true);
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/sales-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không lưu được.");
      setCreating(false);
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
        title="Sổ bán hàng"
        subtitle="Hoá đơn bán hàng hoá, dịch vụ — sổ kế toán khai thuế, không gắn lệnh sửa xe cụ thể."
        action={<PrimaryButton onClick={openCreate}>+ Thêm chứng từ</PrimaryButton>}
      />

      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên khách hàng..."
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
                  <th className="px-5 py-3 font-semibold">Số hoá đơn</th>
                  <th className="px-5 py-3 font-semibold">Khách hàng</th>
                  <th className="px-5 py-3 text-right font-semibold">Tiền hàng</th>
                  <th className="px-5 py-3 text-right font-semibold">Thuế GTGT</th>
                  <th className="px-5 py-3 text-right font-semibold">Thanh toán</th>
                  <th className="px-5 py-3 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 whitespace-nowrap text-zinc-300">
                      {formatDate(e.voucherDate)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-zinc-400">
                      {e.voucherNo ?? "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-zinc-400">
                      {e.invoiceNo ?? "—"}
                    </td>
                    <td className="px-5 py-3">{e.partnerName}</td>
                    <td className="px-5 py-3 text-right text-zinc-300">
                      {formatVnd(e.amountBeforeTax)}
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-300">{formatVnd(e.vatAmount)}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatVnd(e.totalAmount)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={e.invoiceIssued ? "emerald" : "zinc"}>
                          {e.invoiceIssued ? "Đã lập HĐ" : "Chưa lập HĐ"}
                        </Badge>
                        <Badge tone={e.goodsDelivered ? "sky" : "zinc"}>
                          {e.goodsDelivered ? "Đã xuất" : "Chưa xuất"}
                        </Badge>
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
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      {creating && (
        <Modal
          title="Thêm chứng từ bán hàng"
          onClose={() => setCreating(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setCreating(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="sales-ledger-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu"}
              </PrimaryButton>
            </>
          }
        >
          <form
            id="sales-ledger-form"
            onSubmit={handleCreateSubmit}
            className="flex flex-col gap-4"
          >
            <ErrorBanner message={createError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Ngày chứng từ"
                type="date"
                required
                value={form.voucherDate}
                onChange={(e) => setForm((p) => ({ ...p, voucherDate: e.target.value }))}
              />
              <TextField
                label="Khách hàng"
                required
                value={form.partnerName}
                onChange={(e) => setForm((p) => ({ ...p, partnerName: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="grid gap-4 sm:grid-cols-3">
              <MoneyField
                label="Tiền hàng"
                value={form.amountBeforeTax}
                onValueChange={(v) => setForm((p) => ({ ...p, amountBeforeTax: v }))}
              />
              <MoneyField
                label="Thuế GTGT"
                value={form.vatAmount}
                onValueChange={(v) => setForm((p) => ({ ...p, vatAmount: v }))}
              />
              <MoneyField
                label="Tổng thanh toán"
                value={form.totalAmount}
                onValueChange={(v) => setForm((p) => ({ ...p, totalAmount: v }))}
              />
            </div>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.invoiceIssued}
                  onChange={(e) => setForm((p) => ({ ...p, invoiceIssued: e.target.checked }))}
                  className="h-4 w-4 accent-orange-500"
                />
                Đã lập hoá đơn
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.goodsDelivered}
                  onChange={(e) => setForm((p) => ({ ...p, goodsDelivered: e.target.checked }))}
                  className="h-4 w-4 accent-orange-500"
                />
                Đã xuất hàng
              </label>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
