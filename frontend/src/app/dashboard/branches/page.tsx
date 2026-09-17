"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { EditIcon, PlusIcon, TrashIcon } from "@/components/dashboard/icons";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
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
} from "@/components/ui/PageShell";
import { BRANCH_SPECIALTIES } from "@/server/domain";

// Trang quản lý chi nhánh — trước đây API `/api/branches` đã có CRUD đầy đủ nhưng không
// có trang nào gọi tới, nên sửa tên hay thêm xưởng phải gọi API bằng tay.
//
// Ba thứ trang này sửa được mà trước đây không: tên chi nhánh (kho thật đang mang tên
// "Xuong son go han" không dấu, và tên đó in lên phiếu giao khách), chuyên môn xưởng, và
// email nhận cảnh báo tồn kho của từng xưởng.

type Branch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  specialty: string | null;
  notificationEmail: string | null;
};

const EMPTY_FORM = {
  name: "",
  address: "",
  phone: "",
  specialty: "",
  notificationEmail: "",
};

// Bộ dấu tiếng Việt — dùng để cảnh báo tên chi nhánh viết không dấu ngay tại chỗ nhập,
// thay vì để người dùng phát hiện khi đã in ra phiếu giao khách.
const HAS_DIACRITICS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const UNACCENTED_VI_WORDS = new Set([
  "xuong", "son", "go", "han", "may", "dong", "sua", "chua", "xe", "oto",
  "chi", "nhanh", "trung", "tam", "co", "khi", "gam", "dien",
]);

function looksUnaccented(name: string) {
  if (!name.trim() || HAS_DIACRITICS.test(name)) return false;
  return (
    name.toLowerCase().split(/[\s\-_.]+/).filter((w) => UNACCENTED_VI_WORDS.has(w)).length >= 2
  );
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/branches");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được danh sách chi nhánh.");
      setBranches(data.branches);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreating(true);
  }

  function openEdit(b: Branch) {
    setForm({
      name: b.name,
      address: b.address ?? "",
      phone: b.phone ?? "",
      specialty: b.specialty ?? "",
      notificationEmail: b.notificationEmail ?? "",
    });
    setEditing(b);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        specialty: form.specialty || null,
        notificationEmail: form.notificationEmail.trim() || null,
      };
      const res = await fetch(editing ? `/api/branches/${editing.id}` : "/api/branches", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không lưu được chi nhánh.");
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/branches/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không xoá được chi nhánh.");
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  const nameWarning = looksUnaccented(form.name);

  return (
    <div>
      <PageHeader
        title="Chi nhánh / Xưởng"
        subtitle="Mỗi chi nhánh là một xưởng và đồng thời là một kho phụ tùng độc lập."
        action={
          <PrimaryButton onClick={openCreate}>
            <PlusIcon className="h-4 w-4" /> Thêm chi nhánh
          </PrimaryButton>
        }
      />

      <ErrorBanner message={error} />

      <Card>
        {loading ? (
          <EmptyState title="Đang tải..." />
        ) : branches.length === 0 ? (
          <EmptyState title="Chưa có chi nhánh nào" hint="Thêm xưởng đầu tiên để bắt đầu." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-xs text-zinc-500 uppercase">
                  <th className="px-4 py-3 font-semibold">Tên xưởng</th>
                  <th className="px-4 py-3 font-semibold">Chuyên môn</th>
                  <th className="px-4 py-3 font-semibold">Địa chỉ</th>
                  <th className="px-4 py-3 font-semibold">Điện thoại</th>
                  <th className="px-4 py-3 font-semibold">Email nhận cảnh báo</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-semibold">{b.name}</span>
                      {looksUnaccented(b.name) && (
                        <span className="ml-2">
                          <Badge tone="orange">thiếu dấu</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.specialty ? (
                        <Badge tone="sky">{b.specialty}</Badge>
                      ) : (
                        <span className="text-xs text-zinc-600">chưa khai</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{b.address ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-400">{b.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {b.notificationEmail ? (
                        <span className="text-zinc-400">{b.notificationEmail}</span>
                      ) : (
                        <span className="text-xs text-amber-400/80">
                          chưa có — cảnh báo tồn kho sẽ về email chung
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(b)}
                          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                          aria-label={`Sửa ${b.name}`}
                        >
                          <EditIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(b)}
                          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          aria-label={`Xoá ${b.name}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {(creating || editing) && (
        <Modal
          title={editing ? `Sửa chi nhánh "${editing.name}"` : "Thêm chi nhánh"}
          onClose={closeForm}
          footer={
            <>
              <GhostButton type="button" onClick={closeForm} disabled={saving}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="branch-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu"}
              </PrimaryButton>
            </>
          }
        >
          <form id="branch-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <TextField
                label="Tên xưởng"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Xưởng sơn gò hàn"
              />
              {nameWarning && (
                <p className="mt-1.5 text-[11px] text-amber-400">
                  Tên này có vẻ viết không dấu. Tên chi nhánh được in lên phiếu giao cho khách —
                  nên viết đủ dấu tiếng Việt.
                </p>
              )}
            </div>

            <SelectField
              label="Chuyên môn"
              hint="Dùng để gợi ý xưởng khi thêm dòng công"
              value={form.specialty}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
            >
              <option value="">— chưa khai —</option>
              {BRANCH_SPECIALTIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>

            <TextAreaField
              label="Địa chỉ"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />

            <TextField
              label="Điện thoại"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />

            <TextField
              label="Email nhận cảnh báo"
              type="email"
              hint="Cảnh báo tồn kho thấp của riêng xưởng này sẽ gửi tới đây"
              value={form.notificationEmail}
              onChange={(e) => setForm({ ...form, notificationEmail: e.target.value })}
            />
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Xoá chi nhánh"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setDeleting(null)} disabled={saving}>
                Huỷ
              </GhostButton>
              <DangerButton type="button" onClick={handleDelete} disabled={saving}>
                {saving ? "Đang xoá..." : "Xoá"}
              </DangerButton>
            </>
          }
        >
          <p className="text-sm text-zinc-300">
            Xoá chi nhánh <span className="font-semibold">{deleting.name}</span>?
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Hệ thống sẽ từ chối nếu chi nhánh này còn phụ tùng trong kho, lệnh sửa chữa, nhân sự
            hoặc lịch hẹn — xoá khi đó sẽ kéo theo cả kho lẫn lịch sử của xưởng.
          </p>
        </Modal>
      )}
    </div>
  );
}
