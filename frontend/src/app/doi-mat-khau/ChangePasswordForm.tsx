"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import FloatingInput from "@/components/FloatingInput";

export default function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Kiểm tra khớp ở client là đủ cho ô xác nhận: server không cần biết ô này tồn tại,
    // nó chỉ nhận đúng một mật khẩu mới. Gửi cả hai lên rồi so ở server chỉ thêm một
    // vòng mạng cho một lỗi gõ nhầm.
    if (newPassword !== confirmPassword) {
      setError("Hai ô mật khẩu mới không khớp nhau.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Không đổi được mật khẩu.");

      // `router.refresh()` trước khi chuyển trang: cookie vừa được cấp lại (không còn cờ
      // bắt buộc đổi), nhưng bản render đã cache phía client vẫn là bản cũ.
      router.refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đổi được mật khẩu.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}

      <FloatingInput
        id="currentPassword"
        type="password"
        label="Mật khẩu hiện tại"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
      />
      <FloatingInput
        id="newPassword"
        type="password"
        label="Mật khẩu mới (ít nhất 8 ký tự)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
        minLength={8}
      />
      <FloatingInput
        id="confirmPassword"
        type="password"
        label="Nhập lại mật khẩu mới"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        minLength={8}
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-white py-4 text-[15px] font-bold text-black transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
      >
        {loading ? "Đang lưu..." : "Đặt mật khẩu mới"}
      </button>

      {!forced && (
        <a href="/dashboard" className="text-center text-sm text-zinc-400 hover:text-white">
          Quay lại trang quản lý
        </a>
      )}
    </form>
  );
}
