// Hook chuẩn của Next.js — chạy 1 lần lúc server khởi động. Mọi hàm gọi ở đây đều
// idempotent nên chạy lại nhiều lần không sinh dữ liệu trùng.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { seedBootstrapAdmin } = await import("@/server/store/users");
    const { ensureDefaultBranch, seedInitialData } = await import("@/server/store/seed");
    const { ensureCompanySettingsRow } = await import("@/server/store/settings");

    // Thay `seedDemoUser()` cũ: không còn tài khoản demo mật khẩu cố định nào được tạo
    // tự động. Chỉ tạo quản trị viên đầu tiên khi env khai báo tường minh — xem
    // `seedBootstrapAdmin()`.
    await seedBootstrapAdmin();
    await ensureDefaultBranch();
    await seedInitialData();
    await ensureCompanySettingsRow();

    if (process.env.INTERNAL_SCHEDULER === "true") {
      const { startInternalScheduler } = await import("@/server/automation/scheduler");
      startInternalScheduler();
    }
  }
}
