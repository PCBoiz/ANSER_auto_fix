# ANSER Auto — Kiến trúc & mô hình dữ liệu

Tài liệu này giải thích cấu trúc project, vai trò từng file, mô hình dữ liệu nghiệp vụ gara,
và **vì sao** từng quyết định được chọn. Viết cho người mới join hoặc AI agent đọc để nắm
nhanh hiện trạng mà không phải đọc lại toàn bộ lịch sử commit.

## 1. Tổng quan

**1 project Next.js duy nhất** (`frontend/`) — vừa là UI vừa là backend:

- UI: các trang trong `src/app/` (App Router).
- Backend: **Route Handlers** (`src/app/api/**/route.ts`) — chạy Node.js runtime, cùng
  process với UI, cùng origin. Không CORS, không `credentials: "include"`.
- Xác thực: JWT trong cookie `httpOnly` (`anser_auto_token`), phân quyền 3 cấp.
- Dữ liệu: **Neon Postgres** qua **Drizzle ORM** (driver `neon-serverless` dạng Pool/WebSocket
  — bắt buộc vì `neon-http` không hỗ trợ `db.transaction()`, mà xuất phụ tùng cho lệnh sửa
  chữa phải chạy trong transaction).
- Tự động hoá: n8n self-host (Docker), gọi 2 chiều qua webhook + Public API.

Khuôn hạ tầng lấy từ ANSER Web v2 (mảng bán lẻ). **Mô hình dữ liệu thì viết mới hoàn toàn** —
gara không phải cửa hàng bán lẻ có thêm dịch vụ: trung tâm nghiệp vụ là *chiếc xe* và *lệnh
sửa chữa*, không phải *sản phẩm* và *hoá đơn bán hàng*.

## 2. Cấu trúc thư mục

```
frontend/
├── .env.local.example
├── docker-compose.yml            n8n (:5681) + MailHog (:8027)
├── drizzle.config.ts
├── next.config.ts / postcss.config.mjs / eslint.config.mjs / tsconfig.json
├── n8n-workflows/                9 workflow JSON + README hướng dẫn import
└── src/
    ├── instrumentation.ts        chạy 1 lần lúc server khởi động → seed idempotent
    ├── proxy.ts                  chặn /dashboard (KHÔNG phải middleware.ts — xem mục 3)
    ├── lib/format.ts             formatVnd/formatDate — module THUẦN, xem mục 5.1
    ├── app/
    │   ├── layout.tsx, globals.css, page.tsx        landing
    │   ├── login/page.tsx, register/page.tsx
    │   ├── dashboard/
    │   │   ├── layout.tsx (sidebar + topbar), page.tsx (Tổng quan)
    │   │   ├── appointments/, customers/, vehicles/, services/, parts/
    │   │   ├── orders/page.tsx + orders/[id]/page.tsx   ← trang chi tiết lệnh
    │   │   └── invoices/, reports/, automation/, staff/, settings/
    │   └── api/
    │       ├── health, auth/{register,login,logout,me}
    │       ├── branches, customers, vehicles, services, parts, employees
    │       ├── parts/transactions                        nhập/xuất kho lẻ
    │       ├── service-orders + [id]/{labors,parts,special-orders}
    │       ├── invoices, appointments, settings/company
    │       ├── automation/rules + [id]/executions        điều khiển n8n thật
    │       └── n8n/internal/{branches,low-stock,due-for-service,appointments,revenue}
    ├── components/
    │   ├── AmbientOrbs.tsx, AuthShell.tsx, FloatingInput.tsx
    │   ├── dashboard/{Sidebar,Topbar,StatCard,icons}.tsx
    │   └── ui/{Modal,Field,PageShell}.tsx               component dùng chung mọi trang
    └── server/
        ├── api.ts                helper lỗi + wrapper handle()
        ├── auth.ts               JWT, cookie
        ├── session.ts            getSessionUser(), requireRole()
        ├── internalAuth.ts       token cho endpoint n8n gọi server-to-server
        ├── domain.ts             hằng số nghiệp vụ (trạng thái, danh mục, nhãn tiếng Việt)
        ├── reports.ts            getOverviewSummary(), getRevenueReport()
        ├── n8n.ts                webhook fire-and-forget (không throw)
        ├── n8nApi.ts             n8n Public API (có throw)
        ├── db/
        │   ├── schema.ts         20 bảng + 2 sequence mã chứng từ + 41 index
        │   ├── client.ts         singleton `db` khởi tạo lười
        │   └── migrations/0000_*.sql … 0003_*.sql
        └── store/
            ├── codes.ts          sinh mã chứng từ từ sequence
            ├── users, employees, branches, settings, seed
            ├── customers, vehicles, services, parts, appointments
            ├── serviceOrders     ← transaction phức tạp nhất, xem mục 9
            ├── specialOrders     phụ tùng đặt ngoài — xem mục 8.5
            ├── invoices, automation
```

### 5.1 Một cái bẫy đã dính

`formatVnd`/`formatDate` từng nằm trong `components/ui/PageShell.tsx` — file có `"use
client"`. Trang Báo cáo là Server Component, import vào là lỗi runtime *"Attempted to call
formatVnd() from the server but formatVnd is on the client"*. Build vẫn xanh, typecheck vẫn
xanh; chỉ khi mở trang mới nổ 500.

Nay chúng nằm ở `src/lib/format.ts` (module thuần, không directive), `PageShell` chỉ
re-export cho tiện. **Hàm dùng chung cho cả server lẫn client không được đặt trong file có
`"use client"`.**

## 3. Ba khác biệt so với ANSER Web v2

| | ANSER v2 | ANSER Auto | Lý do |
|---|---|---|---|
| Chặn `/dashboard` | Chưa có (hạn chế đã ghi nhận) | `src/proxy.ts` verify JWT | Next 16 chạy proxy trên **Node.js runtime**, nên verify được chữ ký ngay tại đó chứ không chỉ "có cookie hay không". Vẫn phải kiểm tra quyền ở từng route — proxy chỉ chặn theo đường dẫn, một lần sửa `matcher` là mất sạch. |
| `JWT_SECRET` | Fallback ngầm cả ở production | Throw nếu thiếu ở production | Quên set env ở production = token ai cũng giả mạo được. Kiểm tra **lúc dùng token**, không phải lúc import module — vì `next build` chạy với `NODE_ENV=production` và import mọi route để thu metadata. |
| `db` client | `export const db = drizzle(...)` chạy ngay lúc import | Khởi tạo lười qua Proxy | Cùng lý do: `next build` không được đòi `DATABASE_URL` khi không câu truy vấn nào thực sự chạy. |

> **Lưu ý phiên bản**: bản Next.js này (16.2.12) đã đổi tên `middleware.ts` → `proxy.ts`
> (hàm export cũng đổi từ `middleware` → `proxy`). Doc gốc:
> `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.

## 4. Mô hình dữ liệu

15 bảng, chia 5 nhóm:

```
Tổ chức     branches ─┬─ employees ─ users
                      │
Khách & xe  customers ─── vehicles
                              │
Danh mục    services      parts ─── part_transactions
                │             │
Nghiệp vụ   appointments ─ service_orders ─┬─ service_order_labors
                                            └─ service_order_parts
                                                     │
                                                 invoices

Cấu hình    company_settings, automation_rules
```

### 4.1 Quy ước xuyên suốt

- **Tiền là `integer` VND**, không float. Cộng dồn hàng trăm dòng công/phụ tùng bằng float
  là nguồn lệch tiền kinh điển.
- **Thời lượng công lưu bằng phút** (`standardMinutes`, `actualMinutes`), không phải giờ thập phân.
- **Cột giá vốn nullable có chủ đích**: `null` = CHƯA BIẾT, khác hẳn `0` = "không tốn đồng nào".
  Thiếu phân biệt này thì báo cáo lãi lỗ coi mọi mặt hàng chưa nhập giá vốn là lãi 100% — con
  số sai mà nghe rất xuôi tai, đúng loại lỗi không ai phát hiện tới lúc quyết toán.
- **Snapshot mọi thứ in ra giấy**: tên, đơn giá, giá vốn, biển số đều được chép lại vào dòng
  chứng từ tại thời điểm lập. Sửa bảng giá hôm nay không được làm sai lệnh của tháng trước.

### 4.2 Các quyết định đáng giải thích

**`branches` đóng luôn vai trò kho phụ tùng** (thay vì tách `warehouses` riêng như v2). Trong
gara, kho phụ tùng luôn gắn với xưởng đang sửa xe; tách 2 khái niệm chỉ thêm một lần join mà
không có trường hợp dùng thật. Một kho phục vụ nhiều xưởng là mô hình chuỗi lớn — ngoài phạm vi.

**Lịch sử dịch vụ treo vào `vehicles`, không treo vào `customers`.** Xe đổi chủ thì lịch sử
bảo dưỡng phải đi theo xe, không theo người. `vehicles.customerId` là *chủ xe hiện tại* và
dùng `onDelete: "set null"` — xoá hồ sơ khách không được làm mất lịch sử của chiếc xe.

**`parts.code` unique theo `(branchId, code)`, không unique toàn cục.** Hai chi nhánh có kho
độc lập; ép unique toàn hệ thống sẽ chặn chi nhánh mới nhập đúng mặt hàng mà chi nhánh cũ đã có.

**Dòng công và dòng phụ tùng là hai bảng riêng** (`service_order_labors` /
`service_order_parts`) — khác v2 nơi một bảng `sales_invoice_items` là đủ. Hai loại dòng này
khác nhau về bản chất:

| | dòng công | dòng phụ tùng |
|---|---|---|
| Gắn với | kỹ thuật viên | kho |
| Tiến độ riêng | có (`status`, `actualMinutes`) | không |
| Trừ tồn kho | không | có |
| Giá vốn | theo giờ công của KTV | theo lô nhập |

Gộp một bảng thì quá nửa số cột luôn NULL ở một trong hai loại, và mọi truy vấn đều phải kèm
`WHERE kind = ...` — che mất chính điều khiến chúng khác nhau.

**`invoices` không có bảng dòng riêng.** Chi tiết hoá đơn đọc thẳng từ hai bảng dòng của lệnh
sửa chữa, vì chúng đã là snapshot bất biến. Nhân đôi sang bảng thứ ba chỉ tạo thêm một bản sao
có thể lệch, không thêm thông tin. Quan hệ 1–1 được ép bằng `serviceOrderId` unique.

**Tổng tiền lưu sẵn trên `service_orders`** (`laborTotal`, `partsTotal`, `discount`, `total`)
thay vì tính lại từ các dòng mỗi lần đọc — danh sách lệnh và báo cáo doanh thu phải đọc được
tổng mà không join 2 bảng con. Đổi lại: **mọi hàm thêm/sửa/xoá dòng phải cập nhật lại 4 cột này
trong cùng một `db.transaction()`**. Đây là ràng buộc bắt buộc, không phải tuỳ chọn.

**`vehicles.nextServiceAt` / `nextServiceOdometer` tính sẵn lúc đóng lệnh**, không suy ra lúc
chạy. Quy tắc "nhắc bảo dưỡng" phải trả lời được *"xe nào tới hạn"* bằng một câu `WHERE`, chứ
không quét toàn bộ lịch sử dịch vụ mỗi lần chạy.

**`automation_rules` có 3 cột ngưỡng riêng** (`thresholdQty` / `thresholdDays` / `thresholdKm`),
mỗi loại quy tắc dùng đúng một cột. Một cột `threshold` chung sẽ tiết kiệm 2 cột nhưng không
ai đọc nổi `threshold = 500` nghĩa là 500 cái, 500 ngày hay 500 km.

### 4.3 Vòng đời lệnh sửa chữa

```
received → diagnosing → quoted → approved → in_progress → completed → delivered
                                     └──────── cancelled ────────┘
```

Định nghĩa ở `src/server/domain.ts` (`SERVICE_ORDER_STATUSES`) cùng nhãn tiếng Việt. Trạng
thái được đọc ở ít nhất 4 nơi (danh sách lệnh, bảng điều xưởng, báo cáo, quy tắc tự động) —
gõ sai một chữ ở một chỗ là mất bản ghi khỏi bộ lọc mà không lỗi nào nổ ra, nên tất cả phải
lấy từ hằng số chung.

`ACTIVE_ORDER_STATUSES` = các trạng thái coi là "xe đang nằm trong xưởng", dùng cho KPI.

## 5. Phân quyền

3 cấp trên `users.role`: `staff` < `manager` < `admin`.

- `src/server/session.ts`: `getSessionUser()` (đọc cookie → verify → tra DB),
  `requireRole(min)` so sánh theo `ROLE_RANK`, kèm `requireUser/requireManager/requireAdmin`.
- `role: "admin"` dành cho đội dev — `ASSIGNABLE_ROLES = ["staff", "manager"]` là tập role duy
  nhất API quản lý tài khoản được phép gán. Khách hàng không tự tạo thêm admin từ UI.
- Tài khoản demo luôn được `seedDemoUser()` đảm bảo là `admin` (tự backfill nếu đã tồn tại từ
  trước) — đây là tài khoản chủ duy nhất để vào được khu quản trị lần đầu.
- **Kiểm tra quyền phải nằm trong từng Route Handler**, không dựa vào `proxy.ts`.

### 5.2 "Luồng" giao diện (bổ sung 19/08/2026) — khác hẳn role

`role` cấp **quyền** (được làm gì); `flow` chọn **bộ tính năng hiển thị** cho 3 kiểu người
dùng thật: quản lý (đủ tính năng), kế toán (chỉ Hoá đơn + Báo cáo doanh thu), KTV (chỉ Chấm
công + Khu vực nhận việc + Báo cáo công việc). Hai khái niệm tách nhau vì một quản lý có thể
đồng thời làm kế toán, nhưng vẫn cần thấy đủ mọi thứ.

`resolveUserFlow()` (`src/server/session.ts`): `role !== "staff"` → luôn `"manager"`. Với
`role === "staff"`: tra `users.employeeId` → nhân sự liên kết → chức vụ `"Kế toán"` /
`"Kỹ thuật viên"` cho ra flow tương ứng; không liên kết hoặc chức vụ khác → mặc định
`"manager"` (giữ hành vi cũ, tài khoản staff có sẵn không đột nhiên mất tính năng).

**Không phải hàng rào bảo mật** — giống `proxy.ts`, đây là điều hướng UI. `Sidebar.tsx` (client,
tự gọi `/api/auth/me` lấy `flow`) chỉ đổi menu hiển thị; hầu hết API phía sau (`invoices`,
`reports`...) vẫn nhận mọi `requireUser()`. Trang **Tài khoản** (`/dashboard/accounts`,
admin-only qua `requireAdmin()`) là nơi DUY NHẤT gán `employees` ↔ `users` — API
`PATCH /api/users/[id]` chặn gán trùng 1 nhân sự cho 2 tài khoản (kiểm tra thủ công, không
có ràng buộc `unique` ở DB vì `employeeId` vẫn hợp lệ khi `null`).

**Chấm công** (`attendance_logs`, bảng mới) là vào ca/ra ca đơn giản theo `employeeId`, **không**
gắn với lệnh sửa chữa cụ thể — khác `service_order_labors.actualMinutes` là giờ công của từng
dòng việc. Ràng buộc "mỗi nhân sự tối đa 1 ca đang mở" ép ở `store/attendance.ts`
(`getOpenAttendance()` trước khi `clockIn()`), không ép được bằng SQL thuần.

**"Khu vực nhận việc"** chỉ đọc (`listLaborsForTechnician()` trong `serviceOrders.ts`, câu
truy vấn DUY NHẤT trong file đó xuyên nhiều lệnh thay vì xoay quanh 1 lệnh) — quyết định nghiệp
vụ: KTV xem việc được giao, không tự nhận việc chưa gán ai. Cập nhật trạng thái/giờ công tái
dùng thẳng `PATCH /api/service-orders/[id]/labors/[laborId]` đã có sẵn (route đó chỉ yêu cầu
`requireUser()`, không giới hạn theo `technicianId` — KTV kỹ thuật có thể sửa dòng công của
người khác nếu tự gọi API trực tiếp; UI không cho làm việc đó, nhưng đây không phải hàng rào
cứng, ghi nhận như một giới hạn đã biết).

**Tổng hợp giờ công để tính lương (bổ sung 20/08/2026).** Trang "Chấm công" của KTV chỉ tự
phục vụ (xem ca của chính mình) — tổng hợp giờ công của TOÀN BỘ nhân sự để tính lương nằm ở
trang riêng `/dashboard/staff-attendance` (`GET /api/attendance/summary?period=day|week|month`,
`getAttendanceSummary()` trong `store/attendance.ts`). Quyết định nghiệp vụ (20/08/2026): **cả
kế toán lẫn quản lý** đều xem được (không phải chỉ 1 bên), và trang **chỉ hiện giờ công**, không
tự nhân với `employees.hourlyCost` ra số tiền — quy tắc lương thật (thưởng, phụ cấp, trừ phạt)
có thể phức tạp hơn phép nhân đơn thuần, để người tính tay dựa trên số giờ này an toàn hơn tự
tính sẵn rồi sai.

Khác `resolveUserFlow()` (chỉ đổi MENU hiển thị, không phải hàng rào), endpoint này có gác
thật: `requirePayrollViewer()` trong `session.ts` — cho qua nếu `role !== "staff"` (mọi
manager/admin), hoặc `role === "staff"` NHƯNG `resolveUserFlow()` ra đúng `"accountant"`.
Cố ý **không** dùng nguyên `resolveUserFlow() !== "technician"`: một tài khoản `staff` chưa
liên kết nhân sự cũng rơi vào flow `"manager"` (mặc định để không mất menu), nhưng không nên
vì vậy mà xem được giờ công của mọi người — dữ liệu chấm công nhạy cảm hơn menu.

Bẫy đã dính lúc viết câu SQL: tính `clockedInNow` (đang trong ca) bằng
`bool_or(clockOutAt is null)` sau một `LEFT JOIN` — nhân sự CHƯA TỪNG chấm công lần nào cũng
báo "đang trong ca", vì `LEFT JOIN` không khớp dòng nào thì cột đó cũng là `NULL`, và
`NULL is null` = true. Sửa bằng cách tách hẳn thành truy vấn riêng (không lọc theo kỳ báo cáo,
vì trạng thái "đang trong ca" phải là thật ngay lúc xem, không phải trong khung thời gian đã
chọn) rồi merge ở code, thay vì gộp chung 1 câu.

## 6. Xử lý lỗi API

`src/server/api.ts` cung cấp `apiError()` + các shortcut (`badRequest`, `unauthorized`,
`forbidden`, `notFound`, `conflict`) và wrapper `handle()`. Mọi Route Handler bọc thân hàm
trong `handle()` để lỗi ngoài dự kiến vẫn trả JSON `{ message }` đúng định dạng, thay vì trang
HTML 500 mặc định của Next — phía client parse JSON gặp HTML là nổ tiếp một lỗi thứ hai che
mất lỗi gốc. (ANSER v2 để mỗi route tự viết, và không có wrapper — hạn chế đã ghi nhận.)

## 7. Khởi động & seed

`src/instrumentation.ts` chạy một lần lúc server khởi động, gọi tuần tự (tất cả idempotent):

1. `seedDemoUser()` — tài khoản `demo@anser.auto` / `demo1234`, role `admin`.
2. `ensureDefaultBranch()` — tạo "Gara trung tâm" nếu chưa có chi nhánh nào.
3. `seedInitialData()` — 8 hạng mục dịch vụ, 7 phụ tùng, 5 nhân sự, 3 quy tắc tự động
   (chỉ seed khi bảng tương ứng đang rỗng).
4. `ensureCompanySettingsRow()` — tạo dòng cấu hình singleton.

## 8. Tự động hoá qua n8n

9 workflow trong `frontend/n8n-workflows/` (import thủ công qua n8n UI — xem README trong đó; hai bản tin gộp thêm ngày 17/09/2026, xem mục 11.3):
cảnh báo phụ tùng sắp hết, nhắc bảo dưỡng định kỳ, nhắc lịch hẹn, báo tiến độ sửa chữa, báo
cáo doanh thu.

### 8.1 Hai chiều giao tiếp

**n8n → app**: các endpoint `GET /api/n8n/internal/*` — `branches`, `low-stock`,
`due-for-service`, `appointments`, `revenue`. Trả JSON **snake_case** (phía tiêu thụ là biểu
thức trong n8n UI, không phải code TypeScript).

**app → n8n**: `triggerN8nWebhook()` — fire-and-forget, bọc try/catch, **không throw**: n8n tắt
không được làm hỏng luồng tiếp nhận xe. `notifyOrderStatusChanged()` là wrapper nghiệp vụ trên
nó, gọi từ `PATCH /api/service-orders/[id]` **sau khi commit đổi trạng thái**, không gọi trong
transaction — webhook chậm/lỗi không được giữ transaction mở hay làm rollback việc đã ghi
xong. Báo khách ở 3 mốc: `quoted`, `awaiting_acceptance` (không phải `completed` — xem mục
8.5), `delivered`.

### 8.2 Endpoint nội bộ có token, khác v2

ANSER v2 để `/api/n8n/internal/*` mở hoàn toàn ("n8n gọi server-to-server nên không cần
cookie"). Ở đây không được: dữ liệu trả về gồm tên, SĐT và email khách hàng. `checkInternalToken()`
(`src/server/internalAuth.ts`) áp quy tắc:

| `N8N_INTERNAL_TOKEN` | development | production |
|---|---|---|
| có | bắt buộc khớp header `X-Internal-Token` | bắt buộc khớp |
| trống | cho qua (import workflow là chạy được ngay) | **503** — thiếu cấu hình phải nổ ra, không được âm thầm thành endpoint công khai |

### 8.3 Hai quyết định trong workflow

**Thư nhắc gửi thẳng cho khách, kèm bản tổng hợp cho gara.** Khách không có email thì thư tự
động không tới được — nên endpoint trả `contactable` / `contactable_count`, và bản tổng hợp có
cột chỉ rõ khách nào phải gọi điện. Để những ca đó im lặng biến mất là cách chắc chắn nhất để
mất lịch hẹn mà không ai biết vì sao.

**Chỉ báo tiến độ ở 3 mốc** (`quoted`, `awaiting_acceptance`, `delivered` — xem mục 8.5), không
báo mọi lần đổi trạng thái — spam khách bằng `received → diagnosing` là cách nhanh nhất để
email của gara bị chặn.

**Giờ hẹn được format ở server** theo `Asia/Ho_Chi_Minh` (`scheduled_at_text`), không để node
Code trong n8n tự format: container n8n có thể chạy timezone khác, và email báo sai giờ hẹn còn
tệ hơn không gửi email nào.

### 8.4 Xem/tải mẫu workflow ngay trong UI (bổ sung 15/08/2026)

Trước đây muốn import workflow phải tự vào thư mục `n8n-workflows/` trên máy — không ai làm
việc đó nếu không phải người vừa code phần mềm. Trang **Tự động hoá** giờ có nút "Xem mẫu n8n"
ở mỗi quy tắc: mở modal xem nội dung JSON, sao chép, hoặc tải file `.json` để import thẳng vào
n8n UI (Workflows → Import from File).

File phục vụ tĩnh tại `public/n8n-templates/*.json`, **sinh tự động** từ
`n8n-workflows/*.json` bởi `scripts/sync-n8n-templates.mjs` — chạy qua hook `predev`/`prebuild`
trong `package.json` nên hai nơi không lệch nhau. `n8n-workflows/` vẫn là nguồn thật; sửa
workflow thì sửa ở đó, không sửa trong `public/` (bị ghi đè ở lần `dev`/`build` kế tiếp,
và thư mục này nằm trong `.gitignore`). Dùng file tĩnh thay vì một API route vì nội dung
không phụ thuộc dữ liệu người dùng hay phiên đăng nhập — không có lý do phải qua server mỗi lần.

**Lưu ý bảo mật khi thêm nội dung vào các file này:** `public/n8n-templates/*.json` là file
tĩnh, **không** đi qua `proxy.ts` (matcher chỉ chặn `/dashboard/:path*`) — bất kỳ ai chạm được
server đều tải được, không cần đăng nhập. Vì vậy các node HTTP Request trong workflow giữ
placeholder `REPLACE_WITH_N8N_INTERNAL_TOKEN` thay vì giá trị thật; token thật chỉ dán tay vào
trong n8n UI sau khi import, không bao giờ được bake vào file JSON nguồn.

### 8.4.1 Sự cố đã gặp: hai project Compose cùng tên "frontend"

Lúc bật Docker thật lần đầu (15/08/2026), `docker compose up -d` ở đây đã **vô tình xoá và
tạo lại** container n8n/MailHog của dự án anh em `ANSER-web-v2/frontend` (`anser-web-n8n`,
`anser-web-mailhog`). Nguyên nhân: Compose mặc định lấy tên project từ **tên thư mục chứa file
compose**, và cả hai thư mục đều tên `frontend` — nên cả hai bị Compose coi là *cùng một
project*. File compose chạy sau thấy container đã có nhưng cấu hình (`container_name`, volume)
lệch với file của nó, nên **recreate** (dừng + xoá container cũ, tạo container mới) để khớp.
Dữ liệu không mất (volume `frontend_anser_web_n8n_data` không bị xoá, chỉ bị tách khỏi
container), nhưng container thật đã bị dừng ngoài ý muốn — đã khôi phục bằng cách chạy lại
`docker compose -p frontend up -d` từ đúng thư mục `ANSER-web-v2/frontend` để nó gắn lại đúng
volume cũ.

**Cách chặn vĩnh viễn**: `docker-compose.yml` ở đây giờ có khai `name: anser_auto` ở đầu file —
ép Compose dùng tên project cố định, không suy ra từ tên thư mục nữa. `ANSER-web-v2/frontend`
hiện chưa có khai tương tự; nếu còn đụng lại, thêm `name: anser_web` bên đó (không tự sửa từ
phía dự án này — thuộc project khác).

### 8.4.2 Sự cố đã gặp: API key thiếu scope `workflow:activate`/`workflow:deactivate`

Lúc tạo `N8N_API_KEY` cho app (15/08/2026), scope được chọn theo suy đoán hợp lý —
`workflow:update` tưởng đã bao gồm cả việc bật/tắt workflow. **Sai**: bản n8n đang dùng
(2.20.x) tách bật/tắt thành 2 scope riêng, tên khác hẳn: `workflow:activate` và
`workflow:deactivate` (xác nhận qua `GET /rest/api-keys/scopes` khi đăng nhập bằng tài khoản
owner — đây là nơi duy nhất liệt kê đúng tên scope, Public API docs không liệt kê rõ). Thiếu 2
scope này khiến `activateN8nWorkflow()`/`deactivateN8nWorkflow()` trong `n8nApi.ts` — tức là
mọi lần bấm công tắc bật/tắt ở trang Tự động hoá — bị n8n trả **403 Forbidden**, dù các lệnh
đọc (`workflow:read`, `workflow:list`) vẫn chạy bình thường (nên `n8nConfigured` vẫn `true`,
dễ gây hiểu lầm là đã cấu hình đúng).

**Đã sửa**: thêm 2 scope còn thiếu vào đúng API key đang dùng (không đổi giá trị key, không
cần sửa `.env.local`). Nếu tạo lại `N8N_API_KEY` từ đầu sau này, scope tối thiểu cho app là:
`workflow:read`, `workflow:update`, `workflow:list`, `workflow:activate`, `workflow:deactivate`,
`execution:list`, `execution:read`, `credential:list`.

**Lưu ý riêng cho Public API (`/api/v1/...`) của bản n8n này**: có 2 khái niệm dễ nhầm —
`workflow:publish`/`workflow:unpublish` (liên quan tới tính năng "phiên bản workflow", **không**
gán được cho API key cá nhân — n8n trả `"Invalid scopes for user role"` nếu thử) khác hẳn
`workflow:activate`/`workflow:deactivate` (gán được, dùng đúng cho action bật/tắt qua
`/api/v1/workflows/:id/activate`). Việc **activate qua Public API với API key** hoạt động bình
thường một khi có đúng scope — không cần phiên đăng nhập nội bộ như lúc import lần đầu (lúc đó
lỗi 403 là do dùng key tạm thiếu đúng 2 scope này, không phải do giới hạn của Public API).

## 8.5 Nghiệp vụ thật của gara 2 xưởng (bổ sung 13/08/2026)

`ANSER Auto` là phần mềm thật cho gara của gia đình người dùng: 1 xưởng chính (sửa máy,
động cơ) + 1 xưởng phụ (sơn, gò, hàn). Ba khoảng lệch giữa thiết kế ban đầu và nghiệp vụ
thật đã được hỏi lại và cài đặt:

**Dòng công gán riêng xưởng, lệnh vẫn chỉ có một.** Xe tai nạn cần cả 2 xưởng không tách
thành 2 lệnh — `service_order_labors` có thêm cột `branchId` (nullable, khác
`serviceOrders.branchId` là xưởng *tiếp nhận*). Không truyền khi thêm dòng công thì tự điền
bằng xưởng tiếp nhận (`addLabor()`); gara chỉ có 1 xưởng thì cột này im lặng không hiện trên
UI (`showLaborBranch = branches.length > 1`).

**Phụ tùng đặt ngoài là một luồng riêng, không tái dùng `serviceOrderParts`.** Bảng mới
`service_order_special_orders` theo dõi vòng đời `ordered` (đã đặt, giá có thể chưa rõ) →
`arrived` (hàng về, có giá vốn thật) → `billed` (đã chuyển thành 1 dòng `serviceOrderParts`,
tính vào hoá đơn) hoặc `cancelled`. **Không tính vào tổng tiền lệnh cho tới khi `billed`** —
báo giá cho khách không được gồm phụ tùng còn "chưa chắc đặt được". Khác `addPart()` (xuất
từ tồn kho có sẵn, trừ kho ngay), luồng này **không đụng `parts.stock`** — hàng không thuộc
kho gara. `store/specialOrders.ts` có `createSpecialOrder → markArrived → billSpecialOrder`
(hoặc `cancelSpecialOrder` ở bất kỳ bước nào trước `billed`).

**"Chờ nghiệm thu" là trạng thái duy nhất lùi được.** Thêm `awaiting_acceptance` vào
`SERVICE_ORDER_STATUSES`, giữa `completed` và `delivered`. Khách nghiệm thu không đồng ý là
tình huống có thật (không phải giả định) — lùi về `in_progress` qua `REVERTIBLE_FROM`, giữ
nguyên toàn bộ dòng công/phụ tùng đã có. `notifyOrderStatusChanged()` đổi mốc báo khách từ
`completed` sang `awaiting_acceptance`: "hoàn tất" chỉ là xưởng xong việc kỹ thuật,
"chờ nghiệm thu" mới là lúc mời khách tới. API `PATCH /api/service-orders/[id]` chặn mọi
bước nhảy cóc (`validateTransition()` trong route — chỉ cho đi tiếp đúng 1 bước theo
`SERVICE_ORDER_STATUSES`, lùi đúng bước đã khai trong `REVERTIBLE_FROM`, hoặc huỷ).

## 9. Quy tắc nghiệp vụ đã cài đặt

Những ràng buộc dưới đây được ép ở tầng store, không phải chỉ ở UI — API gọi thẳng cũng
không lách được.

| Quy tắc | Nơi ép | Vì sao |
|---|---|---|
| Thêm phụ tùng vào lệnh làm 4 việc trong 1 transaction: trừ kho, ghi phiếu xuất, thêm dòng, tính lại tổng | `serviceOrders.addPart()` | Thiếu bước nào cũng lệch sổ: trừ kho không có dòng thì hàng biến mất không ai trả tiền |
| Khoá dòng `parts` bằng `SELECT ... FOR UPDATE` khi xuất | `addPart()`, `createPartTransaction()` | Hai lệnh cùng lấy 1 mã tồn 5, cùng trừ 3, phải ra lỗi chứ không ra âm 1 |
| Bỏ dòng phụ tùng → trả hàng về kho + ghi phiếu nhập đối ứng | `serviceOrders.removePart()` | Phiếu xuất ghi việc đã xảy ra; xoá nó đi là sửa lịch sử |
| Lệnh `delivered`/`cancelled` không sửa được nội dung | `assertUnlocked()` | Sửa lệnh đã xuất hoá đơn làm doanh thu đã báo cáo lệch |
| Mã `RO-`/`HD-` sinh bằng Postgres sequence | `store/codes.ts` | `count(*)+1` có race condition — đúng chỗ ANSER v2 đã dính |
| Biển số chuẩn hoá trước khi lưu/tra cứu | `vehicles.normalizePlate()` | `30A-123.45` và `30a 12345` là một xe; không chuẩn hoá thì unique vô dụng |
| Số km chỉ được tăng, không lùi | `createServiceOrder()` | Gõ thiếu một chữ số không được phá mốc bảo dưỡng theo km |
| Mốc bảo dưỡng đặt khi giao xe, theo chu kỳ trong Cài đặt | `applyMaintenanceMilestone()` | Tính sẵn để quy tắc nhắc lịch chỉ cần một câu `WHERE` |
| Thuế tính trên số **sau** giảm giá | `invoices.createInvoice()` | Tính trên số trước giảm là thu thuế phần khách không trả |
| Trạng thái thanh toán suy ra từ số tiền | `derivePaymentStatus()` | Chọn tay là mở cửa cho "đã thanh toán" mà thu 0đ |
| `recordPayment` nhận số **luỹ kế**, không phải số cộng thêm | `invoices.recordPayment()` | Gửi lại cùng request (mạng chập, bấm đúp) không được cộng tiền hai lần |
| 1 lệnh ↔ tối đa 1 hoá đơn | unique trên `invoices.serviceOrderId` | |
| Xe/phụ tùng đã có lịch sử thì không xoá được | route `DELETE` tương ứng | Xoá sẽ cascade mất lịch sử, không lấy lại được |
| Đổi trạng thái lệnh chỉ đi tiếp 1 bước, lùi đúng bước đã khai, hoặc huỷ | `validateTransition()` trong route `PATCH /api/service-orders/[id]` | Nhảy cóc (vd "đã tiếp nhận" → "đã giao xe") là một việc thật chưa chắc đã làm |
| Đặt hàng ngoài không tính vào tổng lệnh tới khi `billed` | `store/specialOrders.ts` | Báo giá cho khách không được gồm phụ tùng "chưa chắc đặt được" |
| Đặt hàng ngoài không trừ `parts.stock` | `billSpecialOrder()` | Hàng không thuộc kho gara, không phải hàng tồn có sẵn |

## 10. Việc cần làm tiếp

Mười mục của bảng cũ (xoá tài khoản, xác nhận n8n chạy đúng giờ, ngưỡng không được workflow
đọc, zod, rate-limit, index, gộp truy vấn Tổng quan, in hoá đơn, trang Chi nhánh, tìm kiếm +
chuông) đều đã làm trong đợt 17/09/2026 — xem mục 11. Còn lại:

| Việc | Ghi chú |
|---|---|
| Dọn dữ liệu thật trước go-live | Là việc của người vận hành, không phải code: chạy `npm run data:clean-demo --apply`, đổi email + mật khẩu 3 tài khoản `@anser.auto`, điền thông tin doanh nghiệp, đặt tên có dấu cho "Xuong son go han", đặt ngưỡng tồn 0 cho vật tư đặt theo xe. Trang **Kiểm tra vận hành** liệt kê đúng những việc này và tự hết khi xong. |
| 781 phụ tùng chưa có giá bán | Công cụ đã có (Nhập giá hàng loạt), số liệu thì chưa. Đuôi "G3.000" trong tên là **giá nhập**, không phải giá bán (đã đo: trung vị G/giá vốn = 1,00) — đừng điền từ đó. `npm run data:name-prices` đề xuất điền giá vốn cho 105 mã còn trống và gỡ đuôi giá khỏi 600 tên trước khi in hoá đơn. |
| zod cho 24 route còn lại | Khách hàng, xe, dịch vụ, nhân sự, lịch hẹn, hoá đơn, chấm công vẫn validate thủ công. Mẫu và helper đã có (`validation.ts`); chú ý bẫy `.optional()` bọc ngoài cho lược đồ PATCH. |
| Bảo hiểm chi trả một phần | Hoá đơn có `insuranceAmount` nhưng sổ bán hàng (nguồn thật: phần lớn khách là công ty bảo hiểm) không nối được với lệnh sửa chữa — dữ liệu gốc không có biển số. Khi gara bắt đầu lập lệnh trong app, cân nhắc thêm `salesLedger.invoiceId` để đối chiếu. |
| Cột "tiền thuế được giảm" trong sổ | 213/232 chứng từ bán có tổng thấp hơn tiền hàng 0,6%/0,2% theo phương pháp trực tiếp. Hiện chỉ giải thích trong form; nếu cần khai thuế từ app thì phải có cột riêng thay vì suy ngược. |
| Rate-limit cho các endpoint ghi khác | Mới có ở `/api/auth/login`. Import Excel (5 MB, parse ở server) là ứng viên tiếp theo. |
| Xác nhận n8n tự chạy theo lịch thật | Cơ chế đã có (nhịp tim + nguồn chạy), nhưng tới lúc viết, Docker trên máy dev đang tắt nên chưa có lần nào ghi nhận nguồn `schedule`. Cần bật n8n, import lại 9 workflow, đợi qua một mốc giờ. |
| Test tự động | Chưa có bộ test nào. Các phép kiểm tra trong đợt này đều chạy tay (curl, script Node, Chrome DevTools). Ứng viên đầu tiên: `vndToWords` (21 ca đã liệt kê trong commit bd66fc2), `belowThresholdSql`, `planPartsImport`. |

## 11. Đợt rà soát 17/09/2026 — những gì đã đổi và vì sao

Đọc mục này khi thấy code không giống mô tả ở các mục trên. Mỗi dòng là một quyết định, lý do
nằm ở chú thích ngay trong file được nhắc tới.

### 11.1 Bảo mật

| Đã đổi | Vì sao | Ở đâu |
|---|---|---|
| `POST /api/auth/register` chỉ mở khi DB chưa có tài khoản, hoặc `ALLOW_PUBLIC_REGISTER=true` | Trước đây mở hoàn toàn: ai cũng tạo được tài khoản `staff`, mà 44/51 route chỉ cần `requireUser()`. Deploy là mất sạch dữ liệu. | `api/auth/register/route.ts` |
| Bỏ `seedDemoUser()`, thay bằng `seedBootstrapAdmin()` đọc từ env | Bản cũ tạo admin `demo1234` ở mọi lần khởi động và tự nâng lại quyền — cửa hậu không đóng được. | `store/users.ts` |
| Gỡ 3 cặp email/mật khẩu khỏi `login/page.tsx` | File client: mật khẩu đi vào bundle gửi cho mọi trình duyệt. Nay đọc `NEXT_PUBLIC_DEV_QUICK_ACCOUNTS`, chỉ ngoài production. | `login/page.tsx` |
| `users.mustChangePassword` + chặn ở `requireUser()` + cờ `mcp` trong JWT cho `proxy.ts` | Mật khẩu tạm đi qua điện thoại/tin nhắn. Chặn ở API chứ không chỉ UI; nhét cờ vào token để proxy không phải hỏi DB mỗi request. | `session.ts`, `auth.ts`, `proxy.ts`, `/doi-mat-khau` |
| Rate-limit đăng nhập bằng bảng `login_attempts` | Đếm trong RAM sai khi nhiều instance / serverless. 5 lần/email, 20 lần/IP, 15 phút. Kiểm tra TRƯỚC khi chạm bcrypt. | `loginThrottle.ts` |
| zod + `parseBody()` | `Number(x) \|\| 0` biến chữ thành 0đ, `.trim()` trên số là 500, không route nào chặn số âm. | `validation.ts` |

### 11.2 Dữ liệu và sổ sách

| Đã đổi | Vì sao | Ở đâu |
|---|---|---|
| 41 index | DB thật không có index nào ngoài PK/unique. | migration 0006 |
| `formatDate` có `timeZone` | Chạy phía server trên máy UTC thì mốc 00:00–07:00 giờ VN lùi một ngày. **Không** ảnh hưởng chứng từ sổ (lưu 00:00Z) — đã đo cả 12 tháng. | `lib/format.ts` |
| Font Be Vietnam Pro + JetBrains Mono | Geist không có subset `vietnamese`; "ă", "ễ" rơi về font hệ thống ngay giữa một từ. | `app/layout.tsx` |
| Không ép `trước thuế + VAT = tổng` trong sổ | 213/232 chứng từ bán không thoả: gara nộp thuế GTGT theo phương pháp trực tiếp, VAT = 0, tổng thấp hơn đúng 0,6%/0,2%. Dữ liệu gốc đúng. | `ledgerSchemas.ts` |
| Lược đồ PATCH suy từ tầng gốc không `.default()` | zod 4: `.partial()` KHÔNG bỏ default — PATCH chỉ sửa tên sẽ đặt tiền về 0. Đã chạy thử. | `ledgerSchemas.ts` |
| `optionalUuid.optional()` trong PATCH | Helper biến "không gửi" thành `null`; thiếu lớp `.optional()` ngoài là gỡ liên kết nhân sự mỗi lần đặt lại mật khẩu. Đã chạy thử. | `validation.ts` (ghi chú BẪY), `api/users/[id]` |
| Tồn đầu kỳ khi import Excel đi qua phiếu nhập | Quy tắc xuyên suốt: mọi biến động tồn có lịch sử. Script cũ ghi thẳng, nên 788 phụ tùng chỉ có 1 phiếu kho. | `partsImport.ts` |
| Đuôi "G3.000" trong tên phụ tùng là giá nhập | 495 mã có cả hai: tỷ lệ G/giá vốn trung vị 1,00. Giả thuyết "G là giá bán" sai. | `scripts/extract-name-prices.mjs` |

### 11.3 Tự động hoá

| Đã đổi | Vì sao | Ở đâu |
|---|---|---|
| Endpoint `/internal/*` đọc ngưỡng từ DB; URL chỉ có tác dụng kèm `override=1` | Workflow truyền cứng `?days=7&km=500`; sửa trên app vô hiệu. Workflow cũ tự theo ngưỡng mới, không phải import lại. | `automation/rules.ts` |
| Quy tắc tắt → endpoint trả `{ skipped, count: 0 }` | Công tắc trong app trước đây chỉ là cờ DB; workflow n8n vẫn gửi. Đã đối chiếu node Code của từng workflow để chắc chúng dừng gửi mà không nổ. | `automation/rules.ts` |
| `last_run_at/status/summary/source` ghi bởi chính endpoint + nhịp tim cuối workflow | Trả lời "lịch có tự nổ không" từ trong app. Header `X-Anser-Trigger` dùng `$execution.mode` để phân biệt lịch với bấm tay; nguồn `unknown` (curl) **không** được ghi. | `automation/rules.ts`, `/internal/heartbeat` |
| `belowThresholdSql()`: ngưỡng 0 = không cảnh báo | Điều kiện cũ `stock <= coalesce(min_stock, 5)` cho `0 <= 0` là đúng — đặt ngưỡng 0 vẫn kêu. Mô phỏng trên DB thật: 588 → 1 dòng. | `store/parts.ts` |
| PATCH quy tắc luôn ghi DB, đồng bộ n8n là phụ | Bản cũ gọi n8n trước, n8n lỗi thì không ghi — Docker tắt là không tắt được cảnh báo từ app. Chỉ quản lý được sửa. | `api/automation/rules/[id]` |
| Hai bản tin gộp `morning_brief`, `accounting_digest`, nội dung dựng trong app | Thay bộ 10 workflow đã revert (10 endpoint gần trùng, 4–5 email/ngày). Nội dung email là nghiệp vụ → nằm trong git, có escape HTML. | `automation/digests.ts` |
| Bộ lập lịch nội bộ + bảng `notifications` | Docker tắt = không cảnh báo nào tới ai. Chuông trong app chỉ hỏng khi chính app hỏng. Chống trùng bằng unique `dedupe_key`. | `automation/cron.ts`, `/api/cron/automation`, `vercel.json` |
| Quy tắc không có dòng cấu hình coi là BẬT | DB thật chỉ có 5/7 loại; coi "không có" là "tắt" làm workflow doanh thu im bặt. | `automation/rules.ts` |

### 11.4 Cách đã kiểm tra

Không có test tự động. Mỗi thay đổi được thử theo một trong các cách sau, ghi trong commit tương
ứng: gọi API bằng curl với payload đúng hình dạng UI gửi; script Node chạy thẳng hàm (ví dụ 21
ca `vndToWords`, lược đồ zod với `--experimental-strip-types`); mô phỏng SQL trên DB thật mà
không ghi (ngưỡng tồn, bộ lọc ngày 12 tháng); và Chrome DevTools MCP mở trang thật để bấm, chụp,
đọc console và chạy Lighthouse (bắt được 4 lỗi giao diện mà curl không thấy). Đo hiệu năng
trước/sau trên cùng DB: Tổng quan ~8s → ~0,34s.
