"use client";

import { PrintIcon } from "@/components/dashboard/icons";

// Nút in tách thành client component riêng vì `window.print()` chỉ chạy ở trình duyệt —
// phần còn lại của trang in là Server Component đọc thẳng DB.
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
    >
      <PrintIcon className="h-4 w-4" />
      In hoá đơn
    </button>
  );
}
