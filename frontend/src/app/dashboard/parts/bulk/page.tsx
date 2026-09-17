"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SelectField, TextField } from "@/components/ui/Field";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  GhostButton,
  PageHeader,
  PrimaryButton,
  TableWrap,
  formatVnd,
} from "@/components/ui/PageShell";

// Nhập giá bán / ngưỡng tồn HÀNG LOẠT.
//
// Bài toán thật: 781 phụ tùng đồng-sơn nhập từ Excel đều đang để giá bán 0đ và không có
// ngưỡng tồn riêng. Hai hệ quả: (1) xuất chúng vào lệnh sửa chữa ra dòng 0đ nên khách
// không bị tính tiền vật tư; (2) vì thiếu ngưỡng riêng, cả kho dùng chung mức mặc định 5
// nên cảnh báo tồn thấp liệt kê 724 mặt hàng mỗi lần chạy.
//
// Sửa từng mã qua modal là 781 lần mở-gõ-đóng. Màn này gõ thẳng trên bảng, 100 dòng một
// trang, chỉ gửi lên những dòng thực sự đổi.

const PAGE_SIZE = 100;

type Part = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  price: number;
  cost: number | null;
  minStock: number | null;
  branchName: string;
};

type Branch = { id: string; name: string };

type Draft = { price?: string; minStock?: string };

export default function BulkPartsPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [filter, setFilter] = useState<"missingPrice" | "missingThreshold" | "all">("missingPrice");

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search.trim()) params.set("search", search.trim());
      if (branchId) params.set("branchId", branchId);
      if (filter === "missingPrice") params.set("missingPrice", "1");
      if (filter === "missingThreshold") params.set("missingThreshold", "1");

      const res = await fetch(`/api/parts?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được danh sách phụ tùng.");
      setParts(data.parts);
      setTotal(data.total);
      setBranches(data.branches);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, [page, search, branchId, filter]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  // Đổi bộ lọc thì quay về trang đầu — giữ nguyên trang 7 khi bộ lọc mới chỉ có 2 trang
  // sẽ ra bảng rỗng trông như mất dữ liệu.
  useEffect(() => {
    setPage(0);
  }, [search, branchId, filter]);

  function setDraft(id: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setSavedCount(null);
  }

  // Chỉ gửi lên dòng thực sự ĐỔI so với giá trị đang lưu. Gửi cả trang 100 dòng mỗi lần
  // lưu sẽ ghi đè `updatedAt` của những mã không ai chạm vào, làm mất dấu vết "sửa lần
  // cuối lúc nào" — thứ duy nhất để biết đã điền tới đâu trong 781 mã.
  const changes = useMemo(() => {
    const out: Array<{ id: string; price?: number; minStock?: number | null }> = [];
    for (const part of parts) {
      const draft = drafts[part.id];
      if (!draft) continue;
      const patch: { id: string; price?: number; minStock?: number | null } = { id: part.id };
      let changed = false;

      if (draft.price !== undefined && draft.price !== "") {
        const price = Number(draft.price);
        if (Number.isFinite(price) && price >= 0 && price !== part.price) {
          patch.price = Math.round(price);
          changed = true;
        }
      }

      if (draft.minStock !== undefined) {
        if (draft.minStock === "") {
          // Xoá ô = quay về dùng ngưỡng chung (null), khác với gõ 0 = không cảnh báo.
          if (part.minStock !== null) {
            patch.minStock = null;
            changed = true;
          }
        } else {
          const minStock = Number(draft.minStock);
          if (Number.isFinite(minStock) && minStock >= 0 && minStock !== part.minStock) {
            patch.minStock = Math.round(minStock);
            changed = true;
          }
        }
      }

      if (changed) out.push(patch);
    }
    return out;
  }, [parts, drafts]);

  async function handleSave() {
    if (changes.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/parts/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches: changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không lưu được.");
      setSavedCount(data.updated);
      setDrafts({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  // Điền nhanh: áp một giá trị cho MỌI dòng đang trống trên trang này. Với ngưỡng tồn,
  // đây là thao tác chính — đặt 0 cho toàn bộ vật tư đặt-theo-xe để chúng thôi kêu.
  function fillEmpty(field: keyof Draft, value: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const part of parts) {
        const current = field === "price" ? part.price : part.minStock;
        const isEmpty = field === "price" ? current === 0 : current === null;
        const alreadyTyped = next[part.id]?.[field];
        if (isEmpty && !alreadyTyped) {
          next[part.id] = { ...next[part.id], [field]: value };
        }
      }
      return next;
    });
    setSavedCount(null);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Nhập giá & ngưỡng tồn hàng loạt"
        subtitle="Gõ thẳng trên bảng. Chỉ những ô thực sự thay đổi mới được gửi lên khi bấm Lưu."
        action={
          <Link
            href="/dashboard/parts"
            className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06]"
          >
            Về Kho phụ tùng
          </Link>
        }
      />

      <ErrorBanner message={error} />

      {savedCount !== null && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          Đã lưu {savedCount} phụ tùng.
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Tìm theo mã / tên / mã OEM"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="cửa trước, 90915..."
          />
          <SelectField
            label="Chi nhánh"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Tất cả chi nhánh</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Lọc"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="missingPrice">Chưa có giá bán</option>
            <option value="missingThreshold">Chưa có ngưỡng tồn</option>
            <option value="all">Tất cả</option>
          </SelectField>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
          <span className="text-xs font-semibold text-zinc-500">Điền nhanh cho cả trang:</span>
          <GhostButton type="button" onClick={() => fillEmpty("minStock", "0")}>
            Ngưỡng tồn = 0 (vật tư đặt theo xe)
          </GhostButton>
          <GhostButton type="button" onClick={() => fillEmpty("minStock", "2")}>
            Ngưỡng tồn = 2
          </GhostButton>
          <span className="ml-auto text-xs text-zinc-500">
            {total} mã khớp bộ lọc · trang {page + 1}/{totalPages}
          </span>
        </div>
      </Card>

      <Card>
        {loading ? (
          <EmptyState title="Đang tải..." />
        ) : parts.length === 0 ? (
          <EmptyState
            title="Không còn mã nào khớp bộ lọc"
            hint={filter === "missingPrice" ? "Mọi phụ tùng đã có giá bán." : undefined}
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-xs text-zinc-500 uppercase">
                  <th className="px-4 py-3 font-semibold">Mã</th>
                  <th className="px-4 py-3 font-semibold">Tên phụ tùng</th>
                  <th className="px-4 py-3 font-semibold">Chi nhánh</th>
                  <th className="px-4 py-3 text-right font-semibold">Tồn</th>
                  <th className="px-4 py-3 text-right font-semibold">Giá vốn</th>
                  <th className="px-4 py-3 font-semibold">Giá bán (đ)</th>
                  <th className="px-4 py-3 font-semibold">Ngưỡng tồn</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => {
                  const draft = drafts[part.id] ?? {};
                  const priceValue = draft.price ?? (part.price === 0 ? "" : String(part.price));
                  const minStockValue =
                    draft.minStock ?? (part.minStock === null ? "" : String(part.minStock));
                  const touched = changes.some((c) => c.id === part.id);

                  return (
                    <tr
                      key={part.id}
                      className={`border-b border-white/[0.04] last:border-0 ${touched ? "bg-emerald-500/[0.05]" : ""}`}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-zinc-400">{part.code}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium">{part.name}</span>
                        <span className="ml-2 text-xs text-zinc-600">{part.unit}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">{part.branchName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {part.stock === 0 ? (
                          <span className="text-zinc-600">0</span>
                        ) : (
                          part.stock
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums text-zinc-500">
                        {part.cost === null ? (
                          <Badge tone="zinc">chưa biết</Badge>
                        ) : (
                          formatVnd(part.cost)
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          step={1000}
                          inputMode="numeric"
                          value={priceValue}
                          onChange={(e) => setDraft(part.id, "price", e.target.value)}
                          placeholder="0"
                          aria-label={`Giá bán của ${part.name}`}
                          className="w-32 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-1.5 text-right text-sm tabular-nums text-white outline-none focus:border-orange-500"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={minStockValue}
                          onChange={(e) => setDraft(part.id, "minStock", e.target.value)}
                          placeholder="dùng chung"
                          aria-label={`Ngưỡng tồn của ${part.name}`}
                          className="w-28 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-1.5 text-right text-sm tabular-nums text-white outline-none focus:border-orange-500"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-950/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
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

        <p className="text-sm text-zinc-400">
          {changes.length === 0 ? (
            "Chưa có thay đổi nào."
          ) : (
            <>
              <span className="font-bold text-emerald-400">{changes.length}</span> dòng đã sửa, chưa lưu.
            </>
          )}
        </p>

        <div className="ml-auto">
          <PrimaryButton type="button" onClick={handleSave} disabled={saving || changes.length === 0}>
            {saving ? "Đang lưu..." : `Lưu ${changes.length} dòng`}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
