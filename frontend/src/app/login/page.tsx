"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import FloatingInput from "@/components/FloatingInput";
import { flowLandingPath } from "@/lib/flow";

// Nút điền nhanh cho tài khoản thử — tiện bấm qua lại giữa các luồng giao diện
// (quản lý / kế toán / KTV) khi đang phát triển.
//
// TRƯỚC ĐÂY DANH SÁCH NÀY GHI CỨNG 3 CẶP EMAIL + MẬT KHẨU TRONG SOURCE. Đây là file
// client component, nghĩa là ba mật khẩu đó được đóng gói vào JavaScript gửi tới TRÌNH
// DUYỆT của mọi khách truy cập — bất kỳ ai mở tab Network cũng đọc được, không cần đăng
// nhập. Chúng còn nằm trong lịch sử git công khai, nên phải coi là đã lộ và phải đổi.
//
// Nay đọc từ biến môi trường, và vì `NEXT_PUBLIC_*` vẫn đi vào bundle trình duyệt nên
// nó CHỈ được đọc khi không phải production — đặt nhầm biến này trên server thật cũng
// không lộ gì. Định dạng (đặt trong `.env.local`, không commit):
//
//   NEXT_PUBLIC_DEV_QUICK_ACCOUNTS=[{"label":"Kế toán","email":"a@b.c","password":"..."}]
type QuickAccount = { label: string; email: string; password: string };

function readQuickAccounts(): QuickAccount[] {
  if (process.env.NODE_ENV === "production") return [];
  const raw = process.env.NEXT_PUBLIC_DEV_QUICK_ACCOUNTS;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is QuickAccount =>
        typeof a === "object" && a !== null && "email" in a && "password" in a,
    );
  } catch {
    // Cấu hình sai không được làm chết trang đăng nhập — đây chỉ là tiện ích lúc dev.
    return [];
  }
}

const QUICK_ACCOUNTS = readQuickAccounts();

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // proxy.ts gắn ?next=... khi chặn người chưa đăng nhập — quay lại đúng trang họ định vào.
  const nextPath = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function fillAccount(account: { email: string; password: string }) {
    setEmail(account.email);
    setPassword(account.password);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Email hoặc mật khẩu không đúng.");

      // Chỉ nhận đường dẫn nội bộ: `next` đến từ URL nên người ngoài chỉnh được, mở
      // đường cho chuyển hướng sang trang giả mạo nếu tin nguyên xi. Không có `next`
      // (đăng nhập thường, không phải bị chặn từ một trang cụ thể) thì vào đúng trang
      // đích của luồng tài khoản này thay vì luôn về /dashboard.
      // Mật khẩu tạm (do quản trị viên cấp, hoặc tài khoản khởi tạo từ env) phải được
      // đổi trước khi vào bất cứ đâu — bỏ qua cả `next`, vì trang đó cũng sẽ chặn lại.
      if (data.mustChangePassword) {
        router.push("/doi-mat-khau");
        return;
      }
      router.push(nextPath?.startsWith("/") ? nextPath : flowLandingPath(data.flow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể đăng nhập. Vui lòng thử lại.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brandTitle="ANSER Auto"
      brandSubtitle="Phần mềm điều hành gara: tiếp nhận xe, lập lệnh sửa chữa, quản lý kho phụ tùng và chăm sóc khách hàng trên cùng một hệ thống."
      formTitle="Chào mừng trở lại"
      formSubtitle="Đăng nhập để vào khu vực điều hành xưởng"
      switchText="Chưa có tài khoản?"
      switchLinkLabel="Đăng ký ngay"
      switchHref="/register"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        <FloatingInput
          id="email"
          type="email"
          label="Địa chỉ Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <FloatingInput
          id="password"
          type="password"
          label="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-white py-4 text-[15px] font-bold text-black transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(255,255,255,0.2)] disabled:opacity-60"
        >
          {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>

      {QUICK_ACCOUNTS.length > 0 && (
      <div className="mt-10 flex flex-col gap-2 border-t border-white/[0.08] pt-6">
        <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-amber-400/80 uppercase">
          Chỉ hiện khi chạy máy dev
        </p>
        {QUICK_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            onClick={() => fillAccount(account)}
            className="flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-black/30 p-3 text-left transition-colors hover:border-orange-500/40 hover:bg-orange-500/5"
          >
            <span className="text-xs font-semibold text-zinc-400">
              <span className="mr-1">👤</span> {account.label}
            </span>
            <span className="font-mono text-xs text-zinc-500">{account.email}</span>
          </button>
        ))}
      </div>
      )}
    </AuthShell>
  );
}

// useSearchParams() cần Suspense boundary khi build tĩnh — không có thì `next build` fail.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030305]" />}>
      <LoginForm />
    </Suspense>
  );
}
