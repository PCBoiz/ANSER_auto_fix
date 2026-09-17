"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EditIcon, PlusIcon, TrashIcon } from "@/components/dashboard/icons";
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
  formatDateTime,
  formatVnd,
} from "@/components/ui/PageShell";

const CATEGORIES = [
  "Lọc - Dầu nhớt",
  "Phanh",
  "Gầm - Treo",
  "Điện - Ắc quy",
  "Lốp",
  "Thân vỏ",
  "Vật tư tiêu hao",
];
const UNITS = ["Cái", "Bộ", "Chiếc", "Lít", "Mét", "Hộp"];

type Part = {
  id: string;
  code: string;
  name: string;
  category: string;
  oemNumber: string | null;
  unit: string;
  stock: number;
  price: number;
  cost: number | null;
  minStock: number | null;
  location: string | null;
  branchId: string;
  branchName: string;
};

type Branch = { id: string; name: string };

type Txn = {
  id: string;
  type: string;
  quantity: number;
  unitCost: number | null;
  counterparty: string | null;
  note: string | null;
  createdAt: string;
  partCode: string;
  partName: string;
  unit: string;
  orderCode: string | null;
};

export default function PartsPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suggestedCode, setSuggestedCode] = useState("PT-001");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"parts" | "history">("parts");
  const [history, setHistory] = useState<Txn[]>([]);

  const [form, setForm] = useState({
    code: "",
    name: "",
    category: CATEGORIES[0],
    branchId: "",
    oemNumber: "",
    unit: "Cái",
    price: 0,
    cost: 0,
    minStock: "",
    location: "",
  });
  const [editing, setEditing] = useState<Part | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Part | null>(null);

  const [txnForm, setTxnForm] = useState({
    partId: "",
    type: "import" as "import" | "export",
    quantity: "1",
    unitCost: 0,
    counterparty: "",
    note: "",
  });
  const [txnOpen, setTxnOpen] = useState(false);

  // 50 dòng một trang, đọc từ server. Kho thật có 788 mã — tải cả về rồi lọc ở trình duyệt
  // là ~150 KB JSON cho mỗi chữ gõ vào ô tìm, và bảng 788 dòng cuộn giật trên máy yếu.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (term: string, pageIndex: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: term,
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
      });
      const res = await fetch(`/api/parts?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được kho.");
      setParts(data.parts);
      setTotal(data.total);
      setBranches(data.branches);
      setSuggestedCode(data.suggestedCode);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/parts/transactions?limit=100");
    if (!res.ok) return;
    const data = await res.json();
    setHistory(data.transactions);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(search, page), 300);
    return () => clearTimeout(timer);
  }, [search, page, load]);

  // Gõ tìm thì về trang đầu — làm trong handler, không dùng effect (effect sẽ gọi API thừa
  // một lần với offset cũ).
  function changeSearch(value: string) {
    setSearch(value);
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Nạp lịch sử khi người dùng BẤM sang tab, không nạp trong effect theo dõi `tab`:
  // effect chạy sau render rồi setState lại gây thêm một vòng render thừa.
  function switchTab(next: "parts" | "history") {
    setTab(next);
    if (next === "history") loadHistory();
  }

  function openCreate() {
    setForm({
      code: suggestedCode,
      name: "",
      category: CATEGORIES[0],
      branchId: branches[0]?.id ?? "",
      oemNumber: "",
      unit: "Cái",
      price: 0,
      cost: 0,
      minStock: "",
      location: "",
    });
    setCreating(true);
  }

  function openEdit(p: Part) {
    setForm({
      code: p.code,
      name: p.name,
      category: p.category,
      branchId: p.branchId,
      oemNumber: p.oemNumber ?? "",
      unit: p.unit,
      price: p.price,
      cost: p.cost ?? 0,
      minStock: p.minStock?.toString() ?? "",
      location: p.location ?? "",
    });
    setEditing(p);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
    setSaving(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/parts/${editing.id}` : "/api/parts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không lưu được.");
      closeModal();
      await load(search, page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/parts/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Không xoá được.");
      }
      setDeleting(null);
      await load(search, page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  function openTxn(type: "import" | "export", part?: Part) {
    setTxnForm({
      partId: part?.id ?? parts[0]?.id ?? "",
      type,
      quantity: "1",
      unitCost: part?.cost ?? 0,
      counterparty: "",
      note: "",
    });
    setTxnOpen(true);
  }

  async function handleTxn(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/parts/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(txnForm),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không tạo được phiếu.");
      setTxnOpen(false);
      await load(search, page);
      if (tab === "history") await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  const update = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Kho phụ tùng"
        subtitle="Tồn kho độc lập theo chi nhánh. Mọi biến động đều qua phiếu nhập/xuất."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/parts/bulk"
              className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              Nhập giá hàng loạt
            </Link>
            <Link
              href="/dashboard/parts/import"
              className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              Nhập từ Excel
            </Link>
            <GhostButton onClick={() => openTxn("import")} disabled={parts.length === 0}>
              Nhập kho
            </GhostButton>
            <GhostButton onClick={() => openTxn("export")} disabled={parts.length === 0}>
              Xuất kho
            </GhostButton>
            <PrimaryButton onClick={openCreate} disabled={branches.length === 0}>
              <PlusIcon className="h-4 w-4" /> Thêm phụ tùng
            </PrimaryButton>
          </div>
        }
      />

      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-white/[0.08] p-1">
          {(["parts", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === t ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "parts" ? "Danh mục" : "Lịch sử kho"}
            </button>
          ))}
        </div>
        {tab === "parts" && (
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Tìm theo mã, tên hoặc mã OEM..."
            className="min-w-64 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-orange-500 sm:max-w-md sm:flex-none"
          />
        )}
      </div>

      {tab === "parts" ? (
        <Card>
          {loading ? (
            <EmptyState title="Đang tải..." />
          ) : parts.length === 0 ? (
            <EmptyState title="Chưa có phụ tùng nào." />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Mã</th>
                    <th className="px-5 py-3 font-semibold">Phụ tùng</th>
                    <th className="px-5 py-3 text-right font-semibold">Tồn</th>
                    <th className="px-5 py-3 text-right font-semibold">Giá vốn</th>
                    <th className="px-5 py-3 text-right font-semibold">Giá bán</th>
                    <th className="px-5 py-3 font-semibold">Vị trí</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p) => {
                    // Cùng quy tắc với belowThresholdSql() ở server: null = ngưỡng chung 5,
                    // 0 = cố ý không cảnh báo (vật tư đặt theo xe), n > 0 = ngưỡng riêng.
                    const threshold = p.minStock ?? 5;
                    const low = p.minStock === 0 ? false : p.stock <= threshold;
                    return (
                      <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-5 py-3 font-mono text-xs text-zinc-400">{p.code}</td>
                        <td className="px-5 py-3">
                          <div>{p.name}</div>
                          <div className="text-xs text-zinc-500">
                            {[p.category, p.oemNumber].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={low ? "font-bold text-red-400" : ""}>
                            {p.stock} {p.unit}
                          </span>
                          {low && (
                            <div className="text-[11px] text-red-400/70">ngưỡng {threshold}</div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-zinc-400">
                          {p.cost === null ? (
                            <Badge tone="orange">chưa biết</Badge>
                          ) : (
                            formatVnd(p.cost)
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">{formatVnd(p.price)}</td>
                        <td className="px-5 py-3 text-zinc-400">{p.location ?? "—"}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openTxn("import", p)}
                              className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10"
                            >
                              Nhập
                            </button>
                            <button
                              onClick={() => openTxn("export", p)}
                              className="rounded-lg px-2 py-1 text-xs font-semibold text-orange-400 hover:bg-orange-500/10"
                            >
                              Xuất
                            </button>
                            <button
                              onClick={() => openEdit(p)}
                              className="rounded-lg p-2 text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                              title="Sửa"
                            >
                              <EditIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleting(p)}
                              className="rounded-lg p-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
                              title="Xoá"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {total > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-3 text-sm">
              <span className="text-zinc-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total} mã
              </span>
              <div className="flex gap-2">
                <GhostButton
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >
                  Trang trước
                </GhostButton>
                <GhostButton
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page + 1 >= totalPages || loading}
                >
                  Trang sau
                </GhostButton>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          {history.length === 0 ? (
            <EmptyState title="Chưa có phiếu nhập/xuất nào." />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Thời điểm</th>
                    <th className="px-5 py-3 font-semibold">Loại</th>
                    <th className="px-5 py-3 font-semibold">Phụ tùng</th>
                    <th className="px-5 py-3 text-right font-semibold">SL</th>
                    <th className="px-5 py-3 text-right font-semibold">Đơn giá</th>
                    <th className="px-5 py-3 font-semibold">Đối tác / Lệnh</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((t) => (
                    <tr key={t.id} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-5 py-3 text-zinc-400">{formatDateTime(t.createdAt)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={t.type === "import" ? "emerald" : "orange"}>
                          {t.type === "import" ? "Nhập" : "Xuất"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-zinc-500">{t.partCode}</span>{" "}
                        {t.partName}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {t.quantity} {t.unit}
                      </td>
                      <td className="px-5 py-3 text-right text-zinc-400">
                        {t.unitCost === null ? "—" : formatVnd(t.unitCost)}
                      </td>
                      <td className="px-5 py-3 text-zinc-400">
                        {t.orderCode ? (
                          <span className="font-mono text-xs">{t.orderCode}</span>
                        ) : (
                          (t.counterparty ?? "—")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {(creating || editing) && (
        <Modal
          title={editing ? "Sửa phụ tùng" : "Thêm phụ tùng"}
          onClose={closeModal}
          wide
          footer={
            <>
              <GhostButton type="button" onClick={closeModal}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="part-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu"}
              </PrimaryButton>
            </>
          }
        >
          <form id="part-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <TextField label="Mã nội bộ" required value={form.code} onChange={update("code")} />
            <TextField
              label="Mã OEM"
              hint="mã chính hãng, dùng khi đặt hàng"
              value={form.oemNumber}
              onChange={update("oemNumber")}
            />
            <div className="sm:col-span-2">
              <TextField label="Tên phụ tùng" required value={form.name} onChange={update("name")} />
            </div>
            <SelectField label="Nhóm" required value={form.category} onChange={update("category")}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label="Chi nhánh" required value={form.branchId} onChange={update("branchId")}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Đơn vị" value={form.unit} onChange={update("unit")}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Ngưỡng cảnh báo"
              type="number"
              hint="để trống = dùng ngưỡng chung (5)"
              value={form.minStock}
              onChange={update("minStock")}
            />
            <MoneyField
              label="Giá bán"
              value={form.price}
              onValueChange={(v) => setForm((p) => ({ ...p, price: v }))}
            />
            <MoneyField
              label="Giá vốn"
              hint="để 0 nếu chưa biết"
              value={form.cost}
              onValueChange={(v) => setForm((p) => ({ ...p, cost: v }))}
            />
            <div className="sm:col-span-2">
              <TextField label="Vị trí trong kho" value={form.location} onChange={update("location")} />
            </div>
            {!editing && (
              <p className="text-xs text-zinc-500 sm:col-span-2">
                Tồn kho bắt đầu từ 0 — dùng phiếu Nhập kho để đưa hàng vào, để mọi biến động
                đều có dòng lịch sử đối chiếu.
              </p>
            )}
          </form>
        </Modal>
      )}

      {txnOpen && (
        <Modal
          title={txnForm.type === "import" ? "Phiếu nhập kho" : "Phiếu xuất kho"}
          onClose={() => setTxnOpen(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setTxnOpen(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="txn-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Tạo phiếu"}
              </PrimaryButton>
            </>
          }
        >
          <form id="txn-form" onSubmit={handleTxn} className="flex flex-col gap-4">
            <SelectField
              label="Phụ tùng"
              required
              value={txnForm.partId}
              onChange={(e) => setTxnForm((p) => ({ ...p, partId: e.target.value }))}
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name} (tồn {p.stock} {p.unit})
                </option>
              ))}
            </SelectField>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Số lượng"
                type="number"
                required
                min={1}
                value={txnForm.quantity}
                onChange={(e) => setTxnForm((p) => ({ ...p, quantity: e.target.value }))}
              />
              {txnForm.type === "import" && (
                <MoneyField
                  label="Đơn giá nhập"
                  hint="cập nhật giá vốn hiện hành"
                  value={txnForm.unitCost}
                  onValueChange={(v) => setTxnForm((p) => ({ ...p, unitCost: v }))}
                />
              )}
            </div>
            <TextField
              label={txnForm.type === "import" ? "Nhà cung cấp" : "Lý do xuất"}
              value={txnForm.counterparty}
              onChange={(e) => setTxnForm((p) => ({ ...p, counterparty: e.target.value }))}
            />
            <TextAreaField
              label="Ghi chú"
              value={txnForm.note}
              onChange={(e) => setTxnForm((p) => ({ ...p, note: e.target.value }))}
            />
            {txnForm.type === "export" && (
              <p className="text-xs text-zinc-500">
                Phiếu xuất ở đây dành cho xuất lẻ (hỏng, trả hàng, chuyển kho). Xuất phụ tùng
                phục vụ sửa chữa nên làm từ trong lệnh sửa chữa để phiếu tự gắn vào lệnh.
              </p>
            )}
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Xoá phụ tùng"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setDeleting(null)}>
                Huỷ
              </GhostButton>
              <DangerButton onClick={handleDelete} disabled={saving}>
                {saving ? "Đang xoá..." : "Xoá"}
              </DangerButton>
            </>
          }
        >
          <p className="text-sm text-zinc-300">
            Xoá phụ tùng <b>{deleting.name}</b>?
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Phụ tùng đã có lịch sử nhập/xuất sẽ bị từ chối xoá để không mất dấu vết kho.
          </p>
        </Modal>
      )}
    </div>
  );
}
