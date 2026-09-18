# ANSER Auto

Mảng **dịch vụ sửa chữa ô tô** của nền tảng ANSER. Sản phẩm độc lập, dựng theo đúng khuôn
hạ tầng của [ANSER Web v2](../ANSER-web-v2) (mảng bán lẻ/kho) nhưng có mô hình dữ liệu riêng
cho gara: hồ sơ xe, lệnh sửa chữa, bảng giá dịch vụ, kho phụ tùng, lịch hẹn, hoá đơn.

Một project Next.js duy nhất (`frontend/`) — vừa là UI vừa là backend (Route Handlers).

## Cấu trúc

```
ANSER_methuy/
├── ARCHITECTURE.md      Kiến trúc, mô hình dữ liệu, các quyết định thiết kế
├── STACK_DECISIONS.md   Vì sao chọn stack này, hướng tách AI/n8n
└── frontend/            Next.js (TypeScript, App Router, Tailwind v4) — UI + /api/*
```

## Chạy trên máy

```bash
cd frontend
npm install
cp .env.local.example .env.local     # rồi điền JWT_SECRET và DATABASE_URL (Neon Postgres)
npm run db:migrate                   # tạo bảng
npm run dev                          # http://localhost:3000
```

**Tài khoản đầu tiên.** DB rỗng thì trang `/register` mở cho đúng một lượt đăng ký — người
đó thành `admin`, rồi cửa đăng ký tự đóng. Hoặc đặt `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD` trong `.env.local` để tạo sẵn lúc khởi động (bị bắt đổi mật khẩu ở
lần đăng nhập đầu). Không còn tài khoản demo mật khẩu cố định nào được tạo tự động — bản cũ
seed `demo@anser.auto/demo1234` làm admin ở mọi lần khởi động, và mật khẩu đó nằm trong lịch
sử git nên phải coi là đã lộ.

Các tài khoản khác do quản trị viên cấp ở trang **Tài khoản** (mật khẩu tạm, bắt buộc đổi).

Tự động hoá (tuỳ chọn):

```bash
cd frontend
docker compose up -d                 # n8n tại :5681, MailHog tại :8027
```

Không cần import workflow bằng tay: trang **Tự động hoá → Đồng bộ workflow** đẩy cả 10 mẫu
lên n8n (tự điền token, địa chỉ app, credential SMTP). Bộ canh gác chạy mỗi 30 phút còn tự tạo
workflow thiếu và báo lên chuông khi lịch nào ngừng chạy — xem `ARCHITECTURE.md` §12.

Không có n8n thì bản tin sáng, tổng hợp kế toán và các việc chặn go-live vẫn lên **chuông thông
báo** trong app qua `GET /api/cron/automation` (lịch ở `frontend/vercel.json`, bảo vệ bằng
`CRON_SECRET`). n8n chỉ cần cho phần gửi email ra ngoài.

**Tự host cả app trong Docker** (app tự khởi động lại khi chết, có lịch nội bộ, n8n gọi app qua
mạng compose):

```bash
cd frontend
cp .env.local .env.app               # dùng biến production thật; .gitignore đã chặn .env*
npm run db:migrate                   # migration chạy từ máy có mã nguồn, không trong image
docker compose --profile app up -d --build
```

Không bật profile `app` thì `docker compose up -d` vẫn như cũ (chỉ n8n + MailHog).

Công cụ dữ liệu (`cd frontend`):

| Lệnh | Làm gì |
|---|---|
| `npm run db:backup` | Sao lưu toàn bộ bảng ra `backups/*.json` (bị gitignore) |
| `npm run db:restore <file> --apply` | Khôi phục — xem trước mặc định, `--apply` mới ghi |
| `npm run data:clean-demo --apply` | Xoá dữ liệu mẫu (7 phụ tùng, 8 dịch vụ, nhân sự "(test)"); từ chối xoá thứ đã có giao dịch |
| `npm run data:name-prices` | Tách giá nhập nằm trong tên phụ tùng ("Kính chắn gió G1.400") — xem trước, `--apply-cost` / `--apply-rename` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 168 test vitest cho module thuần — không cần DB |
| `npm run check` | Đúng chuỗi CI: typecheck → lint → test → build → quét bundle. Chạy trước khi push. |

## Trạng thái hiện tại

Gara dùng được cho luồng nghiệp vụ chính. Trang **Kiểm tra vận hành** (`/dashboard/readiness`)
đo trực tiếp từ DB xem còn gì chặn việc đưa vào dùng thật — mở nó trước khi đọc bất kỳ danh
sách "còn thiếu" nào, vì danh sách viết tay lỗi thời còn trang đó thì không.

Các mục trong sidebar:

| Màn hình | Làm được gì |
|---|---|
| Tổng quan | KPI xe trong xưởng / lịch hẹn / doanh thu, phụ tùng sắp hết, xe tới hạn bảo dưỡng |
| Lịch hẹn | Đặt lịch (kể cả khách chưa có hồ sơ), đổi trạng thái, huỷ |
| Lệnh sửa chữa | Tiếp nhận xe → chẩn đoán → báo giá → thi công → hoàn tất → giao xe; thêm dòng công, giao việc cho KTV, xuất phụ tùng (tự trừ kho), giảm giá |
| Khách hàng | CRUD, thống kê số xe / lượt vào xưởng / tổng chi tiêu |
| Hồ sơ xe | CRUD, chuẩn hoá biển số, lịch sử dịch vụ theo xe |
| Bảng giá dịch vụ | CRUD hạng mục, giờ công định mức, giá công |
| Kho phụ tùng | CRUD, phiếu nhập/xuất có transaction, cảnh báo tồn thấp theo ngưỡng riêng |
| Hoá đơn | Xuất từ lệnh đã hoàn tất, VAT, ghi nhận thanh toán, theo dõi công nợ |
| Báo cáo | Doanh thu ngày/tuần/tháng, cơ cấu công vs phụ tùng, top hạng mục và phụ tùng |
| Tự động hoá | Bật/tắt và ngưỡng là công tắc thật (workflow đọc lại từ app trước khi gửi); hiện lần chạy gần nhất + nguồn (lịch / chạy tay) để biết lịch có tự nổ không; **Đồng bộ workflow** lên n8n bằng một nút; xem/tải mẫu workflow JSON |
| Chi nhánh | CRUD xưởng, chuyên môn (máy / đồng-sơn…), email nhận cảnh báo; cảnh báo tên thiếu dấu |
| Nhân sự | CRUD hồ sơ nhân viên, chức vụ, chuyên môn, đơn giá công |
| Tài khoản | Cấp tài khoản (mật khẩu tạm bắt buộc đổi), đặt lại mật khẩu, đổi email, xoá; chặn xoá admin cuối cùng |
| Cài đặt | Thông tin doanh nghiệp, VAT mặc định, chu kỳ bảo dưỡng |
| Kiểm tra vận hành | Việc chặn go-live và cảnh báo, đo trực tiếp từ DB, kèm cách xử lý và link tới trang xử lý; số liệu vòng tự khép (sự cố đang mở, đã đóng sau khi đo lại, hệ thống tự sửa, thời gian khắc phục) |

Kho phụ tùng có thêm **Nhập giá hàng loạt** (gõ thẳng trên bảng, 100 dòng/trang) và **Nhập từ
Excel** (khớp cột theo tên tiêu đề, xem trước rồi mới ghi, tồn đầu kỳ đi qua phiếu nhập).
Hoá đơn có bản in A4 kèm số tiền bằng chữ. Sổ bán hàng / mua hàng sửa và xoá được. Ô tìm kiếm
(Ctrl+K) và chuông thông báo ở Topbar là thật.

Nền tảng: 20 bảng Postgres, 41 index, auth JWT + phân quyền 3 cấp + rate-limit đăng nhập
(bảng `login_attempts`), `proxy.ts` chặn `/dashboard` và ép đổi mật khẩu tạm, validate bằng
zod ở mọi route có body, mã chứng từ sinh bằng Postgres sequence, 9 workflow n8n + endpoint nội bộ
có token + bộ lập lịch nội bộ không cần n8n.

**Còn thiếu** — xem mục 10 của `ARCHITECTURE.md`.
