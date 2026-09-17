"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { SelectField, TextField } from "@/components/ui/Field";
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

const ROLE_LABELS: Record<string, string> = { staff: "Nhân viên", manager: "Quản lý", admin: "Quản trị viên" };
const ASSIGNABLE_ROLES = ["staff", "manager"];

type Account = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  employeeId: string | null;
  employeeName: string | null;
  employeePosition: string | null;
  mustChangePassword: boolean;
};

// Mật khẩu tạm gợi ý: 12 ký tự từ bảng chữ không gây nhầm khi đọc qua điện thoại (bỏ 0/O,
// 1/l/I). Dùng crypto của trình duyệt, không dùng Math.random — mật khẩu đoán được thì
// cờ "bắt buộc đổi" cũng chỉ bảo vệ tới lúc kẻ khác đăng nhập trước.
function suggestTempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type Employee = { id: string; name: string; position: string | null };

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState({ role: "staff", employeeId: "", email: "" });
  const [editError, setEditError] = useState<string | null>(null);

  const [resetting, setResetting] = useState<Account | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    role: "staff",
    employeeId: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [uRes, eRes] = await Promise.all([
      fetch("/api/users"),
      fetch("/api/employees?activeOnly=1"),
    ]);
    const uData = await uRes.json().catch(() => null);
    if (!uRes.ok) {
      setError(uData?.message ?? "Không tải được danh sách tài khoản.");
      setLoading(false);
      return;
    }
    setAccounts(uData.users);
    if (eRes.ok) setEmployees((await eRes.json()).employees);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/users"), fetch("/api/employees?activeOnly=1")])
      .then(async ([uRes, eRes]) => {
        if (cancelled) return;
        const uData = await uRes.json().catch(() => null);
        if (!uRes.ok) {
          setError(uData?.message ?? "Không tải được danh sách tài khoản.");
          setLoading(false);
          return;
        }
        setAccounts(uData.users);
        if (eRes.ok) setEmployees((await eRes.json()).employees);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Không tải được danh sách tài khoản.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openEdit(a: Account) {
    setForm({ role: a.role, employeeId: a.employeeId ?? "", email: a.email });
    setEditError(null);
    setEditing(a);
  }

  function openReset(a: Account) {
    setTempPassword(suggestTempPassword());
    setResetDone(false);
    setResetError(null);
    setResetting(a);
  }

  async function handleReset() {
    if (!resetting) return;
    setSaving(true);
    setResetError(null);
    try {
      const res = await fetch(`/api/users/${resetting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: tempPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không đặt lại được mật khẩu.");
      // Giữ modal mở để quản trị viên chép mật khẩu tạm đọc cho nhân viên — đóng ngay sau
      // khi lưu là mất chuỗi đó vĩnh viễn (server chỉ lưu hash).
      setResetDone(true);
      await load();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/users/${deleting.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không xoá được tài khoản.");
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setCreateForm({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: suggestTempPassword(),
      role: "staff",
      employeeId: "",
    });
    setCreateError(null);
    setCreating(true);
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: createForm.firstName,
          lastName: createForm.lastName,
          email: createForm.email,
          phone: createForm.phone || undefined,
          password: createForm.password,
          role: createForm.role,
          employeeId: createForm.employeeId || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không tạo được tài khoản.");
      setCreating(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      // Tài khoản admin: chỉ đổi được email (vai trò admin không gán/gỡ qua giao diện, xem
      // ASSIGNABLE_ROLES) — gửi `role` cho admin sẽ bị server hiểu là hạ cấp.
      const payload =
        editing.role === "admin"
          ? { email: form.email }
          : { role: form.role, employeeId: form.employeeId || null, email: form.email };
      const res = await fetch(`/api/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không lưu được.");
      setEditing(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tài khoản"
        subtitle="Gán vai trò và liên kết mỗi tài khoản đăng nhập với đúng 1 hồ sơ nhân sự — chức vụ của hồ sơ đó (Kế toán / Kỹ thuật viên) quyết định luồng giao diện tài khoản sẽ thấy."
        action={<PrimaryButton onClick={openCreate}>+ Cấp tài khoản</PrimaryButton>}
      />

      <ErrorBanner message={error} />

      <Card>
        {loading ? (
          <EmptyState title="Đang tải..." />
        ) : accounts.length === 0 ? (
          <EmptyState title="Chưa có tài khoản nào." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                <tr>
                  <th className="px-5 py-3 font-semibold">Họ tên</th>
                  <th className="px-5 py-3 font-semibold">Email</th>
                  <th className="px-5 py-3 font-semibold">Vai trò</th>
                  <th className="px-5 py-3 font-semibold">Hồ sơ nhân sự liên kết</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 font-semibold">
                      {a.firstName} {a.lastName}
                    </td>
                    <td className="px-5 py-3 text-zinc-400">
                      {a.email}
                      {a.mustChangePassword && (
                        <span className="ml-2">
                          <Badge tone="orange">chưa đổi mật khẩu tạm</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={a.role === "admin" ? "violet" : a.role === "manager" ? "sky" : "zinc"}>
                        {ROLE_LABELS[a.role] ?? a.role}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-zinc-400">
                      {a.employeeName ? `${a.employeeName} (${a.employeePosition ?? "—"})` : "— Chưa liên kết —"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(a)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/[0.06]"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => openReset(a)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-sky-400 hover:bg-sky-500/10"
                        >
                          Đặt lại mật khẩu
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(a);
                          }}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                        >
                          Xoá
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

      {creating && (
        <Modal
          title="Cấp tài khoản cho nhân viên"
          onClose={() => setCreating(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setCreating(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="create-account-form" disabled={saving}>
                {saving ? "Đang tạo..." : "Tạo tài khoản"}
              </PrimaryButton>
            </>
          }
        >
          <form
            id="create-account-form"
            onSubmit={handleCreateSubmit}
            className="flex flex-col gap-4"
          >
            <ErrorBanner message={createError} />
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Họ"
                required
                value={createForm.firstName}
                onChange={(e) => setCreateForm((p) => ({ ...p, firstName: e.target.value }))}
              />
              <TextField
                label="Tên"
                required
                value={createForm.lastName}
                onChange={(e) => setCreateForm((p) => ({ ...p, lastName: e.target.value }))}
              />
            </div>
            <TextField
              label="Email đăng nhập"
              type="email"
              required
              value={createForm.email}
              onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
            />
            <TextField
              label="Số điện thoại"
              value={createForm.phone}
              onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
            />
            <TextField
              label="Mật khẩu tạm"
              type="text"
              required
              hint="ít nhất 8 ký tự — đã gợi ý sẵn một chuỗi ngẫu nhiên. Nhân viên BẮT BUỘC đổi ở lần đăng nhập đầu"
              value={createForm.password}
              onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
            />
            <SelectField
              label="Vai trò"
              value={createForm.role}
              onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Hồ sơ nhân sự liên kết"
              hint="quyết định luồng kế toán/KTV — bỏ trống = tài khoản dùng đủ tính năng"
              value={createForm.employeeId}
              onChange={(e) => setCreateForm((p) => ({ ...p, employeeId: e.target.value }))}
            >
              <option value="">— Không liên kết —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} {emp.position ? `(${emp.position})` : ""}
                </option>
              ))}
            </SelectField>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal
          title={`Sửa tài khoản — ${editing.firstName} ${editing.lastName}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setEditing(null)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="account-form" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu"}
              </PrimaryButton>
            </>
          }
        >
          <form id="account-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <ErrorBanner message={editError} />
            <TextField
              label="Email đăng nhập"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
            {editing.role === "admin" ? (
              <p className="rounded-xl bg-white/[0.04] px-4 py-3 text-xs text-zinc-400">
                Tài khoản quản trị viên: chỉ đổi được email. Nếu đây là tài khoản demo đang là quản
                trị viên duy nhất, hãy đổi sang email thật của chủ gara rồi bấm{" "}
                <b>Đặt lại mật khẩu</b> — tài khoản demo không xoá được vì hệ thống luôn cần ít nhất
                một quản trị viên.
              </p>
            ) : (
              <>
                <SelectField
                  label="Vai trò"
                  value={form.role}
                  onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Hồ sơ nhân sự liên kết"
                  hint="quyết định luồng kế toán/KTV — bỏ trống = tài khoản dùng đủ tính năng"
                  value={form.employeeId}
                  onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
                >
                  <option value="">— Không liên kết —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} {emp.position ? `(${emp.position})` : ""}
                    </option>
                  ))}
                </SelectField>
              </>
            )}
          </form>
        </Modal>
      )}

      {resetting && (
        <Modal
          title={`Đặt lại mật khẩu — ${resetting.email}`}
          onClose={() => setResetting(null)}
          footer={
            resetDone ? (
              <PrimaryButton type="button" onClick={() => setResetting(null)}>
                Đã chép mật khẩu, đóng
              </PrimaryButton>
            ) : (
              <>
                <GhostButton type="button" onClick={() => setResetting(null)} disabled={saving}>
                  Huỷ
                </GhostButton>
                <PrimaryButton type="button" onClick={handleReset} disabled={saving || tempPassword.length < 8}>
                  {saving ? "Đang lưu..." : "Đặt mật khẩu tạm"}
                </PrimaryButton>
              </>
            )
          }
        >
          <div className="flex flex-col gap-4">
            <ErrorBanner message={resetError} />
            {resetDone ? (
              <>
                <p className="text-sm text-emerald-300">
                  Đã đặt. Đọc mật khẩu tạm dưới đây cho người dùng — đóng hộp thoại này là không xem
                  lại được nữa.
                </p>
                <p className="rounded-xl bg-black/40 px-4 py-3 text-center font-mono text-lg tracking-wider select-all">
                  {tempPassword}
                </p>
                <p className="text-xs text-zinc-500">
                  Ở lần đăng nhập kế tiếp, hệ thống chặn mọi trang cho tới khi họ tự đặt mật khẩu mới.
                  Phiên đăng nhập hiện có của tài khoản này cũng bị chặn truy cập dữ liệu ngay lập tức.
                </p>
              </>
            ) : (
              <>
                <TextField
                  label="Mật khẩu tạm"
                  hint="đã gợi ý sẵn chuỗi ngẫu nhiên — có thể sửa, tối thiểu 8 ký tự"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                />
                <p className="text-xs text-zinc-500">
                  Người dùng sẽ phải đổi mật khẩu này ở lần đăng nhập tiếp theo. Dùng khi nhân viên quên
                  mật khẩu, hoặc khi mật khẩu cũ có thể đã lộ.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Xoá tài khoản"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setDeleting(null)} disabled={saving}>
                Huỷ
              </GhostButton>
              <DangerButton type="button" onClick={handleDelete} disabled={saving}>
                {saving ? "Đang xoá..." : "Xoá tài khoản"}
              </DangerButton>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <ErrorBanner message={deleteError} />
            <p className="text-sm text-zinc-300">
              Xoá tài khoản <span className="font-semibold">{deleting.email}</span>? Người này sẽ không
              đăng nhập được nữa.
            </p>
            <p className="text-sm text-zinc-500">
              Hồ sơ nhân sự{deleting.employeeName ? ` "${deleting.employeeName}"` : ""} và giờ công đã chấm
              vẫn được giữ — chỉ mất quyền đăng nhập. Hệ thống từ chối xoá tài khoản đang đăng nhập
              và quản trị viên cuối cùng.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
