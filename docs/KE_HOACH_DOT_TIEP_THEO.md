# ANSER Auto — Kế hoạch đợt tiếp theo

**Ngày:** 24/09/2026 · **Dự án:** ANSER Auto (phần mềm quản lý gara ô tô, 2 xưởng, 6 người)
**Repo:** `PCBoiz/ANSER_auto_fix` nhánh `main` · **Trạng thái:** chạy được, **chưa go-live**

> Tài liệu này để chuyển tiếp. Đọc mục 1–2 là nắm được vì sao làm; mục 3–7 là việc cụ thể.
> Bối cảnh hệ thống hiện tại: xem `docs/TONG_HOP_TU_DONG_HOA.md` (31 quy trình tự động đang có).

---

## 1. Tóm tắt

Hệ thống đã có đủ nghiệp vụ gara và một vòng lặp vận hành tự phát hiện — tự sửa — tự đóng
(219 test tự động). Nhưng **chưa có gì chạy thật**: DB thật đang có 0 lệnh sửa chữa, 0 khách,
0 xe, 0 hoá đơn. Mọi tự động hoá đã dựng hiện chạy trên không khí.

Đợt này làm 4 việc, theo đúng thứ tự dòng tiền của một xưởng sửa xe:

| # | Việc | Vì sao đáng làm |
|---|---|---|
| 0 | **Đưa lên VPS chạy 24/7** | Không có tiến trình sống liên tục thì không có lịch, không có sao lưu, không có cảnh báo. Và link báo giá gửi khách **bắt buộc** cần tên miền HTTPS |
| 1 | **Nhập 106 khách hàng từ Excel** | Không ai gõ tay 106 khách. Không có dữ liệu thì không ai dùng app, và không dùng thì mọi thứ còn lại vô nghĩa |
| 2 | **Rút ngắn thời gian xe nằm xưởng** | Khách duyệt báo giá qua link Zalo (thay vì gọi điện qua lại nhiều ngày) + cảnh báo xe kẹt ở một công đoạn quá lâu |
| 3 | **Đo năng suất bằng bấm giờ trên điện thoại** | Hiện số giờ công là **do thợ tự gõ tay**; chi phí nhân công chưa được tính ở bất kỳ đâu nên **không biết lãi thật của từng lệnh** |

Xen kẽ: củng cố hạ tầng (mục 6) và dùng công cụ Graphify để soi cấu trúc mã (mục 5).

**Nếu chỉ làm được một việc:** làm mục 0. Mọi thứ khác đều phụ thuộc vào nó.

---

## 2. Căn cứ — những gì khảo sát tìm ra

Hai đợt khảo sát mã nguồn (nghiệp vụ và hạ tầng) cho ra 4 khoảng trống, kèm bằng chứng:

| Khoảng trống | Bằng chứng trong mã |
|---|---|
| Không có gì chạy 24/7 | Docker Desktop trên máy dev hỏng, image chưa build thật lần nào, chưa có nhịp canh gác theo lịch nào được ghi nhận |
| Thời gian chết "chờ khách duyệt báo giá" không ai đo | `quoted → approved` là một cú bấm tay; không lưu ai duyệt, lúc nào, qua kênh nào. `service_orders` chỉ có 3 mốc thời gian (nhận xe, xong việc, giao xe) — **không có lịch sử chuyển trạng thái** |
| Năng suất thợ không đo được | `actualMinutes` do KTV tự gõ (`my-jobs/page.tsx`); `employees.hourlyCost` chỉ được nhập rồi để đó, chưa nhân với giờ ở bất kỳ đâu |
| Dữ liệu cũ chưa vào máy | Tìm thấy trong `~/Downloads`: `Danh_sach_khach_hang.xlsx` (**106 khách**, tiêu đề thật ở dòng 3: STT · Mã KH · Tên · Địa chỉ · Công nợ · MST · Điện thoại) và `Danh_sach_hang_hoa_dich_vu.xlsx` (**163 dòng**, có nhóm dịch vụ `DV*`). **Không có file xe nào** |

Ba phát hiện làm đổi thiết kế:

1. **Không có dữ liệu xe** → bỏ ý định "nhập xe từ Excel", xe nhập dần khi khách tới.
2. **File dịch vụ không có cột giá công** → nhập thẳng sẽ đẻ ra 163 hạng mục 0đ, lặp lại đúng vấn
   đề 781 phụ tùng 0đ đang chặn go-live. Đã kiểm chứng: ô chọn hạng mục khi lập lệnh gọi
   `/api/services?activeOnly=1`, nên **nhập ở trạng thái tắt là chặn được thật**.
3. **Sao lưu ra Google Drive bằng "thư mục đồng bộ" là giải pháp của Windows** — VPS Linux không
   có Google Drive for Desktop, phải đổi sang `rclone`.

Quyết định đã chốt với chủ gara: chạy trên **VPS thuê** · trang báo giá cho khách hiện **từng
dòng kèm đơn giá** · KTV bấm giờ bằng **điện thoại riêng** · quên bấm kết thúc thì **tự chốt cuối
ca và đánh dấu ngờ** · gửi khách bằng **link dán vào Zalo** (không dùng Zalo OA).

---

## 3. Giai đoạn 0 — Chạy thật 24/7 trên VPS

1. **VPS Ubuntu** 2 GB: cài Docker + compose plugin.
2. **Bí mật mới, không tái dùng bản dev:** đổi mật khẩu Neon; sinh mới `JWT_SECRET`,
   `N8N_INTERNAL_TOKEN`, `CRON_SECRET` → `frontend/.env.app`.
3. `npm ci && npm run db:migrate` (migration chạy ngoài image vì drizzle-kit là devDependency).
4. `docker compose --profile app up -d --build`. **Bỏ MailHog trên VPS**, dùng SMTP thật.
5. **Tên miền + HTTPS**: Caddy (5 dòng cấu hình, tự xin chứng chỉ) hoặc Cloudflare Tunnel.
   Chỉ mở app ra Internet — **không mở n8n**.
6. Đặt `APP_PUBLIC_URL`, `APP_URL_FOR_N8N=http://app:3000`, `INTERNAL_SCHEDULER=true`,
   `HEARTBEAT_URL` (healthchecks.io).
7. **Sao lưu ra ngoài máy:** `rclone sync` tới Google Drive của gara; `BACKUP_COPY_DIR` trỏ vào
   thư mục rclone quản lý.
8. Vào app → **Đồng bộ workflow** → quyết định bật/tắt 4 workflow gửi email cho khách.

**Kiểm chứng:** `curl https://<tên-miền>/api/health` trả `{"status":"ok"}` · healthchecks.io báo
**Up** · sáng hôm sau có file sao lưu trên Drive · chuông hết mục "Không liên lạc được với n8n".

Quy mô: vừa (khoảng một buổi). Cắt được nếu cần nhanh: Cloudflare Tunnel thay tên miền riêng.

---

## 4. Giai đoạn 1 — Đưa dữ liệu thật vào

**Khách hàng (106 dòng)** → bảng `customers`. Tái dùng nguyên khung nhập Excel đã có
(`frontend/src/server/partsImport.ts`: `normalizeHeader`, `buildColumnMap`, `parseNumber`,
`unwrapCell`, `readSheet`, `diffAgainstExisting`) và giao diện `dashboard/parts/import/page.tsx`.

- Thêm mới: **dò dòng tiêu đề** (file xuất từ phần mềm kế toán có tiêu đề gộp ở dòng 1, tiêu đề
  thật ở dòng 3) — hàm `findHeaderRow()`, có test.
- Ánh xạ: Tên → `name`; Điện thoại → `phone` (chuẩn hoá `0…`); Địa chỉ → `address`; MST →
  `taxCode`; `type = "company"` khi có MST hoặc tên chứa CÔNG TY/CTY/TNHH/CP.
- **Bỏ cột "Công nợ"**: công nợ đầu kỳ thuộc sổ kế toán, nhập vào hồ sơ khách là tạo một con số
  không ai đối chiếu được.
- Chống trùng: số điện thoại đã chuẩn hoá → tên bỏ dấu + MST. Xem trước rồi mới ghi.

**Dịch vụ (lọc mã `DV*` trong file 163 dòng)** → bảng `services` với `active = false`,
`laborPrice = 0`, kèm màn nhập giá hàng loạt theo mẫu `dashboard/parts/bulk`. Hạng mục chưa có giá
không hiện khi lập lệnh, nên không thể lọt vào lệnh thành dòng 0đ.

**Xe:** không có nguồn → nhập dần. **Nhà cung cấp (44 dòng):** app chưa có bảng nhà cung cấp,
để dành cho việc chuẩn hoá tên đối tác trong sổ mua.

File mới: `server/customerImport.ts` (+ test) · `api/customers/import` ·
`dashboard/customers/import/page.tsx`. Quy mô: vừa.

**Kiểm chứng:** xem trước ra đúng 106 dòng, 0 lỗi → ghi thật → đếm `customers` = 106 → chạy lại
lần hai ra 0 dòng mới.

---

## 5. Giai đoạn 2 — Rút ngắn thời gian xe nằm xưởng

### 5a. Lịch sử chuyển trạng thái + cảnh báo xe kẹt

- Bảng mới `service_order_events` (`orderId`, `fromStatus`, `toStatus`, `at`, `byUserId`, `note`),
  ghi trong chính transaction đổi trạng thái (`store/serviceOrders.ts — updateServiceOrder`).
  Bảng riêng vì lịch sử phải bất biến và `service_orders` chỉ giữ được 3 mốc.
- Module thuần mới `lib/stageWatch.ts`: ngưỡng theo từng trạng thái (ví dụ `diagnosing` 4 giờ làm
  việc · `quoted` 24 giờ · `approved` 8 giờ · `in_progress` 3 ngày) → trả về danh sách sự cố, tái
  dùng nguyên vòng đời `syncIncidents` (thêm loại `flow` vào `INCIDENT_KINDS`). Gọi trong
  `runWatchdog`. **Sự cố tự đóng khi xe nhích trạng thái.**
- Đưa thời gian trung bình mỗi công đoạn vào **báo cáo tuần cho chủ gara** (`buildOwnerWeekly`).
  Câu "xe nằm chờ duyệt báo giá trung bình 1,8 ngày" là thứ thay đổi hành vi.

### 5b. Khách duyệt báo giá qua link dán Zalo

Đáng tiền nhất, và cũng rủi ro nhất vì là trang công khai không cần đăng nhập.

- **Token:** JWT ký bằng `JWT_SECRET` sẵn có, payload `{ kind: "quote", orderId, v: quoteVersion }`,
  hạn **7 ngày**.
- **Thu hồi bằng phiên bản:** thêm `quote_version` + `quote_sent_at` vào `service_orders`. Sửa
  dòng công/phụ tùng/giảm giá sau khi gửi làm tăng version ⇒ **link cũ tự chết**, khách mở ra thấy
  "Báo giá đã thay đổi, liên hệ gara" thay vì một con số sai.
- **Trang công khai** `app/bao-gia/[token]/page.tsx` (nằm ngoài `proxy.ts`): tên gara, mã lệnh,
  biển số, **từng dòng công và phụ tùng kèm đơn giá + thành tiền**, giảm giá, tổng. Không hiện giá
  vốn, không có đường đi sang trang khác.
- **Phản hồi:** `POST /api/public/quote/[token]` `{ decision: "approve" | "decline", note? }`,
  rate-limit theo token + IP. Bảng mới `quote_responses` (`orderId`, `version`, `decision`, `at`,
  `ip`, `userAgent`, `note`) — **bằng chứng** khi giao xe có tranh cãi.
  - Đồng ý → chuyển `quoted → approved` (qua đúng `validateTransition` hiện có) + chuông cho cố vấn.
  - Từ chối → giữ nguyên trạng thái, mở sự cố kèm lý do khách ghi.
- **Nhân viên bấm hộ** (khách gọi điện): vẫn ghi vào `quote_responses` với `channel = "phone"` và
  người bấm — để mọi lần duyệt đều có dấu vết.
- **Nút "Gửi báo giá"** trên trang lệnh: sinh link, chép vào clipboard để dán Zalo.

| Rủi ro | Chặn thế nào |
|---|---|
| Dò token xem lệnh người khác | JWT có chữ ký, hạn 7 ngày, rate-limit theo IP, ghi log mọi lần mở |
| Giá đổi sau khi khách duyệt | `quote_version`: duyệt gắn với đúng phiên bản; đổi sau duyệt thì cảnh báo trên trang lệnh |
| Khách chối "tôi không bấm" | Lưu IP, user agent, thời điểm, phiên bản báo giá |
| Lộ dữ liệu qua trang công khai | Chỉ trả đúng 1 lệnh, không liên kết, không API tìm kiếm |

Quy mô: 5a nhỏ, 5b vừa–lớn. Cắt được: bỏ QR, bỏ ô ghi lý do từ chối.

---

## 6. Giai đoạn 3 — Bấm giờ trên điện thoại, đo năng suất

- Bảng mới `labor_time_entries` (`laborId`, `technicianId`, `startedAt`, `endedAt`,
  `source: app | auto-close | manual`, `suspect`, `note`). `actualMinutes` = tổng các khoảng, vẫn
  ghi lại vào cột cũ để báo cáo hiện có không vỡ.
- API `POST /api/technician/jobs/[laborId]/start|stop`. **Một người một việc**: bắt đầu việc mới
  thì tự kết thúc việc đang chạy.
- **Quên bấm kết thúc:** khi bấm ra ca, mọi khoảng đang chạy tự đóng tại giờ ra ca,
  `source = auto-close`, `suspect = true`. Không ra ca thì lượt canh gác nửa đêm đóng hộ và lên
  chuông cho quản lý.
- Module thuần `lib/productivity.ts`: hiệu suất = định mức ÷ thực tế; chi phí nhân công =
  `hourlyCost` × giờ. **Khoảng bị đánh dấu ngờ không được tính vào hiệu suất** (nhưng vẫn tính chi
  phí) — số ngờ không được làm đẹp báo cáo.
- Đầu ra: mục mới trong báo cáo tuần cho chủ gara + trang `work-report` của chính KTV.
- Giao diện `my-jobs`: hai nút to (Bắt đầu / Kết thúc), đồng hồ đang chạy, bỏ ô gõ tay số phút —
  chỉ quản lý sửa được, và mọi lần sửa đều ghi `source = manual`.

**Kiểm chứng:** bấm bắt đầu trên điện thoại thật → 2 phút → kết thúc → số phút ≈ 2; bắt đầu việc
khác → việc cũ tự đóng; bấm ra ca khi đang chạy → khoảng tự đóng và có cờ ngờ. Quy mô: vừa.

---

## 7. Củng cố hạ tầng (xen kẽ, không chặn ai)

| Việc | Vì sao | Ở đâu |
|---|---|---|
| Trang chi tiết lệnh chạy **7 truy vấn tuần tự (~1,7 giây)** | Trang dùng nhiều nhất cả ngày; gộp bằng `Promise.all` là sửa 10 phút | `store/serviceOrders.ts:210-257` |
| **Tầng chạm tiền/kho chưa có test nào** (4.835 dòng, 6 transaction) | Trừ tồn kho, hoàn kho, tính lại tổng tiền, lập hoá đơn — sai là mất tiền thật | Dùng `pglite` chạy đúng migration thật |
| Đo thời gian request + log một dòng JSON | Hiện không có cách nào biết route nào chậm, lỗi 500 bao nhiêu lần | `server/api.ts` — điểm log duy nhất của 65 route |
| Header bảo mật (`X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, HSTS) | Sắp có trang công khai cho khách | `next.config.ts` |
| Gộp upsert trong `syncIncidents`, gộp lô trong `bulkUpdateParts` | 724 dòng cảnh báo mỗi lượt; 781 UPDATE trong một transaction | `store/notifications.ts:121`, `store/parts.ts:116` |
| Cấu hình `Pool` Neon (`max`, timeout) | Đang để mặc định; chạy liên tục trên VPS sẽ lộ | `server/db/client.ts:18` |
| Index trigram cho 27 chỗ `ILIKE '%…%'` | **Chưa cần** với 106 khách / 788 phụ tùng — làm khi vượt 20k dòng | `server/search.ts` và 7 file `store/*` |

**Công cụ Graphify** (áp dụng để soi cấu trúc, không phải tính năng cho gara):
`uv tool install --python 3.12 graphifyy` → `graphify install` → `.graphifyignore` thêm
`graphify-out/`, `.next*/`, `public/n8n-templates/`, `*.xlsx` (`backups/` và `.env*` đã được
`.gitignore` loại sẵn) → chạy `/graphify .` có quét tài liệu. Kết quả **không commit**.
Dùng để trả lời đúng 4 câu: logic nghiệp vụ nào nằm nhầm trong component trang (9/15 file lớn
nhất là page, `orders/[id]/page.tsx` 1.094 dòng) · hàm/route nào không còn ai gọi · có phụ thuộc
vòng giữa `automation/*` và `store/*` không · `serviceOrders.ts` nên tách theo ranh giới nào.
Không gắn vào `pre-push` để không làm chậm việc push.

---

## 8. Không làm, và vì sao

| Không làm | Lý do |
|---|---|
| Zalo OA / ZNS gửi tự động | Cần doanh nghiệp xác thực, mất phí, duyệt từng mẫu tin. Link dán tay đạt 90% giá trị với 0 đồng |
| Hoá đơn điện tử (NĐ 123) | Chỉ đáng làm khi đã phát hành hoá đơn thật đều đặn |
| Tự tính lương từ chấm công | Đã là quyết định có chủ ý trong mã: quy tắc lương thật phức tạp, tính sai nguy hiểm hơn để người tính |
| Gợi ý đặt hàng theo tốc độ tiêu thụ | Chưa có một tháng dữ liệu xuất kho nào — đề xuất bây giờ là bịa |
| Tự gán việc cho KTV theo chuyên môn/tải | Xưởng 6 người, quản đốc nhìn là biết. Tự động ở đây tạo tranh cãi chứ không tiết kiệm |
| Dọn dẹp tách nhỏ component hàng loạt | Chỉ tách khi đụng tới, kèm test |

---

## 9. Kiểm chứng toàn đợt

1. `npm run check` xanh — git hook `pre-push` tự chạy trước mỗi lần push.
2. Mỗi quy trình tự động mới **phải** có mục trong `frontend/src/lib/automationCatalog.json` và
   chạy `npm run docs:automation`; test khoá ba chiều sẽ đỏ nếu quên.
3. Thử trên dữ liệu thật theo lối đã dùng các đợt trước: lệnh thử tạo bằng SQL với **mã tự đặt**
   (`RO-E2E-…`, không tốn số hoá đơn/lệnh thật), gọi API thật, xoá sạch sau khi kiểm tra, so
   sequence trước và sau.
4. Trang công khai: thử token hết hạn, sai chữ ký, phiên bản cũ, và 20 request/phút để xác nhận
   rate-limit chặn.
5. Sau khi lên VPS: `/api/health` 200 · healthchecks.io Up · có bản sao lưu trên Drive · một lệnh
   sửa chữa thật đi hết vòng từ tiếp nhận tới hoá đơn.

**Thứ tự đề xuất:** 0 → 1 → 5a → 5b → 6, mục 7 xen kẽ. Chạy Graphify ở đầu mục 7 để quyết định
chỗ nào đáng tách.
