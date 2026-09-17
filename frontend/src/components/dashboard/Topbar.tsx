"use client";

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon, ChevronDownIcon, SearchIcon } from "@/components/dashboard/icons";

type PublicUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string;
};

type SearchHit = { group: string; title: string; subtitle: string; href: string };

type NotificationItem = {
  id: string;
  kind: string;
  severity: "high" | "normal";
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  staff: "Nhân viên",
  manager: "Quản lý",
  admin: "Quản trị viên",
};

// Chuông tự làm mới mỗi 5 phút. Thông báo sinh theo lịch (bản tin sáng 7h, tổng hợp kế toán
// thứ Hai), nên hỏi dồn dập hơn chỉ tốn truy vấn mà không có gì mới.
const NOTIFICATION_POLL_MS = 5 * 60 * 1000;

function relativeTime(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

export default function Topbar() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // --- Tìm kiếm ---
  // Trước đây ô này chỉ là hình vẽ: gõ vào không làm gì.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Thông báo ---
  // Trước đây chấm đỏ trên chuông LUÔN sáng dù không có gì — dạy người dùng rằng chấm đỏ
  // không có nghĩa gì, đúng lúc hệ thống bắt đầu có thông báo thật.
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.user) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/notifications")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          setNotifications(data.items ?? []);
          setUnread(data.unread ?? 0);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, NOTIFICATION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Tìm có trễ 250ms: gõ "30A12345" không được bắn 8 request, mỗi cái quét 6 bảng.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((res) => (res.ok ? res.json() : { hits: [] }))
        .then((data) => {
          if (cancelled) return;
          setHits(data.hits ?? []);
          setActiveIndex(-1);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Ctrl+K / Cmd+K để nhảy vào ô tìm kiếm từ bất kỳ đâu — lễ tân tra biển số khi khách vừa
  // đứng trước quầy, không có thời gian với chuột.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const goTo = useCallback(
    (hit: SearchHit) => {
      setSearchOpen(false);
      setQuery("");
      setHits([]);
      router.push(hit.href);
    },
    [router],
  );

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSearchOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = hits[activeIndex] ?? hits[0];
      if (hit) goTo(hit);
    }
  }

  async function openBell() {
    const next = !bellOpen;
    setBellOpen(next);
    setMenuOpen(false);
    if (next && unread > 0) {
      setUnread(0);
      // Đánh dấu đã xem ngay khi MỞ chuông, không đợi bấm từng dòng: gara có vài người dùng
      // và vài thông báo mỗi ngày, "đã nhìn thấy" là đủ nghĩa.
      fetch("/api/notifications", { method: "POST" }).catch(() => {});
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const initial = user ? user.firstName.charAt(0).toUpperCase() : "?";
  const fullName = user ? `${user.firstName} ${user.lastName}` : "Đang tải...";
  const roleLabel = user ? (ROLE_LABELS[user.role] ?? user.role) : "";
  const showResults = searchOpen && query.trim().length >= 2;

  // Gom kết quả theo nhóm nhưng giữ chỉ số phẳng để phím mũi tên đi xuyên nhóm.
  const groups: Array<{ name: string; items: Array<{ hit: SearchHit; index: number }> }> = [];
  hits.forEach((hit, index) => {
    let group = groups.find((g) => g.name === hit.group);
    if (!group) {
      group = { name: hit.group, items: [] };
      groups.push(group);
    }
    group.items.push({ hit, index });
  });

  return (
    <header className="relative z-30 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-[#030305]/70 px-6 py-4 backdrop-blur-xl">
      <div className="relative hidden max-w-md flex-1 sm:block">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
            if (e.target.value.trim().length < 2) setHits([]);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          onKeyDown={onSearchKeyDown}
          placeholder="Tìm biển số, khách hàng, lệnh, phụ tùng..."
          aria-label="Tìm kiếm"
          aria-expanded={showResults}
          aria-controls="topbar-search-results"
          role="combobox"
          className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-2 pr-16 pl-9 text-sm text-white placeholder-zinc-500 outline-none focus:border-orange-500"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          Ctrl K
        </kbd>

        {showResults && (
          <div
            id="topbar-search-results"
            role="listbox"
            className="absolute top-full right-0 left-0 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-white/[0.08] bg-zinc-950 p-1.5 shadow-2xl"
          >
            {searching && hits.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-zinc-500">Đang tìm...</p>
            ) : hits.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-zinc-500">Không tìm thấy gì cho “{query.trim()}”.</p>
            ) : (
              groups.map((group) => (
                <div key={group.name} className="py-1">
                  <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    {group.name}
                  </p>
                  {group.items.map(({ hit, index }) => (
                    <button
                      key={`${hit.href}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      // onMouseDown thay vì onClick: onBlur của ô nhập chạy TRƯỚC onClick và
                      // đóng danh sách, làm cú bấm rơi vào khoảng trống.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        goTo(hit);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors ${
                        index === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <span className="truncate text-sm font-medium text-white">{hit.title}</span>
                      <span className="truncate text-xs text-zinc-500">{hit.subtitle}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-4">
        <div className="relative">
          <button
            type="button"
            onClick={openBell}
            aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
            aria-expanded={bellOpen}
            className="relative rounded-full p-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <BellIcon className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {bellOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-white/[0.08] bg-zinc-950 shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
                  <p className="text-sm font-bold">Thông báo</p>
                  <Link
                    href="/dashboard/readiness"
                    onClick={() => setBellOpen(false)}
                    className="text-xs font-semibold text-orange-400 hover:text-orange-300"
                  >
                    Kiểm tra vận hành
                  </Link>
                </div>
                {notifications.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-zinc-500">Chưa có thông báo nào.</p>
                ) : (
                  <ul className="max-h-[60vh] divide-y divide-white/[0.04] overflow-y-auto">
                    {notifications.map((n) => {
                      const content = (
                        <div className="flex gap-3 px-4 py-3">
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              n.severity === "high" ? "bg-red-500" : "bg-zinc-600"
                            }`}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">{n.title}</p>
                            {n.body && <p className="mt-0.5 text-xs text-zinc-400">{n.body}</p>}
                            <p className="mt-1 text-[11px] text-zinc-600">{relativeTime(n.createdAt)}</p>
                          </div>
                        </div>
                      );
                      return (
                        <li key={n.id}>
                          {n.href ? (
                            <Link
                              href={n.href}
                              onClick={() => setBellOpen(false)}
                              className="block transition-colors hover:bg-white/[0.04]"
                            >
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setMenuOpen((o) => !o);
              setBellOpen(false);
            }}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/[0.06]"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-sm font-bold">
              {initial}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-semibold">{fullName}</p>
              <p className="text-xs text-zinc-500">{roleLabel}</p>
            </div>
            <ChevronDownIcon className="h-4 w-4 text-zinc-500" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-white/[0.08] bg-zinc-950 p-1.5 shadow-xl">
                <Link
                  href="/doi-mat-khau"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.06]"
                >
                  Đổi mật khẩu
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
                >
                  Đăng xuất
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
