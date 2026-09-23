# ANSER Auto — Toàn bộ quy trình tự động hoá

> **Một file duy nhất để chuyển tiếp.** Đọc xong file này là nắm được hệ thống tự động của gara
> đang làm gì, chạy lúc nào, hỏng thì ai biết, và còn thiếu gì.
>
> Cập nhật: 24/09/2026 · Repo: `PCBoiz/ANSER_auto_fix` (fork của `Dgsonn/ANSER_auto`), nhánh `main`.
>
> Các file liên quan: [việc người vận hành cần làm](VIEC_CAN_LAM.md) ·
> [sổ tay xử lý sự cố](VAN_HANH_VONG_LAP.md) · [nhật ký đã làm gì](NHAT_KY_CAI_TIEN.md) ·
> [bẫy đã gặp](BAI_HOC_VA_BAY.md) · kiến trúc: `../ARCHITECTURE.md` §12–§13.

---

## 1. ANSER Auto là gì

Phần mềm quản lý gara ô tô: tiếp nhận xe → chẩn đoán → báo giá → thi công → nghiệm thu → giao xe
→ hoá đơn, kèm kho phụ tùng, lịch hẹn, sổ kế toán, báo cáo. Một project Next.js (`frontend/`) vừa
là giao diện vừa là backend, dữ liệu ở Neon Postgres, n8n tự host lo phần gửi email ra ngoài.

Trạng thái: **chạy được, chưa go-live.** Phần vận hành trong DB thật còn trống (0 lệnh sửa chữa,
0 khách, 0 hoá đơn); dữ liệu đang có là 788 phụ tùng và sổ kế toán năm 2025 nhập sẵn.

## 2. Nguyên tắc xuyên suốt của mọi tự động hoá ở đây

1. **Không ai bấm "đã xong".** Sự cố chỉ đóng khi lần đo sau không còn thấy nó. Xác nhận đến từ
   dữ liệu, không từ lời tuyên bố.
2. **Máy tự làm việc an toàn, người quyết việc cần phán đoán.** Máy được tạo workflow còn thiếu,
   gán SMTP, tắt thứ app đã tắt, sao lưu. Máy **không** tự đè bản ai đó sửa tay và **không** tự
   bật workflow gửi email cho khách thật.
3. **Mỗi lớp canh gác đều có lớp canh nó.** App canh n8n, n8n canh app, và một dịch vụ bên ngoài
   canh cả hai — vì app với n8n thường nằm cùng một máy, mất điện là cùng câm.
4. **Nội dung email nằm trong mã nguồn**, không nằm trong node Code của n8n: có git, có review,
   có test. Workflow n8n chỉ còn "hẹn giờ → gọi URL → gửi".
5. **Tắt trong app là tắt thật.** Endpoint trả `{ skipped: true, count: 0 }` khi quy tắc tắt, nên
   workflow còn Active bên n8n cũng không gửi gì.

## 3. Bản đồ một trang

```
   ┌──────────────── LỊCH ─────────────────┐
   │ lịch nội bộ trong app (30 phút / 2h / 7h / 8h thứ Hai)   │  ← tự host
   │ hoặc Vercel Cron (mỗi sáng)                              │  ← serverless
   └───────────────────┬───────────────────┘
                       ▼
        BỘ CANH GÁC: phát hiện → tự sửa việc an toàn → chuông việc cần người
                       │                                   │
                       │                                   ├─► EMAIL BÁO NHANH (qua n8n)
                       │                                   └─► CHUÔNG trong app
                       ▼
        ĐO LẠI lượt sau → không còn thấy → ĐÓNG "đã khắc phục sau X"

   n8n ──mỗi 30 phút hỏi /api/health──► app chết/vòng hỏng → email; sống lại → email
   app ──ghi mốc mỗi lần n8n hỏi─────► n8n ngừng hỏi > 2 giờ → chuông
   app ──nhịp mỗi lượt canh gác─────► healthchecks.io: nhịp ngừng > 1 giờ → email
```

## 4. Kiểm kê đầy đủ (tự sinh từ mã nguồn)

<!-- BẮT ĐẦU PHẦN TỰ SINH — sửa src/lib/automationCatalog.json rồi chạy: npm run docs:automation -->

_Phần này do `npm run docs:automation` sinh ra từ `frontend/src/lib/automationCatalog.json`. Tổng cộng **31 quy trình tự động**._

### Quy tắc nghiệp vụ — n8n gửi email ra ngoài (10)

| Quy trình | Chạy khi nào | Làm gì | Khép vòng thế nào | Ở đâu trong mã |
|---|---|---|---|---|
| **Cảnh báo phụ tùng sắp hết** | n8n, mỗi 6 giờ | Lấy danh sách chi nhánh rồi hỏi từng kho phụ tùng dưới ngưỡng; gửi email tới đúng email cảnh báo của chi nhánh đó. | Ngưỡng đọc từ app mỗi lần chạy; đặt ngưỡng 0 cho vật tư đặt theo xe là tắt cảnh báo cho mã đó. | `api/n8n/internal/low-stock, store/parts.ts` |
| **Nhắc bảo dưỡng định kỳ** | n8n, 8h hằng ngày | Tìm xe tới hạn theo ngày hoặc theo km; gửi thư cho TỪNG KHÁCH và một bản tổng hợp cho gara. | Đóng lệnh sửa chữa sẽ dời mốc bảo dưỡng kế tiếp của xe, nên xe đã vào xưởng không bị nhắc lại. | `api/n8n/internal/due-for-service` |
| **Nhắc lịch hẹn** | n8n, 17h hằng ngày | Nhắc KHÁCH có lịch hẹn trong 24 giờ tới, kèm bảng phân công cho lễ tân. | Lịch hẹn đã huỷ hoặc đã tới thì không nằm trong danh sách lần sau. | `api/n8n/internal/appointments` |
| **Nhắc chờ nghiệm thu quá hạn** | n8n, 9h hằng ngày | Xe sửa xong mà khách chưa tới nhận quá N ngày: nhắc KHÁCH, kèm tổng hợp cho gara. | Giao xe (đổi trạng thái) là hết nhắc. | `api/n8n/internal/awaiting-acceptance` |
| **Báo cáo công nợ** | n8n, 9h hằng ngày | Hoá đơn chưa thu đủ quá hạn — CHỈ gửi nội bộ, không gửi khách. | Ghi nhận thanh toán đủ là ra khỏi danh sách. | `api/n8n/internal/unpaid-invoices` |
| **Báo cáo doanh thu ngày** | n8n, 20h hằng ngày | Doanh thu trong ngày (nhân bản workflow và đổi period=week\|month nếu cần bản tuần/tháng). | — | `api/n8n/internal/revenue` |
| **Báo tiến độ sửa chữa cho khách** | App gọi webhook ngay khi lệnh đổi trạng thái | Chỉ báo ở 3 mốc khách thật sự quan tâm: đã báo giá, mời tới nghiệm thu, đã giao xe. Khách không có email thì bỏ qua. | — | `server/n8n.ts — notifyOrderStatusChanged` |
| **Bản tin sáng cho quản lý xưởng** | n8n 7h hằng ngày (email) + lịch nội bộ từ 7h (chuông) | MỘT bản tin gộp: xe quá hẹn trả, xe chờ nghiệm thu, đặt hàng ngoài về trễ, lịch hẹn, phụ tùng sắp hết, công nợ. | Mục của bản tin cũ bị bản mới thay (superseded) nên chuông không tích tụ con số cũ. | `automation/digests.ts — buildMorningBrief` |
| **Tổng hợp tuần cho kế toán** | n8n 8h thứ Hai (email) + lịch nội bộ từ 8h thứ Hai (chuông) | Hoá đơn mua chưa nhận theo nhà cung cấp, hàng đã giao chưa lập hoá đơn, khách bị ghi nhiều tên. | Như bản tin sáng: bản mới thay bản cũ. | `automation/digests.ts — buildAccountingDigest` |
| **Báo cáo tuần cho chủ gara** | n8n 8h thứ Hai (email) + lịch nội bộ từ 8h thứ Hai (chuông) | App có thật sự được dùng không: lệnh, xe giao, doanh thu so tuần trước; ai đăng nhập, ai chưa từng; thất thoát đang mở; vòng tự động tuần qua. LUÔN gửi, kể cả tuần 0 lệnh. | — | `automation/digests.ts — buildOwnerWeekly` |

### Vòng lặp vận hành — app tự phát hiện, tự sửa, tự đóng (11)

| Quy trình | Chạy khi nào | Làm gì | Khép vòng thế nào | Ở đâu trong mã |
|---|---|---|---|---|
| **Bộ canh gác trong app** | Lịch nội bộ mỗi 30 phút (tự host) hoặc Vercel Cron mỗi sáng; nút “Kiểm tra lại ngay” | Một lượt gồm: dò quy tắc im quá nhịp, kiểm tra sao lưu, đồng bộ n8n, đối soát mọi sự cố, gửi email báo nhanh, gửi nhịp ra ngoài. | Đối soát: sự cố nào lần đo này không còn thì ĐÓNG (resolution = verified). Lượt đo lỗi giữa chừng thì không đối soát, để không đóng nhầm. | `automation/watchdog.ts` |
| **Kiểm tra sẵn sàng vận hành** | Mỗi lượt canh gác; và ngay khi mở trang Kiểm tra vận hành | Đo thẳng từ DB 12+ mục chặn go-live và cảnh báo (mật khẩu đã lộ, dữ liệu mẫu, giá bán, thông tin doanh nghiệp, sao lưu, canh gác ngoài…). Mục mức chặn lên chuông. | Sửa xong, lần đo sau không còn thấy thì mục biến mất và sự cố tự đóng. | `server/readiness.ts` |
| **Tự đồng bộ workflow lên n8n** | Mỗi lượt canh gác (chế độ tự động) và nút “Đồng bộ workflow” (người bấm) | Đẩy 12 mẫu trong git lên n8n: điền token, địa chỉ app, credential SMTP, email cảnh báo; so vân tay nội dung để biết workflow đã bị sửa tay. | Tự làm việc an toàn (tạo cái thiếu, gán SMTP, tắt theo app). KHÔNG tự đè bản sửa tay và KHÔNG tự bật workflow gửi khách — hai việc đó chờ người bấm. | `automation/n8nSync.ts, lib/n8nTemplates.ts` |
| **n8n canh app (canh gác hai chiều)** | n8n, mỗi 30 phút | Hỏi /api/health. App chết hoặc vòng tự động hỏng thì email ngay, nhắc lại mỗi 3 giờ; app sống lại thì email “đã hoạt động lại” kèm thời gian gián đoạn. | Chống trùng bằng static data của workflow; báo hồi phục đúng một lần. | `n8n-workflows/app_watchdog.json, api/health` |
| **App canh lại người canh gác** | Mỗi lần n8n hỏi /api/health theo lịch | Ghi mốc n8n vừa hỏi. Im quá 2 giờ (lỡ 4 lần) thì mở sự cố mức cao: n8n còn sống nhưng workflow canh gác đã tắt. | n8n hỏi lại là đóng. | `api/health, automation/watchdog.ts` |
| **Email báo nhanh sự cố** | Cuối mỗi lượt canh gác | Gom sự cố MỨC CAO mới mở và sự cố đã báo nay đã đóng thành MỘT email. Workflow tự kiểm token và chỉ trả 200 sau khi email đã gửi xong. | Chỉ đánh dấu “đã báo” khi n8n xác nhận gửi xong; gửi lỗi thì lượt sau gửi lại. Tái phát thì báo lại. | `server/incidentAlerts.ts, lib/incidentAlerts.ts` |
| **Canh gác từ bên ngoài (dead man's switch)** | Cuối mỗi lượt canh gác theo lịch | Gửi nhịp tới healthchecks.io: khoẻ thì ping URL gốc, hỏng thì ping /fail. Máy chủ mất điện/mất mạng thì nhịp ngừng và chính dịch vụ đó email cho chủ gara. | Đây là lớp cuối: không đi qua n8n, nên n8n hay app chết đều không làm nó câm. | `automation/watchdog.ts — pingHeartbeat` |
| **Sao lưu tự động** | Lịch nội bộ, mỗi ngày từ 2h sáng | Kết xuất 19 bảng ra JSON, ĐỌC LẠI đối chiếu số dòng, chép sang thư mục đồng bộ (Google Drive/OneDrive) rồi so sha256, giữ 14 bản mới nhất. | Lỗi sao lưu hoặc quá 36 giờ không có bản mới thì mở sự cố; lần sau thành công là đóng. | `server/backup.ts, lib/backupPolicy.ts` |
| **Chặn thất thoát doanh thu** | Ngay sau mỗi lần sửa lệnh/hoá đơn (after()) + mỗi lượt canh gác | Dò dòng 0đ, dòng bán dưới giá vốn, giảm giá lớn chưa duyệt, xe đã giao quá 24 giờ chưa lập hoá đơn. | Sửa giá, bỏ dòng, quản lý duyệt hoặc lập hoá đơn thì sự cố tự đóng. | `lib/revenueGuard.ts, server/revenueGuard.ts` |
| **Theo dõi mức sử dụng** | Mỗi lượt canh gác | Báo khi N ngày làm việc liền (mặc định 2, bỏ Chủ nhật) không có lệnh sửa chữa mới. Chỉ canh sau khi đã có lệnh đầu tiên. | Có lệnh mới là đóng. | `lib/usage.ts` |
| **Dọn thông báo cũ** | Cuối mỗi lượt chạy lịch | Xoá thông báo cũ hơn 30 ngày, nhưng KHÔNG BAO GIỜ xoá sự cố đang mở (readiness, watchdog, revenue, usage). | — | `store/notifications.ts — pruneNotifications` |

### Chốt chặn — ngăn sai sót ngay lúc thao tác (4)

| Quy trình | Chạy khi nào | Làm gì | Khép vòng thế nào | Ở đâu trong mã |
|---|---|---|---|---|
| **Xác nhận khi lập hoá đơn còn dòng 0đ** | Lúc bấm xuất hoá đơn | Trả 409 kèm danh sách dòng 0đ; giao diện hỏi lại rồi mới gửi kèm xác nhận. Hoá đơn là chỗ chốt tiền nên chỉ chặn ở đây. | — | `store/invoices.ts — ZeroPriceLinesError` |
| **Duyệt giảm giá lớn** | Khi giảm giá ≥10% và ≥500.000đ | Nhân viên đặt thì chờ quản lý bấm Duyệt; quản lý tự đặt thì coi như đã duyệt. Lưu SỐ TIỀN đã duyệt nên sửa mức giảm là phải duyệt lại. | Duyệt đúng mức hiện tại thì sự cố đóng. | `api/service-orders/[id], lib/revenueGuard.ts` |
| **Chặn dò mật khẩu** | Mỗi lần đăng nhập | 5 lần sai/email và 20 lần sai/IP trong 15 phút thì khoá tạm. Đếm trong DB nên đúng cả khi chạy nhiều tiến trình. | Đăng nhập đúng là xoá bộ đếm. | `server/loginThrottle.ts` |
| **Giới hạn thao tác nặng** | Import Excel, nhập giá hàng loạt, chạy tay bản tin, đồng bộ n8n | Đếm theo tài khoản (không theo IP — cả gara chung một router) để một script lỗi không ép server parse 5 MB liên tục. | — | `server/rateLimit.ts` |

### Hạ tầng & quy trình làm việc (6)

| Quy trình | Chạy khi nào | Làm gì | Khép vòng thế nào | Ở đâu trong mã |
|---|---|---|---|---|
| **Lịch chạy trong app** | Tiến trình app, kiểm tra mỗi 5 phút | Chạy canh gác (30 phút), sao lưu (2h), bản tin sáng (7h), tổng hợp kế toán + báo cáo tuần (8h thứ Hai). Có BẮT KỊP: máy tắt buổi sáng, bật lại vẫn chạy bản tin hôm đó. | Giành khe trong DB nên hai tiến trình không chạy trùng một khe. | `automation/scheduler.ts, store/systemState.ts` |
| **Lịch của Vercel** | 0h UTC hằng ngày (7h VN) và 1h UTC thứ Hai (8h VN) | Gọi /api/cron/automation cho bản deploy serverless, nơi tiến trình không sống liên tục. | — | `vercel.json, api/cron/automation` |
| **Khởi tạo lúc server bật** | Mỗi lần khởi động | Tạo chi nhánh mặc định, quy tắc tự động còn thiếu, dòng cài đặt doanh nghiệp, và quản trị viên đầu tiên nếu khai báo env. Dữ liệu MINH HOẠ chỉ tạo khi SEED_DEMO_DATA=true. | Idempotent: chạy lại nhiều lần không sinh trùng. | `instrumentation.ts, store/seed.ts` |
| **Docker tự dựng lại app** | Khi tiến trình app chết | restart: unless-stopped + HEALTHCHECK gọi /api/health?live=1 (không chạm DB, để Neon ngủ đông không bị coi là app hỏng). | App chết trong thời gian dài vẫn bị n8n và healthchecks.io báo. | `docker-compose.yml, Dockerfile` |
| **Chuỗi kiểm tra trước khi push** | npm run check, và git hook pre-push sau khi cài npm run hooks:install | typecheck → lint → 219 test → build → quét bundle client xem 3 mật khẩu đã lộ có quay lại không. Hook build sang .next-hook để không tranh file với dev server đang mở. | Hook chặn push khi đỏ — thay cho CI GitHub đang bị khoá vì vấn đề thanh toán của tài khoản. | `package.json, scripts/install-git-hooks.mjs, .github/workflows/ci.yml` |
| **Tài liệu tự sinh từ mã** | npm run docs:automation; test chạy mỗi lần npm test | Sinh phần kiểm kê trong docs/TONG_HOP_TU_DONG_HOA.md từ file này. | Test đỏ nếu tài liệu lệch mã, hoặc mã có quy tắc/workflow/việc theo lịch chưa được ghi vào kiểm kê. | `scripts/gen-automation-doc.ts, lib/automationDoc.ts` |

### Workflow n8n (12 file trong `frontend/n8n-workflows/`)

| File | Quy trình | Quy tắc bật/tắt trong app |
|---|---|---|
| `low_stock_alert.json` | Cảnh báo phụ tùng sắp hết | `low_stock_alert` |
| `maintenance_reminder.json` | Nhắc bảo dưỡng định kỳ | `maintenance_reminder` |
| `appointment_reminder.json` | Nhắc lịch hẹn | `appointment_reminder` |
| `awaiting_acceptance_reminder.json` | Nhắc chờ nghiệm thu quá hạn | `awaiting_acceptance_reminder` |
| `unpaid_invoice_report.json` | Báo cáo công nợ | `unpaid_invoice_report` |
| `revenue_report.json` | Báo cáo doanh thu ngày | `revenue_report` |
| `order_status_update.json` | Báo tiến độ sửa chữa cho khách | `order_status_update` |
| `morning_brief.json` | Bản tin sáng cho quản lý xưởng | `morning_brief` |
| `accounting_digest.json` | Tổng hợp tuần cho kế toán | `accounting_digest` |
| `owner_weekly_report.json` | Báo cáo tuần cho chủ gara | `owner_weekly_report` |
| `app_watchdog.json` | n8n canh app (canh gác hai chiều) | — (hạ tầng, không tắt được từ app) |
| `incident_alert.json` | Email báo nhanh sự cố | — (hạ tầng, không tắt được từ app) |

### Khoá sự cố sinh ra trên chuông

| Quy trình | Khoá |
|---|---|
| Bộ canh gác trong app | `watchdog:rule:<loại>`, `watchdog:n8n:*`, `watchdog:backup:*` |
| Kiểm tra sẵn sàng vận hành | `readiness:<mã mục>` |
| Tự đồng bộ workflow lên n8n | `watchdog:n8n:drift`, `watchdog:n8n:inactive`, `watchdog:n8n:no-smtp`, `watchdog:n8n:sync-error` |
| App canh lại người canh gác | `watchdog:n8n:app-watchdog-silent` |
| Sao lưu tự động | `watchdog:backup:failed`, `watchdog:backup:stale`, `watchdog:backup:copy-failed` |
| Chặn thất thoát doanh thu | `revenue:order:<id>:zero`, `revenue:order:<id>:below-cost`, `revenue:order:<id>:discount`, `revenue:order:<id>:not-invoiced` |
| Theo dõi mức sử dụng | `usage:no-orders` |

### Biến môi trường và quy trình phụ thuộc

| Biến | Thiếu thì mất gì |
|---|---|
| `APP_PUBLIC_URL` | Email báo nhanh sự cố |
| `APP_URL_FOR_N8N` | Tự đồng bộ workflow lên n8n |
| `BACKUP_COPY_DIR` | Sao lưu tự động |
| `BACKUP_DIR` | Sao lưu tự động |
| `BACKUP_KEEP` | Sao lưu tự động |
| `BOOTSTRAP_ADMIN_EMAIL` | Khởi tạo lúc server bật |
| `BOOTSTRAP_ADMIN_PASSWORD` | Khởi tạo lúc server bật |
| `CRON_SECRET` | Bộ canh gác trong app; Lịch của Vercel |
| `HEARTBEAT_URL` | Canh gác từ bên ngoài (dead man's switch) |
| `INTERNAL_SCHEDULER` | Bộ canh gác trong app; Lịch chạy trong app |
| `N8N_API_KEY` | Tự đồng bộ workflow lên n8n |
| `N8N_API_URL` | Tự đồng bộ workflow lên n8n |
| `N8N_INTERNAL_TOKEN` | Cảnh báo phụ tùng sắp hết; Nhắc bảo dưỡng định kỳ; Nhắc lịch hẹn; Nhắc chờ nghiệm thu quá hạn; Báo cáo công nợ; Báo cáo doanh thu ngày; Bản tin sáng cho quản lý xưởng; Tổng hợp tuần cho kế toán; Báo cáo tuần cho chủ gara; Tự đồng bộ workflow lên n8n; n8n canh app (canh gác hai chiều); App canh lại người canh gác; Email báo nhanh sự cố |
| `N8N_WEBHOOK_URL` | Báo tiến độ sửa chữa cho khách; Email báo nhanh sự cố |
| `SEED_DEMO_DATA` | Khởi tạo lúc server bật |

<!-- HẾT PHẦN TỰ SINH -->

## 5. Vòng đời một sự cố (ví dụ có thật)

1. **08:15** KTV thêm phụ tùng "Kính chắn gió" vào lệnh RO-2026-0007. Phụ tùng này chưa có giá
   bán nên dòng ra 0đ. Màn hình hiện cảnh báo ngay, dòng tô đỏ.
2. **08:15** App mở sự cố `revenue:order:<id>:zero` (mức cao) trên chuông của quản lý.
3. **08:30** Lượt canh gác kế tiếp gom nó vào email 🔴 gửi chủ gara, kèm link mở thẳng lệnh.
4. **09:40** Quản lý điền giá bán trong kho, bỏ dòng cũ và thêm lại.
5. **09:40** Ngay sau thao tác, app đo lại: không còn dòng 0đ → sự cố **đóng**, ghi
   "đã khắc phục sau 1 giờ 25 phút".
6. **10:00** Lượt canh gác kế tiếp gửi email 🟢 "đã khắc phục" để người nhận không phải tự đi
   kiểm tra.
7. Cuối tuần, báo cáo tuần cho chủ gara đếm sự cố này vào mục "đã khắc phục sau khi đo lại".

## 6. Muốn bật hết thì cần gì

| Cần | Để làm gì | Thiếu thì sao |
|---|---|---|
| n8n đang chạy + API key | Gửi mọi email ra ngoài, đồng bộ workflow | Chuông trong app vẫn chạy đủ; chỉ mất email |
| Credential SMTP trong n8n | Node Gửi Email | Workflow tạo được nhưng không bật được |
| Email doanh nghiệp (Cài đặt) | Nơi nhận cảnh báo và báo cáo | Workflow canh gác app bị để tắt |
| `INTERNAL_SCHEDULER=true` | Lịch chạy trong app (tự host) | Không có gì tự chạy ngoài n8n |
| `BACKUP_DIR` + `BACKUP_COPY_DIR` | Sao lưu hằng đêm và chép ra ngoài máy | Không có bản sao độc lập với Neon |
| `HEARTBEAT_URL` | Canh gác từ bên ngoài | Máy chủ chết thì không ai được báo |

Cách đặt từng biến: [VIEC_CAN_LAM.md](VIEC_CAN_LAM.md) mục B, B+, C, D.

## 7. Kiểm chứng — làm sao biết những thứ trên là thật

- **219 test tự động** (`npm test`, không cần DB), trong đó: đối soát vòng đời sự cố, nhịp kỳ vọng
  từng quy tắc, khe lịch theo giờ Việt Nam, ranh giới máy tự sửa / người quyết, dò thất thoát,
  ngày làm việc, email báo nhanh, sao lưu, và **chạy thật** đoạn mã trong workflow canh gác của n8n
  bằng đồng hồ giả.
- **Đã thử trên hệ thống thật**: toàn bộ luồng chặn thất thoát qua API và trình duyệt; đồng bộ 12
  workflow lên một n8n 2.39 dựng tạm (6 bước: tạo → khớp → sửa tay bị phát hiện → người đồng bộ →
  sạch); email báo nhanh, nhịp ra ngoài, chép sao lưu thử với máy chủ giả gồm cả nhánh lỗi.
- **Tài liệu không lệch được**: phần kiểm kê ở mục 4 do `npm run docs:automation` sinh từ
  `frontend/src/lib/automationCatalog.json`, và test đỏ nếu mã có quy trình chưa ghi vào kiểm kê
  hoặc tài liệu chưa sinh lại.
- **Trước khi push**: `npm run check` (typecheck → lint → test → build → quét bundle). Cài
  `npm run hooks:install` để git tự chặn push khi đỏ — CI trên GitHub hiện không chạy được vì tài
  khoản bị khoá thanh toán.

## 8. Những gì CHƯA có (nói thẳng)

- **Chưa deploy ra ngoài localhost.** Dockerfile và compose đã viết nhưng **chưa build thật** vì
  Docker Desktop trên máy dev đang hỏng.
- **Chưa có lần chạy theo lịch nào trên n8n thật của gara** — cơ chế đã đủ, còn thiếu một lần bật.
- **Không có tự động hoá gửi khách qua Zalo/SMS.** Hiện chỉ email; khách Việt Nam phần lớn dùng
  Zalo, nếu cần thì phải đăng ký Zalo OA và duyệt mẫu tin.
- **Chưa có test cho phần chạm DB** (cần một Neon branch riêng cho CI).
- **Không có tự động hoá nào tự sửa dữ liệu nghiệp vụ** (không tự điền giá, không tự lập hoá đơn,
  không tự gửi thay người). Mọi thứ đụng tiền hoặc đụng khách đều dừng lại chờ người.
