"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PlusIcon, TrashIcon } from "@/components/dashboard/icons";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import { needsDiscountApproval } from "@/lib/revenueGuard";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  GhostButton,
  PrimaryButton,
  TableWrap,
  formatDateTime,
  formatVnd,
} from "@/components/ui/PageShell";

const STATUS_FLOW = [
  "received",
  "diagnosing",
  "quoted",
  "approved",
  "in_progress",
  "completed",
  "awaiting_acceptance",
  "delivered",
] as const;

const STATUS_LABELS: Record<string, string> = {
  received: "Đã tiếp nhận",
  diagnosing: "Đang chẩn đoán",
  quoted: "Đã báo giá",
  approved: "Khách đã duyệt",
  in_progress: "Đang sửa chữa",
  completed: "Hoàn tất sửa chữa",
  awaiting_acceptance: "Chờ nghiệm thu",
  delivered: "Đã giao xe",
  cancelled: "Đã huỷ",
};

// Ba mốc này gửi email cho khách (xem notifyOrderStatusChanged) — nói trước để người bấm
// biết mình sắp gửi thư, không phát hiện sau khi khách gọi lại hỏi.
const NOTIFYING_STATUSES = ["quoted", "awaiting_acceptance", "delivered"];

const LABOR_STATUS_LABELS: Record<string, string> = {
  pending: "Chờ làm",
  in_progress: "Đang làm",
  done: "Xong",
};

const SPECIAL_STATUS_LABELS: Record<string, string> = {
  ordered: "Đang chờ hàng",
  arrived: "Đã về hàng",
  billed: "Đã tính vào hoá đơn",
  cancelled: "Đã huỷ",
};
const SPECIAL_STATUS_TONES: Record<string, "orange" | "sky" | "emerald" | "zinc"> = {
  ordered: "orange",
  arrived: "sky",
  billed: "emerald",
  cancelled: "zinc",
};

type Detail = {
  order: {
    id: string;
    code: string;
    status: string;
    plateSnapshot: string;
    odometerIn: number | null;
    customerComplaint: string | null;
    diagnosis: string | null;
    receivedAt: string;
    promisedAt: string | null;
    laborTotal: number;
    partsTotal: number;
    discount: number;
    discountApprovedAmount: number | null;
    total: number;
    note: string | null;
    advisorId: string | null;
  };
  vehicle: { licensePlate: string; make: string; model: string; year: number | null } | null;
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  branch: { id: string; name: string } | null;
  labors: Array<{
    id: string;
    name: string;
    branchId: string | null;
    branchName: string | null;
    technicianId: string | null;
    technicianName: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    standardMinutes: number | null;
    status: string;
  }>;
  parts: Array<{
    id: string;
    name: string;
    unit: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  specialOrders: Array<{
    id: string;
    name: string;
    supplier: string | null;
    unit: string;
    quantity: number;
    estimatedCost: number | null;
    actualCost: number | null;
    sellPrice: number | null;
    status: string;
    note: string | null;
  }>;
};

const EMPTY_SPECIAL_FORM = {
  name: "",
  supplier: "",
  unit: "Cái",
  quantity: "1",
  estimatedCost: 0,
  note: "",
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cảnh báo không chặn (vd vừa thêm dòng 0đ) — khác `error`: thao tác ĐÃ thành công.
  const [notice, setNotice] = useState<string | null>(null);

  const [services, setServices] = useState<Array<{ id: string; name: string; laborPrice: number; standardMinutes: number }>>([]);
  const [parts, setParts] = useState<Array<{ id: string; code: string; name: string; price: number; stock: number; unit: string; branchId: string }>>([]);
  const [technicians, setTechnicians] = useState<Array<{ id: string; name: string; position: string | null }>>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

  const [laborModal, setLaborModal] = useState(false);
  const [laborForm, setLaborForm] = useState({ serviceId: "", name: "", unitPrice: 0, quantity: "1", technicianId: "", branchId: "" });
  const [partModal, setPartModal] = useState(false);
  const [partForm, setPartForm] = useState({ partId: "", quantity: "1" });
  const [discountModal, setDiscountModal] = useState(false);
  const [discountValue, setDiscountValue] = useState(0);

  const [specialModal, setSpecialModal] = useState(false);
  const [specialForm, setSpecialForm] = useState(EMPTY_SPECIAL_FORM);
  // Modal dùng chung cho 2 hành động ghi tiền của phụ tùng đặt ngoài: đánh dấu đã về hàng
  // (nhập giá vốn thật) và tính vào hoá đơn (nhập giá bán) — cùng hình dạng, khác đích gọi.
  const [specialActionTarget, setSpecialActionTarget] = useState<{
    mode: "arrive" | "bill";
    id: string;
    label: string;
  } | null>(null);
  const [specialActionAmount, setSpecialActionAmount] = useState(0);
  const [cancelingSpecial, setCancelingSpecial] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/service-orders/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Không tải được lệnh.");
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Nạp lần đầu bằng chuỗi .then thay vì gọi hàm async trong thân effect: setState nằm
  // trong callback (đúng khuyến nghị của React), và cờ `cancelled` chặn việc ghi state
  // khi response về sau lúc component đã rời màn hình.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/service-orders/${id}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) setDetail(data);
        else setError(data?.message ?? "Không tải được lệnh.");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Không tải được lệnh.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    Promise.all([
      fetch("/api/services?activeOnly=1").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/parts").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/employees?activeOnly=1").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/branches").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([s, p, e, b]) => {
        if (s) setServices(s.services);
        if (p) setParts(p.parts);
        if (e) setTechnicians(e.employees);
        if (b) setBranches(b.branches);
      })
      .catch(() => {});
  }, []);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Thao tác thất bại.");
      await load();
      setError(null);
      setNotice(data?.warning ?? null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: string) {
    await call(`/api/service-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function submitLabor(e: FormEvent) {
    e.preventDefault();
    const ok = await call(`/api/service-orders/${id}/labors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...laborForm, quantity: Number(laborForm.quantity) }),
    });
    if (ok) setLaborModal(false);
  }

  async function submitPart(e: FormEvent) {
    e.preventDefault();
    const ok = await call(`/api/service-orders/${id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...partForm, quantity: Number(partForm.quantity) }),
    });
    if (ok) setPartModal(false);
  }

  async function submitDiscount(e: FormEvent) {
    e.preventDefault();
    const ok = await call(`/api/service-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discount: discountValue }),
    });
    if (ok) setDiscountModal(false);
  }

  async function approveDiscount() {
    await call(`/api/service-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approveDiscount: true }),
    });
  }

  async function submitSpecial(e: FormEvent) {
    e.preventDefault();
    const ok = await call(`/api/service-orders/${id}/special-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...specialForm, quantity: Number(specialForm.quantity) }),
    });
    if (ok) {
      setSpecialModal(false);
      setSpecialForm(EMPTY_SPECIAL_FORM);
    }
  }

  async function submitSpecialAction(e: FormEvent) {
    e.preventDefault();
    if (!specialActionTarget) return;
    const ok =
      specialActionTarget.mode === "arrive"
        ? await call(`/api/service-orders/${id}/special-orders/${specialActionTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "arrived", actualCost: specialActionAmount }),
          })
        : await call(`/api/service-orders/${id}/special-orders/${specialActionTarget.id}/bill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sellPrice: specialActionAmount }),
          });
    if (ok) setSpecialActionTarget(null);
  }

  async function confirmCancelSpecial() {
    if (!cancelingSpecial) return;
    const ok = await call(`/api/service-orders/${id}/special-orders/${cancelingSpecial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (ok) setCancelingSpecial(null);
  }

  function pickService(serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    setLaborForm((prev) => ({
      ...prev,
      serviceId,
      name: service?.name ?? prev.name,
      unitPrice: service?.laborPrice ?? prev.unitPrice,
    }));
  }

  if (loading) return <EmptyState title="Đang tải..." />;
  if (!detail) {
    return (
      <div>
        <ErrorBanner message={error ?? "Không tìm thấy lệnh sửa chữa."} />
        <Link href="/dashboard/orders" className="text-sm text-orange-400 hover:underline">
          ← Về danh sách lệnh
        </Link>
      </div>
    );
  }

  const { order, vehicle, customer, branch, labors, specialOrders } = detail;
  const locked = order.status === "delivered" || order.status === "cancelled";
  const currentIndex = STATUS_FLOW.indexOf(order.status as (typeof STATUS_FLOW)[number]);
  const nextStatus = currentIndex >= 0 && currentIndex < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIndex + 1] : null;
  // Đúng 1 bước lùi được thiết kế: khách chưa đồng ý lúc nghiệm thu thì quay lại sửa tiếp.
  const canRevertToInProgress = order.status === "awaiting_acceptance";

  // Phụ tùng chỉ hiện của đúng chi nhánh lệnh — kho từng chi nhánh độc lập, cho chọn chéo
  // rồi báo lỗi sau khi bấm là bắt người dùng đoán.
  const branchParts = parts.filter((p) => p.branchId === branch?.id);
  // Chỉ hiện cột "Xưởng thực hiện" khi gara có từ 2 xưởng trở lên — 1 xưởng thì cột này
  // không mang thông tin gì, chỉ chiếm chỗ.
  const showLaborBranch = branches.length > 1;

  return (
    <div>
      <Link href="/dashboard/orders" className="mb-4 inline-block text-sm text-zinc-400 hover:text-white">
        ← Danh sách lệnh
      </Link>

      <ErrorBanner message={error} />
      {notice && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {notice}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{order.code}</h1>
            <Badge tone={locked ? "emerald" : "orange"}>{STATUS_LABELS[order.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            <span className="font-mono">{order.plateSnapshot}</span>
            {vehicle && ` · ${vehicle.make} ${vehicle.model}`}
            {customer && ` · ${customer.name}`}
            {branch && ` · Tiếp nhận tại ${branch.name}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRevertToInProgress && (
            <GhostButton onClick={() => changeStatus("in_progress")} disabled={busy}>
              ← Khách chưa đồng ý, sửa tiếp
            </GhostButton>
          )}
          {nextStatus && !locked && (
            <PrimaryButton onClick={() => changeStatus(nextStatus)} disabled={busy}>
              → {STATUS_LABELS[nextStatus]}
            </PrimaryButton>
          )}
          {!locked && (
            <GhostButton onClick={() => changeStatus("cancelled")} disabled={busy}>
              Huỷ lệnh
            </GhostButton>
          )}
          {order.status === "delivered" && (
            <PrimaryButton onClick={() => router.push(`/dashboard/invoices?orderId=${order.id}`)}>
              Xuất hoá đơn
            </PrimaryButton>
          )}
        </div>
      </div>

      {nextStatus && NOTIFYING_STATUSES.includes(nextStatus) && !locked && (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200">
          Chuyển sang &ldquo;{STATUS_LABELS[nextStatus]}&rdquo; sẽ gửi email báo cho khách
          {customer?.email ? ` (${customer.email})` : " — nhưng khách này chưa có email nên sẽ bỏ qua"}.
        </div>
      )}
      {canRevertToInProgress && (
        <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-sm text-orange-200">
          Xe đang chờ khách nghiệm thu. Nếu khách phát hiện lỗi hoặc yêu cầu làm lại, bấm
          &ldquo;Khách chưa đồng ý&rdquo; để quay lại sửa chữa — dòng công/phụ tùng đã có vẫn giữ nguyên.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
              <h2 className="text-sm font-bold">Hạng mục công việc</h2>
              {!locked && (
                <button
                  onClick={() => {
                    setLaborForm({ serviceId: "", name: "", unitPrice: 0, quantity: "1", technicianId: "", branchId: branch?.id ?? "" });
                    setLaborModal(true);
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-orange-400 hover:bg-orange-500/10"
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Thêm
                </button>
              )}
            </div>
            {labors.length === 0 ? (
              <EmptyState title="Chưa có hạng mục nào." />
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                    <tr>
                      <th className="px-5 py-2 font-semibold">Hạng mục</th>
                      {showLaborBranch && <th className="px-5 py-2 font-semibold">Xưởng</th>}
                      <th className="px-5 py-2 font-semibold">Kỹ thuật viên</th>
                      <th className="px-5 py-2 font-semibold">Tiến độ</th>
                      <th className="px-5 py-2 text-right font-semibold">SL</th>
                      <th className="px-5 py-2 text-right font-semibold">Đơn giá</th>
                      <th className="px-5 py-2 text-right font-semibold">Thành tiền</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {labors.map((l) => (
                      <tr key={l.id} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-5 py-2">{l.name}</td>
                        {showLaborBranch && (
                          <td className="px-5 py-2">
                            <select
                              value={l.branchId ?? ""}
                              disabled={locked || busy}
                              onChange={(e) =>
                                call(`/api/service-orders/${id}/labors/${l.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ branchId: e.target.value || null }),
                                })
                              }
                              className="rounded-lg border border-white/[0.08] bg-black/40 px-2 py-1 text-xs text-white outline-none disabled:opacity-50 [&>option]:bg-zinc-900"
                            >
                              <option value="">—</option>
                              {branches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        )}
                        <td className="px-5 py-2">
                          <select
                            value={l.technicianId ?? ""}
                            disabled={locked || busy}
                            onChange={(e) =>
                              call(`/api/service-orders/${id}/labors/${l.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ technicianId: e.target.value || null }),
                              })
                            }
                            className="rounded-lg border border-white/[0.08] bg-black/40 px-2 py-1 text-xs text-white outline-none disabled:opacity-50 [&>option]:bg-zinc-900"
                          >
                            <option value="">—</option>
                            {technicians.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-2">
                          <select
                            value={l.status}
                            disabled={locked || busy}
                            onChange={(e) =>
                              call(`/api/service-orders/${id}/labors/${l.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: e.target.value }),
                              })
                            }
                            className="rounded-lg border border-white/[0.08] bg-black/40 px-2 py-1 text-xs text-white outline-none disabled:opacity-50 [&>option]:bg-zinc-900"
                          >
                            {Object.entries(LABOR_STATUS_LABELS).map(([v, label]) => (
                              <option key={v} value={v}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-2 text-right">{l.quantity}</td>
                        <td className={`px-5 py-2 text-right ${l.unitPrice === 0 ? "font-semibold text-red-400" : "text-zinc-400"}`}>
                          {formatVnd(l.unitPrice)}
                        </td>
                        <td className="px-5 py-2 text-right font-semibold">{formatVnd(l.lineTotal)}</td>
                        <td className="px-5 py-2">
                          {!locked && (
                            <button
                              onClick={() =>
                                call(`/api/service-orders/${id}/labors/${l.id}`, { method: "DELETE" })
                              }
                              disabled={busy}
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
              <h2 className="text-sm font-bold">Phụ tùng sử dụng</h2>
              {!locked && (
                <button
                  onClick={() => {
                    setPartForm({ partId: branchParts[0]?.id ?? "", quantity: "1" });
                    setPartModal(true);
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-orange-400 hover:bg-orange-500/10"
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Thêm
                </button>
              )}
            </div>
            {detail.parts.length === 0 ? (
              <EmptyState
                title="Chưa dùng phụ tùng nào."
                hint="Thêm phụ tùng ở đây sẽ tự trừ tồn kho và ghi phiếu xuất gắn với lệnh này."
              />
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                    <tr>
                      <th className="px-5 py-2 font-semibold">Phụ tùng</th>
                      <th className="px-5 py-2 text-right font-semibold">SL</th>
                      <th className="px-5 py-2 text-right font-semibold">Đơn giá</th>
                      <th className="px-5 py-2 text-right font-semibold">Thành tiền</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.parts.map((p) => (
                      <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-5 py-2">{p.name}</td>
                        <td className="px-5 py-2 text-right">
                          {p.quantity} {p.unit}
                        </td>
                        <td className={`px-5 py-2 text-right ${p.unitPrice === 0 ? "font-semibold text-red-400" : "text-zinc-400"}`}>
                          {formatVnd(p.unitPrice)}
                        </td>
                        <td className="px-5 py-2 text-right font-semibold">{formatVnd(p.lineTotal)}</td>
                        <td className="px-5 py-2">
                          {!locked && (
                            <button
                              onClick={() =>
                                call(`/api/service-orders/${id}/parts/${p.id}`, { method: "DELETE" })
                              }
                              disabled={busy}
                              title="Bỏ khỏi lệnh và trả lại kho"
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
              <div>
                <h2 className="text-sm font-bold">Đặt hàng ngoài</h2>
                <p className="text-xs text-zinc-500">
                  Phụ tùng gara không có sẵn, phải mua riêng cho lệnh này — khác phụ tùng lấy
                  từ kho ở trên.
                </p>
              </div>
              {!locked && (
                <button
                  onClick={() => {
                    setSpecialForm(EMPTY_SPECIAL_FORM);
                    setSpecialModal(true);
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-orange-400 hover:bg-orange-500/10"
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Đặt hàng
                </button>
              )}
            </div>
            {specialOrders.length === 0 ? (
              <EmptyState title="Chưa đặt phụ tùng nào từ ngoài." />
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="border-b border-white/[0.08] text-left text-xs text-zinc-400">
                    <tr>
                      <th className="px-5 py-2 font-semibold">Phụ tùng</th>
                      <th className="px-5 py-2 font-semibold">Nhà cung cấp</th>
                      <th className="px-5 py-2 text-right font-semibold">SL</th>
                      <th className="px-5 py-2 text-right font-semibold">Giá</th>
                      <th className="px-5 py-2 font-semibold">Trạng thái</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {specialOrders.map((s) => (
                      <tr key={s.id} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-5 py-2">{s.name}</td>
                        <td className="px-5 py-2 text-zinc-400">{s.supplier ?? "—"}</td>
                        <td className="px-5 py-2 text-right">
                          {s.quantity} {s.unit}
                        </td>
                        <td className="px-5 py-2 text-right text-zinc-400">
                          {s.status === "ordered"
                            ? s.estimatedCost
                              ? `~${formatVnd(s.estimatedCost)}`
                              : "chưa rõ giá"
                            : s.status === "arrived"
                              ? formatVnd(s.actualCost)
                              : formatVnd(s.sellPrice)}
                        </td>
                        <td className="px-5 py-2">
                          <Badge tone={SPECIAL_STATUS_TONES[s.status]}>
                            {SPECIAL_STATUS_LABELS[s.status]}
                          </Badge>
                        </td>
                        <td className="px-5 py-2">
                          <div className="flex justify-end gap-1 whitespace-nowrap">
                            {s.status === "ordered" && !locked && (
                              <>
                                <button
                                  onClick={() => {
                                    setSpecialActionTarget({ mode: "arrive", id: s.id, label: s.name });
                                    setSpecialActionAmount(s.estimatedCost ?? 0);
                                  }}
                                  className="rounded-lg px-2 py-1 text-xs font-semibold text-sky-400 hover:bg-sky-500/10"
                                >
                                  Đã về hàng
                                </button>
                                <button
                                  onClick={() => setCancelingSpecial({ id: s.id, name: s.name })}
                                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            {s.status === "arrived" && !locked && (
                              <button
                                onClick={() => {
                                  setSpecialActionTarget({ mode: "bill", id: s.id, label: s.name });
                                  setSpecialActionAmount(s.actualCost ?? 0);
                                }}
                                className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10"
                              >
                                Tính vào hoá đơn
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-bold">Thanh toán</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Tiền công</dt>
                <dd>{formatVnd(order.laborTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Phụ tùng</dt>
                <dd>{formatVnd(order.partsTotal)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-400">Giảm giá</dt>
                <dd className="flex items-center gap-2">
                  {formatVnd(order.discount)}
                  {!locked && (
                    <button
                      onClick={() => {
                        setDiscountValue(order.discount);
                        setDiscountModal(true);
                      }}
                      className="text-xs text-orange-400 hover:underline"
                    >
                      sửa
                    </button>
                  )}
                </dd>
              </div>
              {!locked &&
                needsDiscountApproval({
                  subtotal: order.laborTotal + order.partsTotal,
                  discount: order.discount,
                  discountApprovedAmount: order.discountApprovedAmount,
                }) && (
                  // Giảm giá lớn do nhân viên đặt (hoặc bị sửa sau khi đã duyệt) — xem lib/revenueGuard.ts.
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs">
                    <span className="text-amber-200">Giảm giá lớn — chờ quản lý duyệt</span>
                    <button
                      onClick={approveDiscount}
                      disabled={busy}
                      className="shrink-0 font-semibold whitespace-nowrap text-amber-300 hover:underline disabled:opacity-50"
                    >
                      Duyệt
                    </button>
                  </div>
                )}
              <div className="mt-2 flex justify-between border-t border-white/[0.08] pt-2 text-base font-bold">
                <dt>Tổng cộng</dt>
                <dd>{formatVnd(order.total)}</dd>
              </div>
            </dl>
            {specialOrders.some((s) => s.status === "ordered" || s.status === "arrived") && (
              <p className="mt-3 text-[11px] text-zinc-500">
                Còn phụ tùng đặt ngoài chưa tính vào hoá đơn — xem mục &ldquo;Đặt hàng
                ngoài&rdquo; bên trên.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-bold">Thông tin tiếp nhận</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">Ngày vào xưởng</dt>
                <dd>{formatDateTime(order.receivedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Hẹn trả xe</dt>
                <dd>{order.promisedAt ? formatDateTime(order.promisedAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Số km lúc vào</dt>
                <dd>{order.odometerIn ? order.odometerIn.toLocaleString("vi-VN") : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Khách báo</dt>
                <dd className="text-zinc-300">{order.customerComplaint ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Chẩn đoán của xưởng</dt>
                <dd>
                  <textarea
                    defaultValue={order.diagnosis ?? ""}
                    disabled={locked}
                    onBlur={(e) =>
                      e.target.value !== (order.diagnosis ?? "") &&
                      call(`/api/service-orders/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ diagnosis: e.target.value }),
                      })
                    }
                    placeholder="Ghi kết quả kiểm tra..."
                    className="mt-1 min-h-20 w-full resize-y rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500 disabled:opacity-50"
                  />
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {laborModal && (
        <Modal
          title="Thêm hạng mục công việc"
          onClose={() => setLaborModal(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setLaborModal(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="labor-form" disabled={busy}>
                Thêm
              </PrimaryButton>
            </>
          }
        >
          <form id="labor-form" onSubmit={submitLabor} className="flex flex-col gap-4">
            <SelectField
              label="Chọn từ bảng giá"
              hint="hoặc để trống và tự nhập bên dưới"
              value={laborForm.serviceId}
              onChange={(e) => pickService(e.target.value)}
            >
              <option value="">— Tự nhập —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatVnd(s.laborPrice)})
                </option>
              ))}
            </SelectField>
            <TextField
              label="Tên hạng mục"
              required
              value={laborForm.name}
              onChange={(e) => setLaborForm((p) => ({ ...p, name: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-4">
              <MoneyField
                label="Đơn giá công"
                value={laborForm.unitPrice}
                onValueChange={(v) => setLaborForm((p) => ({ ...p, unitPrice: v }))}
              />
              <TextField
                label="Số lượng"
                type="number"
                min={1}
                value={laborForm.quantity}
                onChange={(e) => setLaborForm((p) => ({ ...p, quantity: e.target.value }))}
              />
            </div>
            {showLaborBranch && (
              <SelectField
                label="Xưởng thực hiện"
                hint="xe cần cả 2 xưởng thì mỗi dòng công gán riêng"
                value={laborForm.branchId}
                onChange={(e) => setLaborForm((p) => ({ ...p, branchId: e.target.value }))}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </SelectField>
            )}
            <SelectField
              label="Giao cho kỹ thuật viên"
              value={laborForm.technicianId}
              onChange={(e) => setLaborForm((p) => ({ ...p, technicianId: e.target.value }))}
            >
              <option value="">— Chưa giao —</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.position ? `(${t.position})` : ""}
                </option>
              ))}
            </SelectField>
          </form>
        </Modal>
      )}

      {partModal && (
        <Modal
          title="Thêm phụ tùng"
          onClose={() => setPartModal(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setPartModal(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="part-line-form" disabled={busy}>
                Thêm
              </PrimaryButton>
            </>
          }
        >
          <form id="part-line-form" onSubmit={submitPart} className="flex flex-col gap-4">
            {branchParts.length === 0 ? (
              <p className="text-sm text-orange-300">
                Chi nhánh {branch?.name} chưa có phụ tùng nào trong kho. Nếu phụ tùng cần dùng
                không có sẵn, đặt ở mục &ldquo;Đặt hàng ngoài&rdquo; thay vì ở đây.
              </p>
            ) : (
              <>
                <SelectField
                  label="Phụ tùng"
                  required
                  value={partForm.partId}
                  onChange={(e) => setPartForm((p) => ({ ...p, partId: e.target.value }))}
                >
                  {branchParts.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.stock === 0}>
                      {p.code} — {p.name} (tồn {p.stock} {p.unit}) {formatVnd(p.price)}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Số lượng"
                  type="number"
                  min={1}
                  required
                  value={partForm.quantity}
                  onChange={(e) => setPartForm((p) => ({ ...p, quantity: e.target.value }))}
                />
                <p className="text-xs text-zinc-500">
                  Thêm vào đây sẽ trừ tồn kho và ghi một phiếu xuất gắn với lệnh này ngay lập tức.
                </p>
              </>
            )}
          </form>
        </Modal>
      )}

      {discountModal && (
        <Modal
          title="Giảm giá"
          onClose={() => setDiscountModal(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setDiscountModal(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="discount-form" disabled={busy}>
                Lưu
              </PrimaryButton>
            </>
          }
        >
          <form id="discount-form" onSubmit={submitDiscount}>
            <MoneyField
              label="Số tiền giảm"
              hint={`tổng trước giảm: ${formatVnd(order.laborTotal + order.partsTotal)}`}
              value={discountValue}
              onValueChange={setDiscountValue}
            />
          </form>
        </Modal>
      )}

      {specialModal && (
        <Modal
          title="Đặt hàng ngoài"
          onClose={() => setSpecialModal(false)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setSpecialModal(false)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="special-form" disabled={busy}>
                Ghi nhận
              </PrimaryButton>
            </>
          }
        >
          <form id="special-form" onSubmit={submitSpecial} className="flex flex-col gap-4">
            <TextField
              label="Tên phụ tùng"
              required
              value={specialForm.name}
              onChange={(e) => setSpecialForm((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Nhà cung cấp"
              value={specialForm.supplier}
              onChange={(e) => setSpecialForm((p) => ({ ...p, supplier: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Đơn vị"
                value={specialForm.unit}
                onChange={(e) => setSpecialForm((p) => ({ ...p, unit: e.target.value }))}
              />
              <TextField
                label="Số lượng"
                type="number"
                min={1}
                value={specialForm.quantity}
                onChange={(e) => setSpecialForm((p) => ({ ...p, quantity: e.target.value }))}
              />
            </div>
            <MoneyField
              label="Giá dự kiến"
              hint="để 0 nếu chưa báo giá — chưa tính vào tổng lệnh lúc này"
              value={specialForm.estimatedCost}
              onValueChange={(v) => setSpecialForm((p) => ({ ...p, estimatedCost: v }))}
            />
            <TextAreaField
              label="Ghi chú"
              value={specialForm.note}
              onChange={(e) => setSpecialForm((p) => ({ ...p, note: e.target.value }))}
            />
            <p className="text-xs text-zinc-500">
              Khoản này chưa tính vào tổng tiền lệnh. Khi hàng về, đánh dấu &ldquo;Đã về
              hàng&rdquo; rồi &ldquo;Tính vào hoá đơn&rdquo; để chốt giá bán cho khách.
            </p>
          </form>
        </Modal>
      )}

      {specialActionTarget && (
        <Modal
          title={specialActionTarget.mode === "arrive" ? "Đã về hàng" : "Tính vào hoá đơn"}
          onClose={() => setSpecialActionTarget(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setSpecialActionTarget(null)}>
                Huỷ
              </GhostButton>
              <PrimaryButton type="submit" form="special-action-form" disabled={busy}>
                Xác nhận
              </PrimaryButton>
            </>
          }
        >
          <form id="special-action-form" onSubmit={submitSpecialAction} className="flex flex-col gap-4">
            <p className="text-sm text-zinc-300">{specialActionTarget.label}</p>
            <MoneyField
              label={specialActionTarget.mode === "arrive" ? "Giá vốn thật" : "Giá bán cho khách"}
              hint={
                specialActionTarget.mode === "arrive"
                  ? "giá thật khi nhận hàng, có thể khác giá dự kiến"
                  : "cộng vào tổng tiền lệnh ngay khi xác nhận"
              }
              value={specialActionAmount}
              onValueChange={setSpecialActionAmount}
            />
          </form>
        </Modal>
      )}

      {cancelingSpecial && (
        <Modal
          title="Huỷ khoản đặt hàng ngoài"
          onClose={() => setCancelingSpecial(null)}
          footer={
            <>
              <GhostButton type="button" onClick={() => setCancelingSpecial(null)}>
                Đóng
              </GhostButton>
              <PrimaryButton onClick={confirmCancelSpecial} disabled={busy}>
                Huỷ khoản này
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-zinc-300">
            Huỷ đặt hàng <b>{cancelingSpecial.name}</b>? Khoản này chưa tính vào hoá đơn nên
            huỷ không ảnh hưởng tới tổng tiền lệnh.
          </p>
        </Modal>
      )}
    </div>
  );
}
