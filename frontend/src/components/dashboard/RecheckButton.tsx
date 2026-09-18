"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Bước KIỂM CHỨNG theo yêu cầu người dùng: vừa bật lại Docker, vừa thêm SMTP trong n8n — bấm
// để chạy ngay một lượt canh gác thay vì đợi lượt kế (30 phút ở bản tự host, một ngày trên
// Vercel Hobby). Sự cố đã hết sẽ đóng ngay, và trang tải lại với số liệu mới.
export default function RecheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function recheck() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: "watchdog" }),
      });
      const data = await res.json().catch(() => null);
      setMessage(data?.result?.summary ?? data?.message ?? (res.ok ? "Đã kiểm tra." : "Không chạy được."));
      router.refresh();
    } catch {
      setMessage("Không kết nối được tới server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={recheck}
        disabled={busy}
        className="rounded-xl border border-white/[0.12] px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/[0.06] disabled:opacity-50"
      >
        {busy ? "Đang kiểm tra…" : "Kiểm tra lại ngay"}
      </button>
      {message && <span className="text-xs text-zinc-400">{message}</span>}
    </div>
  );
}
