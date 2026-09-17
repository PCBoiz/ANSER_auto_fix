import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import ChangePasswordForm from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

/**
 * Đổi mật khẩu bắt buộc, cho tài khoản đang dùng mật khẩu tạm.
 *
 * Nằm NGOÀI `/dashboard` là có chủ đích: `proxy.ts` chuyển hướng mọi request vào
 * /dashboard của tài khoản này về đây, nên nếu trang này cũng nằm trong /dashboard thì
 * chính nó bị chuyển hướng về chính nó — vòng lặp vô tận.
 *
 * Đổi lại, `proxy.ts` không gác đường dẫn này, nên trang tự kiểm tra phiên đăng nhập.
 */
export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Người đã đổi mật khẩu rồi mà tự gõ URL này thì vẫn cho vào (đổi mật khẩu chủ động là
  // việc hợp lệ), chỉ khác là có đường quay lại dashboard.
  const forced = user.mustChangePassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030305] p-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
        <h1 className="text-xl font-bold">
          {forced ? "Đặt mật khẩu mới trước khi tiếp tục" : "Đổi mật khẩu"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {forced
            ? "Tài khoản này đang dùng mật khẩu tạm do quản trị viên cấp. Hãy đặt một mật khẩu chỉ bạn biết — mật khẩu tạm đã đi qua tin nhắn hoặc điện thoại nên không còn riêng tư."
            : "Đặt mật khẩu mới cho tài khoản của bạn."}
        </p>

        <ChangePasswordForm forced={forced} />
      </div>
    </main>
  );
}
