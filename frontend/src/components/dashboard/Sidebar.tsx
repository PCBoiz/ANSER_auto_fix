"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoltIcon,
  CalendarIcon,
  CarIcon,
  ChartIcon,
  ClipboardIcon,
  ClockIcon,
  HomeIcon,
  InboxIcon,
  PartIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldIcon,
  BranchIcon,
  StaffIcon,
  UsersIcon,
  WrenchIcon,
} from "@/components/dashboard/icons";
import type { UserFlow } from "@/lib/flow";

type NavItem = { label: string; icon: typeof HomeIcon; href: string | null };

// `href: null` = màn hình chưa dựng. Hiện mục nhưng khoá lại, thay vì giấu đi: người
// dùng cần thấy hệ thống sẽ có gì, và điều hướng tới trang 404 thì tệ hơn nút xám.
const MANAGER_NAV: NavItem[] = [
  { label: "Tổng quan", icon: HomeIcon, href: "/dashboard" },
  { label: "Lịch hẹn", icon: CalendarIcon, href: "/dashboard/appointments" },
  { label: "Lệnh sửa chữa", icon: ClipboardIcon, href: "/dashboard/orders" },
  { label: "Khách hàng", icon: UsersIcon, href: "/dashboard/customers" },
  { label: "Hồ sơ xe", icon: CarIcon, href: "/dashboard/vehicles" },
  { label: "Bảng giá dịch vụ", icon: WrenchIcon, href: "/dashboard/services" },
  { label: "Kho phụ tùng", icon: PartIcon, href: "/dashboard/parts" },
  { label: "Hoá đơn", icon: ReceiptIcon, href: "/dashboard/invoices" },
  { label: "Báo cáo", icon: ChartIcon, href: "/dashboard/reports" },
  { label: "Tự động hoá", icon: BoltIcon, href: "/dashboard/automation" },
  { label: "Chi nhánh", icon: BranchIcon, href: "/dashboard/branches" },
  { label: "Nhân sự", icon: StaffIcon, href: "/dashboard/staff" },
  { label: "Chấm công nhân sự", icon: ClockIcon, href: "/dashboard/staff-attendance" },
  { label: "Tài khoản", icon: UsersIcon, href: "/dashboard/accounts" },
  { label: "Cài đặt", icon: SettingsIcon, href: "/dashboard/settings" },
  { label: "Kiểm tra vận hành", icon: ShieldIcon, href: "/dashboard/readiness" },
];

// Kế toán: chỉ phần tính toán hoá đơn/doanh thu + tổng hợp giờ công để tính lương —
// không thấy vận hành xưởng (lệnh sửa chữa, kho, nhân sự...). Menu ở đây không phải hàng
// rào bảo mật cho invoices/reports (API vẫn cho requireUser() bất kỳ đọc), NHƯNG
// "Chấm công nhân sự" thì có chặn thật ở API (`requirePayrollViewer()`) — xem
// ARCHITECTURE.md §5.2, vì đây là dữ liệu giờ công của mọi người, không phải chỉ để tiện.
const ACCOUNTANT_NAV: NavItem[] = [
  { label: "Hoá đơn", icon: ReceiptIcon, href: "/dashboard/invoices" },
  { label: "Sổ bán hàng", icon: ReceiptIcon, href: "/dashboard/sales-ledger" },
  { label: "Sổ mua hàng", icon: ReceiptIcon, href: "/dashboard/purchase-ledger" },
  { label: "Báo cáo doanh thu", icon: ChartIcon, href: "/dashboard/reports" },
  { label: "Chấm công nhân sự", icon: ClockIcon, href: "/dashboard/staff-attendance" },
];

// KTV: đúng 3 việc được giao — chấm công, xem việc được phân, báo cáo công việc của
// chính mình. Không thấy giá cả/khách hàng/kho.
const TECHNICIAN_NAV: NavItem[] = [
  { label: "Chấm công", icon: ClockIcon, href: "/dashboard/attendance" },
  { label: "Khu vực nhận việc", icon: InboxIcon, href: "/dashboard/my-jobs" },
  { label: "Báo cáo công việc", icon: ChartIcon, href: "/dashboard/work-report" },
];

const NAV_BY_FLOW: Record<UserFlow, NavItem[]> = {
  manager: MANAGER_NAV,
  accountant: ACCOUNTANT_NAV,
  technician: TECHNICIAN_NAV,
};

const FLOW_LABELS: Record<UserFlow, string> = {
  manager: "Quản lý",
  accountant: "Kế toán",
  technician: "Kỹ thuật viên",
};

export default function Sidebar() {
  const pathname = usePathname();
  // Mặc định "manager" (menu đủ) trong lúc chờ /api/auth/me — flow thu hẹp chỉ áp dụng
  // sau khi biết chắc, tránh nháy menu đầy đủ rồi co lại gây hiểu lầm đang mất quyền.
  const [flow, setFlow] = useState<UserFlow>("manager");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.flow) setFlow(data.flow);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const navItems = NAV_BY_FLOW[flow];

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.08] bg-white/[0.02] p-4 sm:flex">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2 text-lg font-extrabold tracking-tight">
        <span className="bg-gradient-to-br from-orange-400 to-amber-300 bg-clip-text text-transparent">
          ▲
        </span>
        ANSER Auto
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const content = (
            <>
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </>
          );
          const active = item.href
            ? item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
            : false;

          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-gradient-to-r from-orange-600/20 to-amber-500/10 text-white"
                  : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              {content}
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              disabled
              className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-500"
              title="Sắp ra mắt"
            >
              {content}
            </button>
          );
        })}
      </nav>

      <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
        <p className="text-xs font-semibold text-zinc-300">ANSER Auto v0.1</p>
        <p className="mt-1 text-[11px] text-zinc-500">Luồng: {FLOW_LABELS[flow]}</p>
      </div>
    </aside>
  );
}
