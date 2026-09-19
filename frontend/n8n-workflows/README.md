# Workflow n8n — ANSER Auto

10 workflow (9 nghiệp vụ + canh gác app). **Từ 18/09/2026 app tự đẩy chúng lên n8n** qua n8n
Public API — xem §0.1. Import tay vẫn làm được nhưng không còn cần.

| File | Trigger | Gọi vào Next.js | Gửi cho ai |
|---|---|---|---|
| `morning_brief.json` **(mới)** | Lịch, 7h mỗi ngày | `GET /api/n8n/internal/morning-brief` | Email doanh nghiệp — **một** bản tin gộp mọi việc trong ngày |
| `accounting_digest.json` **(mới)** | Lịch, 8h thứ Hai | `GET /api/n8n/internal/accounting-digest` | Email doanh nghiệp — tổng hợp tuần cho kế toán |
| `low_stock_alert.json` | Lịch, mỗi 6 giờ | `GET /internal/branches` → lặp từng chi nhánh → `GET /internal/low-stock?branchId=&limit=30` | Email cảnh báo của **từng chi nhánh** |
| `maintenance_reminder.json` | Lịch, 8h mỗi ngày | `GET /api/n8n/internal/due-for-service` | **Khách hàng** (1 thư/xe) + bản tổng hợp cho gara |
| `appointment_reminder.json` | Lịch, 17h mỗi ngày | `GET /api/n8n/internal/appointments` | **Khách hàng** (1 thư/lịch hẹn) + bảng phân công cho lễ tân |
| `order_status_update.json` | Webhook `POST /webhook/order-status` | — (Next.js tự gọi vào) | **Khách hàng** |
| `awaiting_acceptance_reminder.json` | Lịch, 9h mỗi ngày | `GET /api/n8n/internal/awaiting-acceptance` | **Khách hàng** (1 thư/lệnh) + bản tổng hợp cho gara |
| `unpaid_invoice_report.json` | Lịch, 9h mỗi ngày | `GET /api/n8n/internal/unpaid-invoices` | Chỉ **email doanh nghiệp** — không gửi khách |
| `revenue_report.json` | Lịch, 20h mỗi ngày | `GET /api/n8n/internal/revenue?period=day` | Email doanh nghiệp |
| `owner_weekly_report.json` **(mới 20/09)** | Lịch, 8h thứ Hai | `GET /api/n8n/internal/owner-weekly` | Email doanh nghiệp — báo cáo tuần cho chủ gara (luôn gửi, kể cả tuần 0 lệnh) |
| `incident_alert.json` **(hạ tầng, mới 20/09)** | Webhook `POST /webhook/incident-alert` | — (app gọi vào, kèm `X-Internal-Token`) | Email doanh nghiệp — sự cố mức cao mới mở / đã khắc phục. Chỉ trả 200 sau khi email đã gửi |
| `app_watchdog.json` **(hạ tầng)** | Lịch, mỗi 30 phút | `GET /api/health` | Email doanh nghiệp — **chỉ** khi app không phản hồi / vòng tự động hỏng, và khi đã hoạt động lại |

## 0.1 Thay đổi ngày 18/09/2026 — không còn import tay

**Đồng bộ.** Trang Tự động hoá → **Đồng bộ workflow**, hoặc tự động mỗi lượt canh gác (30 phút ở
bản tự host). App đọc các file trong thư mục này (đóng gói sẵn vào bản build), rồi với mỗi file:
điền `N8N_INTERNAL_TOKEN`, thay `http://host.docker.internal:3000` bằng `APP_URL_FOR_N8N`, gán
credential SMTP đầu tiên tìm thấy trong n8n cho mọi node Gửi Email, điền email nhận cảnh báo
(email doanh nghiệp, hoặc `N8N_NOTIFY_EMAIL`) cho workflow canh gác. Cần `N8N_API_URL` +
`N8N_API_KEY` (API key có scope `workflow:*` và `credential:list`).

| Tình huống | Bộ canh gác (tự động) | Nút "Đồng bộ workflow" (người bấm) |
|---|---|---|
| n8n chưa có workflow | Tạo (n8n luôn tạo ở trạng thái tắt) | Tạo |
| Có, khớp mẫu, node Email chưa có SMTP | Gán SMTP | Gán SMTP |
| Có, **khác mẫu** (ai đó sửa tay trong n8n) | **Không đè** — báo lên chuông | Đè về bản mẫu |
| Quy tắc bật trong app, workflow đang tắt | **Không bật** — báo lên chuông (có workflow gửi thẳng cho khách) | Bật |
| Quy tắc tắt trong app, workflow đang bật | Tắt | Tắt |
| Workflow canh gác app | Bật (khi đã có email nhận và SMTP) | Bật |

"Khác mẫu" so bằng vân tay nội dung (tên, loại, tham số từng node + nối dây), bỏ qua id, vị trí
và credential — mở rồi lưu lại trong n8n UI có thể thêm tham số mặc định và bị tính là lệch;
khi đó chỉ cần bấm Đồng bộ.

**Canh gác hai chiều.** App canh n8n: quy tắc nào từng chạy theo lịch mà nay im quá nhịp của nó
(8 giờ cho lịch 6 giờ, 26 giờ cho lịch ngày, 8 ngày cho lịch tuần) lên chuông, và tự đóng khi
lịch chạy lại. n8n canh app: `app_watchdog.json` hỏi `/api/health` mỗi 30 phút; hỏng thì email
ngay, nhắc lại mỗi 3 giờ (không phải mỗi 30 phút), và email "đã hoạt động lại" kèm thời gian gián
đoạn khi khoẻ lại. Trạng thái chống trùng nằm trong static data của workflow (chỉ lưu khi chạy
theo lịch, không lưu khi bấm Execute thử). Và app canh ngược lại chính workflow này: mỗi lần nó
hỏi theo lịch, app ghi mốc; im quá 2 giờ thì lên chuông mức cao (và `/api/health` thành
`degraded`) — n8n còn sống mà riêng workflow canh gác bị tắt cũng không lọt.

## 0. Thay đổi ngày 17/09/2026 — đọc trước khi import lại

**Ngưỡng không còn nằm trong URL.** Trước đây workflow truyền cứng `?days=7&km=500`, nên sửa
ngưỡng trên trang Tự động hoá không có tác dụng. Nay mọi endpoint `/internal/*` tự đọc ngưỡng
từ quy tắc trong DB. Tham số URL chỉ còn tác dụng khi kèm `override=1` (để thử tay), nên các
workflow **đã import từ trước vẫn chạy và tự theo ngưỡng mới** — không bắt buộc import lại.

**Công tắc Bật/Tắt trong app là công tắc thật.** Endpoint trả `{ skipped: true, count: 0 }` khi
quy tắc đang tắt; mọi workflow đều kiểm tra `count > 0` (hoặc `send`) trước khi gửi. Tắt trong app
là dừng gửi, kể cả khi workflow bên n8n vẫn Active hoặc khi n8n không liên lạc được.

**App tự biết workflow có chạy hay không.** Mỗi lần endpoint dữ liệu được gọi, app ghi lại
`last_run_at` + nguồn gọi vào quy tắc tương ứng; node cuối "Báo app: đã gửi" (`POST
/internal/heartbeat`) ghi thêm kết quả gửi. Trang Tự động hoá hiện "Đang tự chạy / Quá 48 giờ
không chạy / Chưa từng chạy" từ chính dữ liệu đó — không cần mở n8n để trả lời câu hỏi "lịch có
chạy đúng giờ không".

Header `X-Anser-Trigger: {{ $execution.mode === 'production' ? 'schedule' : 'manual' }}` trong
các node HTTP Request giúp app phân biệt **lịch tự nổ** với **người bấm Execute workflow**. Lần
gọi bằng curl/trình duyệt (không có header, không phải n8n) **không được ghi** — để một lần thử
tay không làm giả bằng chứng lịch đang chạy.

**Import lại để có:** node nhịp tim, header nguồn chạy, và (riêng `low_stock_alert`) giới hạn 30
dòng mỗi email kèm tổng số thật. Không import lại thì mọi thứ khác vẫn đúng như trên.

### Vì sao hai bản tin mới dựng nội dung trong app, không trong node Code

Nội dung email là nghiệp vụ. Viết trong node Code của n8n thì nó nằm trong file JSON không ai
review, không typecheck, và phải import lại bằng tay mỗi lần sửa một chữ. `morning_brief` và
`accounting_digest` nhận sẵn `subject` + `html` + `send` từ app
(`src/server/automation/digests.ts`); workflow chỉ còn "hẹn giờ → gọi URL → nếu `send` thì gửi →
báo nhịp tim". Chuông thông báo trong app dùng chính dữ liệu đó, nên email và màn hình không bao
giờ nói hai con số khác nhau.

Hai bản tin này thay cho bộ 10 workflow kế toán/quản lý xưởng đã bị revert (`e4c131d`): 10
endpoint gần trùng nhau, mỗi cái một email riêng. Quản lý nhận 4–5 email mỗi ngày từ cùng một
hệ thống là công thức để tất cả bị bỏ qua.

### Không có n8n vẫn có cảnh báo

`GET /api/cron/automation` chạy bản tin sáng, tổng hợp kế toán và kiểm tra sẵn sàng vận hành
**ngay trong app**, rồi đẩy kết quả lên chuông thông báo (không gửi email). Lịch mặc định ở
`frontend/vercel.json` (Vercel Cron, giờ UTC: `0 0 * * *` = 7h sáng Việt Nam). Tự host thì dùng
Windows Task Scheduler / crontab:

```bash
curl -H "X-Cron-Secret: $CRON_SECRET" "https://<domain>/api/cron/automation?job=morning_brief&job=readiness"
```

Thiếu `CRON_SECRET` ở production thì endpoint trả 503.

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
bằng đúng chuỗi đó — kể cả các node "Báo app: …" (nhịp tim) ở cuối workflow.

> Các endpoint `/api/n8n/internal/*` trả về tên, SĐT và email khách hàng. Không có token thì
> bất kỳ ai chạm được tới server đều đọc sạch. Ở `NODE_ENV=development`, biến này để trống
> vẫn chạy được (import xong là dùng ngay trên máy); ở **production, thiếu token thì endpoint
> trả 503** — thiếu cấu hình phải nổ ra chứ không được âm thầm thành endpoint công khai.

**c. n8n API key** (chỉ cần nếu muốn bật/tắt workflow từ trong app) — n8n UI →
Settings → n8n API → Create an API key, dán vào `N8N_API_KEY` trong `.env.local`.

## 3. Import

Không cần nữa — xem §0.1. Nếu vẫn import tay (n8n UI → Workflows → **Import from File**): gán
credential SMTP cho node Gửi Email, thay token, thay `REPLACE_WITH_ALERT_EMAIL` trong
`app_watchdog.json`, rồi bật **Active**. Giữ nguyên **tên** workflow: app nhận diện theo tên.

## 4. Địa chỉ Next.js trong workflow

Các node HTTP Request trong file mẫu trỏ tới `http://host.docker.internal:3000` — địa chỉ để
container n8n gọi ngược ra Next.js đang chạy trên máy host. Khi đồng bộ, app thay bằng
`APP_URL_FOR_N8N`; dịch vụ `app` trong `docker-compose.yml` đặt sẵn `http://app:3000`. Trên Linux,
dịch vụ n8n có `extra_hosts: host.docker.internal:host-gateway` để địa chỉ mặc định vẫn dùng được.

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
