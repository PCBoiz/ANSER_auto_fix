# Workflow n8n — ANSER Auto

17 workflow, import thủ công qua n8n UI (n8n không có API import dùng được ở đây — đúng cách
ANSER Flask và ANSER v2 cũng làm).

## Nhóm vận hành xưởng (7 workflow gốc)

| File | Trigger | Gọi vào Next.js | Gửi cho ai |
|---|---|---|---|
| `low_stock_alert.json` | Lịch, mỗi 6 giờ | `GET /api/n8n/internal/branches` → lặp từng chi nhánh → `GET /api/n8n/internal/low-stock?branchId=` | Email cảnh báo của **từng chi nhánh** |
| `maintenance_reminder.json` | Lịch, 8h mỗi ngày | `GET /api/n8n/internal/due-for-service?days=7&km=500` | **Khách hàng** (1 thư/xe) + bản tổng hợp cho gara |
| `appointment_reminder.json` | Lịch, 17h mỗi ngày | `GET /api/n8n/internal/appointments?hours=24` | **Khách hàng** (1 thư/lịch hẹn) + bảng phân công cho lễ tân |
| `order_status_update.json` | Webhook `POST /webhook/order-status` | — (Next.js tự gọi vào) | **Khách hàng** |
| `awaiting_acceptance_reminder.json` | Lịch, 9h mỗi ngày | `GET /api/n8n/internal/awaiting-acceptance?days=2` | **Khách hàng** (1 thư/lệnh, xe chờ nghiệm thu quá hạn) + bản tổng hợp cho gara |
| `unpaid_invoice_report.json` | Lịch, 9h mỗi ngày | `GET /api/n8n/internal/unpaid-invoices?days=7` | Chỉ **email doanh nghiệp** (quản lý/kế toán) — không gửi khách |
| `revenue_report.json` | Lịch, 20h mỗi ngày | `GET /api/n8n/internal/revenue?period=day` | Email doanh nghiệp |

## Nhóm Kế toán — đọc `sales_ledger`/`purchase_ledger` (sổ kế toán, không gắn lệnh sửa xe)

| File | Trigger | Gọi vào Next.js | Gửi cho ai |
|---|---|---|---|
| `purchase_pending_invoices_report.json` | Lịch, mỗi tuần 8h | `GET /api/n8n/internal/purchase-pending-invoices?days=14` | Email doanh nghiệp (Kế toán) |
| `sales_by_partner_report.json` | Lịch, ngày 1 mỗi tháng 9h | `GET /api/n8n/internal/sales-by-partner?period=month&limit=10` | Email doanh nghiệp (Kế toán → chủ xưởng đọc) |
| `sales_invoice_gap_report.json` | Lịch, mỗi tuần 9h | `GET /api/n8n/internal/sales-invoice-gap` | Email doanh nghiệp (Kế toán) |
| `purchase_payables_report.json` | Lịch, mỗi tuần 9h30 | `GET /api/n8n/internal/purchase-payables` | Email doanh nghiệp (Kế toán) |
| `vat_summary_report.json` | Lịch, ngày 1 mỗi tháng 9h | `GET /api/n8n/internal/vat-summary?period=month` | Email doanh nghiệp (Kế toán) |
| `ledger_anomalies_report.json` | Lịch, mỗi ngày 21h | `GET /api/n8n/internal/ledger-anomalies?days=1&multiplier=5` | Email doanh nghiệp (Kế toán) |

## Nhóm Quản lý xưởng — đọc `parts`/`part_transactions`/`purchase_ledger`

| File | Trigger | Gọi vào Next.js | Gửi cho ai |
|---|---|---|---|
| `parts_missing_price_report.json` | Lịch, mỗi tuần 10h | `GET /api/n8n/internal/parts-missing-price?limit=20` | Email doanh nghiệp (Quản lý) |
| `parts_missing_threshold_report.json` | Lịch, mỗi tuần 10h30 | `GET /api/n8n/internal/parts-missing-threshold?limit=20` | Email doanh nghiệp (Quản lý) |
| `supplier_activity_report.json` | Lịch, ngày 1 mỗi tháng 10h | `GET /api/n8n/internal/supplier-activity?newDays=30&staleDays=60` | Email doanh nghiệp (Quản lý) |
| `top_exported_parts_report.json` | Lịch, mỗi tuần 18h | `GET /api/n8n/internal/top-exported-parts?days=30&limit=10` | Email doanh nghiệp (Quản lý) |

Cả 10 workflow nhóm Kế toán/Quản lý dùng chung 1 địa chỉ nhận (`company_settings.email`, cột
`toEmail` trong node Gửi Email) — app hiện chưa có email riêng theo vai trò, chỉ có 1 email
doanh nghiệp chung. Việc tách "gửi cho ai" ở 2 bảng trên là **nội dung** báo cáo phục vụ đúng
vai trò đó, không phải định tuyến email kỹ thuật khác nhau. 10 workflow này KHÔNG có dòng
tương ứng trong bảng `automation_rules`/trang "Tự động hoá" — bật/tắt/sửa lịch làm trực tiếp
trong n8n UI, giống `unpaid_invoice_report.json` và `awaiting_acceptance_reminder.json`.

3 workflow nhắc khách (`maintenance_reminder`, `appointment_reminder`,
`awaiting_acceptance_reminder`) đều có **nhánh thứ hai gửi bản tổng hợp cho gara**, trong đó
cột "Liên hệ" chỉ rõ khách nào không có email. Khách thiếu email thì thư tự động không tới
được — để nó im lặng biến mất là cách chắc chắn nhất để mất lịch hẹn mà không ai biết vì sao.

`unpaid_invoice_report.json` **cố tình không có nhánh gửi khách** — nhắc nợ qua email tự động
dễ sai giọng văn với từng khách (nghe như đòi nợ), nên chỉ báo nội bộ cho quản lý xem rồi tự
quyết cách nhắc (gọi điện, nhắn riêng), giống cách `revenue_report` chỉ gửi 1 email nội bộ.

## 1. Chạy n8n

```bash
cd frontend
docker compose up -d
```

- n8n UI: http://localhost:5681
- MailHog (xem "email đã gửi", không gửi thật): http://localhost:8027

## 2. Cấu hình một lần

**a. Credential SMTP** — n8n UI → Credentials → New → *SMTP*: host `mailhog`, port `1025`,
bỏ trống user/password, tắt SSL/TLS. Gán credential này vào node **Gửi Email** của từng
workflow sau khi import (n8n không tự gán được vì credential là dữ liệu riêng của mỗi máy).

**b. Token nội bộ** — sinh một chuỗi ngẫu nhiên, đặt vào `frontend/.env.local`:

```
N8N_INTERNAL_TOKEN=<chuỗi ngẫu nhiên dài>
```

rồi thay `REPLACE_WITH_N8N_INTERNAL_TOKEN` trong **mọi node HTTP Request** của các workflow
bằng đúng chuỗi đó.

> Các endpoint `/api/n8n/internal/*` trả về tên, SĐT và email khách hàng. Không có token thì
> bất kỳ ai chạm được tới server đều đọc sạch. Ở `NODE_ENV=development`, biến này để trống
> vẫn chạy được (import xong là dùng ngay trên máy); ở **production, thiếu token thì endpoint
> trả 503** — thiếu cấu hình phải nổ ra chứ không được âm thầm thành endpoint công khai.

**c. n8n API key** (chỉ cần nếu muốn bật/tắt workflow từ trong app) — n8n UI →
Settings → n8n API → Create an API key, dán vào `N8N_API_KEY` trong `.env.local`.

## 3. Import

n8n UI → Workflows → **Import from File** → chọn từng file `.json` trong thư mục này.
Sau khi import: gán credential SMTP cho node Gửi Email, thay token, rồi bật **Active**.

## 4. Địa chỉ Next.js trong workflow

Các node HTTP Request trỏ tới `http://host.docker.internal:3000` — địa chỉ để container n8n
gọi ngược ra Next.js đang chạy trên máy host. Khi deploy chung một Docker Compose với Next.js,
đổi thành tên service (vd `http://web:3000`).

## 5. Báo cáo doanh thu tuần/tháng

Endpoint đã nhận `period=week|month`. Để có bản tuần/tháng: nhân bản `revenue_report.json`
trong n8n UI rồi sửa 2 chỗ — `period=day` trong URL, và lịch chạy ở node trigger. Không tách
sẵn thành 3 file vì 1 quy tắc tự động hoá trong app chỉ theo dõi được 1 workflow ID.

## 6. Chiều ngược lại: Next.js → n8n

`order_status_update.json` chờ webhook từ app. Phía app, hàm gọi là
`notifyOrderStatusChanged()` trong [`src/server/n8n.ts`](../src/server/n8n.ts) — được gọi
trong `PATCH /api/service-orders/[id]` **sau khi** transaction đổi trạng thái đã commit, không
gọi bên trong: webhook chậm hoặc lỗi không được giữ transaction mở hay làm rollback việc đã xong.

Hàm chỉ báo ở 3 mốc khách thực sự quan tâm: `quoted`, `awaiting_acceptance` (xe sửa xong, mời
khách tới nghiệm thu — **không phải** `completed`, mốc đó chỉ có nghĩa xưởng đã xong việc kỹ
thuật, khách chưa được mời), và `delivered`. Báo mọi lần đổi trạng thái là cách nhanh nhất để
khách đánh dấu email của gara là spam.

## 7. Xem/tải mẫu ngay trong app

Trang **Tự động hoá** trong app có nút "Xem mẫu n8n" ở mỗi quy tắc — mở xem nội dung JSON và
tải file trực tiếp, không cần vào thư mục này bằng tay. File phục vụ tại
`public/n8n-templates/*.json` là bản sinh tự động từ thư mục này (script
`scripts/sync-n8n-templates.mjs`, chạy tự động trước `npm run dev` / `npm run build`) — **sửa
nội dung workflow thì luôn sửa file trong `n8n-workflows/`**, không sửa trực tiếp trong
`public/`, sẽ bị ghi đè ở lần chạy `dev`/`build` kế tiếp.
