"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { UploadIcon } from "@/components/dashboard/icons";
import { SelectField } from "@/components/ui/Field";
import {
  Badge,
  Card,
  ErrorBanner,
  GhostButton,
  PageHeader,
  PrimaryButton,
  TableWrap,
  formatVnd,
} from "@/components/ui/PageShell";

type Branch = { id: string; name: string };

type PreviewRow = {
  line: number;
  code: string;
  name: string;
  category: string | null;
  unit: string | null;
  price: number | null;
  cost: number | null;
  openingStock: number | null;
};

type Preview = {
  branchName: string;
  totalRows: number;
  createCount: number;
  updateCount: number;
  createSample: PreviewRow[];
  updateSample: Array<{ code: string; name: string; changes: string[] }>;
  issues: Array<{ line: number; message: string }>;
  issueCount: number;
  openingStockCount: number;
};

type Result = {
  created: number;
  updated: number;
  openingTransactions: number;
  skipped: number;
  branchName: string;
};

// Nhập danh mục phụ tùng từ Excel qua giao diện — trước đây chỉ làm được bằng cách chạy
// `scripts/import-legacy-2025.mjs` trên máy dev.
//
// Luôn hai bước: xem trước rồi mới ghi. Một file sai cột có thể tạo hàng trăm mã rác,
// và dọn lại chúng (khi đã lẫn với mã thật) tốn hơn nhiều so với nhìn kỹ một bảng.
export default function ImportPartsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((res) => res.json())
      .then((data) => {
        setBranches(data.branches ?? []);
        if (data.branches?.length === 1) setBranchId(data.branches[0].id);
      })
      .catch(() => setError("Không tải được danh sách chi nhánh."));
  }, []);

  async function send(mode: "preview" | "apply") {
    if (!file || !branchId) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("branchId", branchId);
      form.append("mode", mode);

      const res = await fetch("/api/parts/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không xử lý được file.");

      if (mode === "preview") {
        setPreview(data);
        setResult(null);
      } else {
        setResult(data);
        setPreview(null);
        setFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setBusy(false);
    }
  }

  function handlePreview(e: FormEvent) {
    e.preventDefault();
    send("preview");
  }

  // Đổi file hoặc chi nhánh thì bản xem trước cũ không còn đúng — xoá đi, không để người
  // dùng bấm "Ghi" dựa trên một bảng mô tả file khác.
  function resetPreview() {
    setPreview(null);
    setResult(null);
  }

  return (
    <div>
      <PageHeader
        title="Nhập phụ tùng từ Excel"
        subtitle="Xem trước đầy đủ trước khi ghi. Mã đã có chỉ được cập nhật những ô có giá trị trong file."
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

      {result && (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5">
          <p className="font-bold text-emerald-300">Đã nhập vào {result.branchName}</p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            <li>Tạo mới {result.created} phụ tùng</li>
            <li>Cập nhật {result.updated} phụ tùng đã có</li>
            {result.openingTransactions > 0 && (
              <li>Ghi {result.openingTransactions} phiếu nhập tồn đầu kỳ</li>
            )}
            {result.skipped > 0 && <li className="text-amber-300">Bỏ qua {result.skipped} dòng lỗi</li>}
          </ul>
        </div>
      )}

      <Card className="mb-6 p-5">
        <form onSubmit={handlePreview} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <SelectField
            label="Nhập vào chi nhánh"
            required
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              resetPreview();
            }}
          >
            <option value="">— chọn chi nhánh —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-300">
              File Excel (.xlsx) hoặc CSV
            </span>
            <input
              type="file"
              accept=".xlsx,.csv"
              required
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                resetPreview();
              }}
              className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
            />
          </label>

          <PrimaryButton type="submit" disabled={busy || !file || !branchId}>
            <UploadIcon className="h-4 w-4" />
            {busy && !preview ? "Đang đọc..." : "Xem trước"}
          </PrimaryButton>
        </form>

        <details className="mt-4 border-t border-white/[0.06] pt-4 text-sm text-zinc-400">
          <summary className="cursor-pointer font-semibold text-zinc-300">
            File cần có những cột nào?
          </summary>
          <div className="mt-3 space-y-2">
            <p>
              Dòng đầu tiên là tiêu đề. Hệ thống khớp cột theo <strong>tên</strong>, không theo
              vị trí, và không phân biệt dấu hay chữ hoa — thêm bớt cột khác không sao.
            </p>
            <p>
              <strong className="text-zinc-200">Bắt buộc:</strong> <code>Mã</code> (hoặc Mã phụ
              tùng, Mã vật tư, Mã hàng) và <code>Tên</code> (hoặc Tên phụ tùng, Tên vật tư).
            </p>
            <p>
              <strong className="text-zinc-200">Tuỳ chọn:</strong> Nhóm, ĐVT, Mã OEM, Giá bán, Giá
              vốn, Ngưỡng tồn, Vị trí, Tồn kho.
            </p>
            <p>
              Cột <code>Tồn kho</code> chỉ áp cho mã <strong>mới</strong>, và được ghi thành một
              phiếu nhập &quot;Tồn đầu kỳ&quot; để có lịch sử đối chiếu. Tồn của mã đã có{" "}
              <strong>không bao giờ</strong> bị ghi đè từ file — tồn thật có thể đã đổi qua phiếu
              nhập/xuất kể từ lúc xuất file.
            </p>
          </div>
        </details>
      </Card>

      {preview && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            <Tile label="Dòng đọc được" value={preview.totalRows} />
            <Tile label="Sẽ tạo mới" value={preview.createCount} tone="emerald" />
            <Tile label="Sẽ cập nhật" value={preview.updateCount} tone="sky" />
            <Tile label="Dòng lỗi (bỏ qua)" value={preview.issueCount} tone={preview.issueCount > 0 ? "amber" : "zinc"} />
          </div>

          {preview.issues.length > 0 && (
            <Card className="mb-4 p-5">
              <h2 className="mb-3 font-bold text-amber-300">Dòng sẽ bị bỏ qua</h2>
              <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
                {preview.issues.map((issue, i) => (
                  <li key={i} className="text-zinc-400">
                    <span className="mr-2 font-mono text-xs text-zinc-600">dòng {issue.line}</span>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {preview.createSample.length > 0 && (
            <Card className="mb-4">
              <h2 className="border-b border-white/[0.08] px-5 py-3 font-bold">
                Tạo mới
                {preview.createCount > preview.createSample.length && (
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    hiện {preview.createSample.length}/{preview.createCount} dòng đầu
                  </span>
                )}
              </h2>
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-left text-xs text-zinc-500 uppercase">
                      <th className="px-4 py-2 font-semibold">Dòng</th>
                      <th className="px-4 py-2 font-semibold">Mã</th>
                      <th className="px-4 py-2 font-semibold">Tên</th>
                      <th className="px-4 py-2 font-semibold">Nhóm</th>
                      <th className="px-4 py-2 text-right font-semibold">Giá bán</th>
                      <th className="px-4 py-2 text-right font-semibold">Giá vốn</th>
                      <th className="px-4 py-2 text-right font-semibold">Tồn đầu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.createSample.map((row) => (
                      <tr key={row.code} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-zinc-600">{row.line}</td>
                        <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                        <td className="px-4 py-2">{row.name}</td>
                        <td className="px-4 py-2 text-zinc-400">{row.category ?? <Badge>chưa phân nhóm</Badge>}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.price === null ? <span className="text-amber-400">trống</span> : formatVnd(row.price)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{formatVnd(row.cost)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.openingStock ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}

          {preview.updateSample.length > 0 && (
            <Card className="mb-4">
              <h2 className="border-b border-white/[0.08] px-5 py-3 font-bold">Cập nhật mã đã có</h2>
              <ul className="divide-y divide-white/[0.04]">
                {preview.updateSample.map((u) => (
                  <li key={u.code} className="px-5 py-3 text-sm">
                    <span className="font-mono text-xs text-zinc-400">{u.code}</span>
                    <span className="ml-2 font-medium">{u.name}</span>
                    <ul className="mt-1 ml-4 list-disc text-xs text-zinc-400">
                      {u.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-white/[0.08] bg-zinc-950 px-5 py-4">
            <p className="mr-auto text-sm text-zinc-400">
              Ghi vào <strong className="text-white">{preview.branchName}</strong>: tạo{" "}
              {preview.createCount}, cập nhật {preview.updateCount}
              {preview.openingStockCount > 0 && `, ${preview.openingStockCount} phiếu tồn đầu kỳ`}. Tất cả
              trong một lần — lỗi giữa chừng thì không ghi gì.
            </p>
            <GhostButton type="button" onClick={resetPreview} disabled={busy}>
              Huỷ
            </GhostButton>
            <PrimaryButton
              type="button"
              onClick={() => send("apply")}
              disabled={busy || (preview.createCount === 0 && preview.updateCount === 0)}
            >
              {busy ? "Đang ghi..." : "Ghi vào kho"}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "zinc" | "emerald" | "sky" | "amber";
}) {
  const color = { zinc: "text-white", emerald: "text-emerald-400", sky: "text-sky-400", amber: "text-amber-400" }[tone];
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <p className={`text-2xl font-extrabold tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{label}</p>
    </div>
  );
}
