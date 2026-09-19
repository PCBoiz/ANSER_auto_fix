# Việc bạn cần làm — ANSER Auto

> Cập nhật: 20/09/2026. Đây là những việc **code không làm thay được**: cần tài khoản, mật khẩu,
> dữ liệu thật hoặc một quyết định của bạn.
>
> Nguồn sự thật vẫn là trang **Kiểm tra vận hành** (`/dashboard/readiness`). Trang đó đo trực
> tiếp từ DB và tự gạch mục khi xong. File này sắp xếp các việc theo thứ tự nên làm, kèm cách làm
> cụ thể. Sau mỗi việc, mở trang đó, bấm **Kiểm tra lại ngay**, mục tương ứng sẽ biến mất và sự
> cố trên chuông tự đóng.
>
> Mọi lệnh bên dưới chạy trong thư mục `frontend/`.

---

## A. Chặn go-live — phải xong trước khi giao cho nhân viên dùng thật

Lúc viết, trang Kiểm tra vận hành báo **5 việc chặn** và **7 cảnh báo**.

### A1. Đổi mật khẩu 3 tài khoản dùng mật khẩu đã lộ ⛔
- [ ] `ketoan@anser.auto`, `ktv@anser.auto`, `demo@anser.auto` vẫn dùng mật khẩu từng nằm công
      khai trong mã nguồn và lịch sử git. Ai đọc được repo cũng đăng nhập được.
- Cách làm: **Tài khoản** → từng tài khoản → **Đặt lại mật khẩu**. Hệ thống sẽ bắt đổi tiếp ở lần
  đăng nhập sau.
- Tài khoản `demo@` đang là admin: đổi luôn **email** sang email thật của chủ gara (Tài khoản →
  Sửa). Hai tài khoản kia: đổi sang email thật của kế toán và kỹ thuật viên, hoặc xoá nếu không dùng.
- Xong khi: mục "tài khoản vẫn dùng mật khẩu đã lộ" và "email mẫu @anser.auto" biến mất.

### A2. Xoá dữ liệu mẫu ⛔
- [ ] Hiện còn 7 phụ tùng mẫu, 8 hạng mục dịch vụ mẫu và 1 hồ sơ nhân sự ghi "(test)".
- Xem trước: `npm run data:clean-demo`
- Xoá thật: `npm run data:clean-demo -- --apply` ← **dấu `--` ở giữa là bắt buộc**. Thiếu nó,
  npm nuốt mất `--apply` mà không báo gì và script chỉ chạy xem trước. Script sẽ in "CHƯA XOÁ GÌ"
  nếu bạn gõ thiếu.
- Script tự từ chối xoá thứ đã phát sinh giao dịch. Nên sao lưu trước: `npm run db:backup`.

### A3. Điền thông tin doanh nghiệp ⛔
- [ ] **Cài đặt**: tên gara (đang là "ANSER Auto" mặc định), địa chỉ, điện thoại, mã số thuế, **email**.
- Những thông tin này in lên hoá đơn giao cho khách.
- **Email doanh nghiệp còn có vai trò thứ hai:** đó là địa chỉ nhận cảnh báo "app không phản hồi"
  từ n8n. Để trống thì workflow canh gác app không biết gửi cho ai và bị để tắt.

### A4. Giá bán cho 781/788 phụ tùng ⛔
- [ ] **Kho phụ tùng → Nhập giá hàng loạt**, lọc "chưa có giá bán", điền theo lô (100 dòng/trang).
- Không đoán giá bán từ đuôi "G3.000" trong tên phụ tùng. Đã đo: đó là **giá nhập** (tỷ lệ G/giá
  vốn trung vị = 1,00), không phải giá bán.
- Tuỳ chọn: `npm run data:name-prices` đề xuất điền giá vốn cho 105 mã còn trống và gỡ đuôi
  giá khỏi 600 tên (để tên in lên hoá đơn sạch). Ghi thật:
  `npm run data:name-prices -- --apply-cost --apply-rename`.

### A5. Ngưỡng tồn kho ⛔
- [ ] Cảnh báo tồn kho đang liệt kê **724 mặt hàng** mỗi lần chạy, vì 781 mã chưa có ngưỡng riêng
      nên dùng chung mức 5.
- **Kho phụ tùng → Đặt ngưỡng hàng loạt**: đặt ngưỡng thật cho nhóm cần giữ tồn, đặt **0** cho
  vật tư đặt theo xe (0 = không cảnh báo).

### A6. Đổi bí mật đã đi qua tay nhiều người ⛔
- [ ] `DATABASE_URL` từng được gửi qua tin nhắn để tạo `.env.local`. Trước khi dùng thật, hãy
      **đổi mật khẩu DB trên Neon** (Neon Console → Roles → Reset password) rồi cập nhật `.env.local`
      và máy chủ.
- [ ] Sinh mới `JWT_SECRET`, `N8N_INTERNAL_TOKEN`, `CRON_SECRET` cho production (chuỗi ngẫu nhiên
      dài, **khác** bản trên máy dev). Đổi `JWT_SECRET` sẽ đăng xuất mọi người, và đó là điều mong muốn.

---

## B. Bật lại tự động hoá (email)

Hiện chuông báo **"Không liên lạc được với n8n"**: Docker Desktop trên máy dev hỏng từ 17/09
(lỗi "Failed to apply delta update"). Bản tin sáng, tổng hợp kế toán và các việc chặn go-live vẫn
lên chuông; chỉ email là dừng.

- [ ] **B1. Sửa Docker Desktop.** Cài lại bản mới từ docker.com là cách nhanh nhất.
- [ ] **B2.** `docker compose up -d`, đợi khoảng 30 giây. n8n ở http://localhost:5681.
- [ ] **B3. API key n8n.** n8n UI → Settings → n8n API → Create. Cấp scope `workflow:*` và
      `credential:list`. Dán vào `N8N_API_KEY` trong `.env.local`.
- [ ] **B4. Credential SMTP trong n8n.** Credentials → New → SMTP. Máy dev: host `mailhog`, port
      `1025`, không SSL. Production: SMTP thật (Gmail/Zoho…). Chỉ cần tạo; app tự gán vào mọi node
      Gửi Email.
- [ ] **B5. Quyết định rồi bấm "Đồng bộ workflow"** (trang Tự động hoá).
  - Nút này tạo đủ 12 workflow và **bật** workflow của mọi quy tắc đang bật. Hai workflow hạ tầng
    ("Canh gác app", "Báo nhanh sự cố") chỉ gửi cho chính gara và được tự bật.
  - Cả 10 quy tắc hiện đang "bật". Nhiều khả năng đó chỉ là giá trị mặc định lúc tạo. Quy tắc
    mới "Báo cáo tuần cho chủ gara" chỉ gửi nội bộ.
  - **4 workflow gửi email thẳng cho khách thật:** nhắc bảo dưỡng, nhắc lịch hẹn, báo tiến độ sửa
    chữa, nhắc chờ nghiệm thu.
  - Muốn chưa gửi cho khách thì **tắt 4 quy tắc đó trong app trước**, rồi mới bấm Đồng bộ.
  - Bộ canh gác tự động sẽ không bao giờ tự bật chúng.
- [ ] **B6. Xác nhận lịch chạy thật.** Đợi qua một mốc giờ (vd 7h: bản tin sáng; mỗi 6 giờ: cảnh
      báo kho). Trang Tự động hoá sẽ hiện "Lần chạy gần nhất" với nguồn **n8n theo lịch**. Mục "9
      quy tắc chưa từng chạy" ở trang Kiểm tra vận hành tự biến mất.
- [ ] **B7. Thử email cảnh báo app chết (khuyên làm một lần).** Tắt app 40 phút. Bạn sẽ nhận
      email 🔴 "không phản hồi". Bật lại, trong 30 phút sẽ nhận email 🟢 "đã hoạt động lại". Xem
      ở MailHog http://localhost:8027 (máy dev).
- [ ] **B8. Đặt `N8N_WEBHOOK_URL`** (đã có trong `.env.local`: `http://localhost:5681/webhook`).
      Đây là đường app gửi **email báo nhanh**: sự cố mức cao mới mở (dòng 0đ, giao xe chưa lập
      hoá đơn, sao lưu lỗi, lịch ngừng chạy…) được gom lại gửi trong vòng 30 phút, kèm email "đã
      khắc phục" khi tự đóng. Docker compose đã đặt sẵn cho dịch vụ `app`.

## B+. Báo động khi cả máy chủ sập (mới 20/09) — khuyên làm ngay khi chạy thật

App và n8n canh nhau, nhưng thường nằm cùng một máy: mất điện, mất mạng, treo máy thì cả hai cùng
im, không ai gửi được email báo. Cần một dịch vụ **bên ngoài** đợi nhịp.

- [ ] **B+1.** Tạo tài khoản miễn phí ở https://healthchecks.io → **Add Check**: Period **30 phút**,
      Grace **30 phút** (Vercel: Period 1 ngày). Integrations → bật **Email** tới email của bạn.
- [ ] **B+2.** Chép "Ping URL" (dạng `https://hc-ping.com/<uuid>`) vào `HEARTBEAT_URL` trong
      `.env.local` / `.env.app`, khởi động lại app. Cần `INTERNAL_SCHEDULER=true` (hoặc Vercel Cron).
- [ ] **B+3.** Sau 30 phút, trang healthchecks.io phải báo **Up**. Hệ thống hỏng (vd n8n chết)
      thì app gửi `/fail`, bạn nhận email ngay; máy chết thì nhịp ngừng, bạn nhận email sau ~1 giờ.
- [ ] **B+4. (tuỳ chọn)** `APP_PUBLIC_URL=http://<ip-máy-chủ>:3000` để email báo nhanh có link
      "Mở trang xử lý" bấm thẳng tới lệnh cần sửa.

---

## C. Đưa ra khỏi localhost (deploy)

Chọn **một** trong hai.

### C1. Tự host bằng Docker (khuyên dùng)
- Vì sao khuyên: n8n vốn đã tự host. Khi app chạy chung một Docker Compose, hai bên gọi nhau
  trực tiếp, có sao lưu tự động và lịch chạy trong app.
- [ ] Một máy luôn bật (máy tại gara hoặc VPS), đã cài Docker.
- [ ] `cp .env.local .env.app` rồi sửa thành giá trị **production** (bí mật mới ở A6, email thật).
- [ ] `npm run db:migrate`. Migration chạy từ máy có mã nguồn, không chạy trong image.
- [ ] `docker compose --profile app up -d --build`
      - App ở cổng 3000, tự khởi động lại khi chết.
      - Lịch nội bộ bật sẵn: canh gác 30 phút, bản tin 7h, tổng hợp kế toán + báo cáo tuần 8h thứ Hai.
      - Sao lưu 2h sáng vào volume `anser_auto_backups`, giữ 14 bản.
- [ ] Vào app → Tự động hoá → **Đồng bộ workflow** một lần. n8n sẽ gọi app qua `http://app:3000`.
- [ ] Dockerfile **chưa từng được build thật** (Docker trên máy dev hỏng). Lần build đầu có lỗi
      thì gửi log lại. Bản standalone mà nó đóng gói đã chạy thử được.
- [ ] Nếu mở ra Internet: đặt sau HTTPS (Caddy/Nginx/Cloudflare Tunnel). Không mở trực tiếp cổng
      5681 (n8n) ra ngoài.

### C2. Vercel (app) + n8n ở nơi khác
- [ ] Import repo, **Root Directory = `frontend`**.
- [ ] Biến môi trường: `DATABASE_URL`, `JWT_SECRET`, `N8N_INTERNAL_TOKEN`, `CRON_SECRET`,
      `N8N_NOTIFY_EMAIL`, và `N8N_API_URL`/`N8N_API_KEY` nếu n8n có địa chỉ public.
- [ ] **Không** đặt `INTERNAL_SCHEDULER` và `BACKUP_DIR` trên Vercel: serverless không sống liên
      tục, hệ thống file là tạm. Lịch trong `vercel.json` chạy mỗi sáng (gói Hobby chỉ cho lịch
      mỗi ngày một lần).
- [ ] n8n phải gọi được app: đặt `APP_URL_FOR_N8N=https://<tên-app>.vercel.app` rồi bấm Đồng bộ
      workflow.
- [ ] Sao lưu: không có bản tự động. Chạy `npm run db:backup` định kỳ từ máy của bạn (xem D1).

---

## D. Nên làm sớm

- [ ] **D1. Cho bản sao lưu tự ra khỏi máy** (đã chọn 20/09: thư mục đồng bộ sẵn có).
  - Cài **Google Drive for Desktop** (hoặc OneDrive) trên máy chủ, đăng nhập tài khoản **riêng** của
    gara. Tạo thư mục, vd `G:\My Drive\ANSER-sao-luu`.
  - Chạy thẳng trên máy: đặt `BACKUP_DIR=backups` và `BACKUP_COPY_DIR=G:/My Drive/ANSER-sao-luu`
    trong `.env.local` (cần `INTERNAL_SCHEDULER=true`).
  - Chạy bằng Docker: tạo file `frontend/.env` chứa `BACKUP_COPY_HOST_DIR=G:/My Drive/ANSER-sao-luu`,
    thêm `BACKUP_COPY_DIR=/app/backups-copy` vào `.env.app`, rồi `docker compose --profile app up -d`.
  - Mỗi đêm 2h: sao lưu → đọc lại → chép sang thư mục đó → đọc lại so sha256. Chép lỗi (ổ Drive
    chưa gắn…) thì chuông + email báo. **Kiểm một lần** trên drive.google.com xem file đã lên mây chưa:
    app chỉ biết đã ghi vào thư mục, còn đẩy lên mây là việc của Google Drive.
  - File chứa **mã băm mật khẩu và thông tin khách** — không chia sẻ thư mục đó cho ai.
  - `frontend/backups/` đang có bản 17/09 và 18/09 — chép tay chúng vào thư mục trên một lần.
- [ ] **D2. Diễn tập khôi phục một lần.**
  1. Neon Console → Branches → tạo branch từ main.
  2. Tạm trỏ `DATABASE_URL` sang branch đó.
  3. `npm run db:restore -- backups/<file>.json --apply`.
  4. Mở app kiểm tra, rồi trỏ lại.
  - Tuyệt đối **không** chạy `--apply` vào DB đang dùng: lệnh này xoá sạch dữ liệu các bảng trước
    khi chèn lại.
- [ ] **D3. Mở khoá GitHub Actions trên fork.**
  - CI trên `PCBoiz/ANSER_auto_fix` đang đỏ **không phải do code**. GitHub báo *"The job was not
    started because your account is locked due to a billing issue"*, nên job không chạy bước nào.
  - Xử lý ở GitHub → Settings → Billing.
  - Trong lúc chờ, chạy `npm run check` trước mỗi lần push. Lệnh này giống hệt CI (181 test, lint,
    build, quét bundle).
- [ ] **D4. Chi nhánh.** Sửa tên "Xuong son go han" → "Xưởng sơn gò hàn" (in lên phiếu giao khách).
      Chọn **chuyên môn** cho 2 xưởng. Điền **email nhận cảnh báo** cho từng xưởng để cảnh báo tồn
      kho tới đúng thủ kho.
- [ ] **D5. Giá vốn cho 139 phụ tùng.** Điền dần khi nhập kho: mỗi phiếu nhập có đơn giá sẽ tự
      cập nhật giá vốn. Thiếu giá vốn thì báo cáo lãi gộp bỏ qua các mặt hàng đó.
- [ ] **D6. Việc của kế toán** (bản tin tuần đã báo lên chuông):
      - 49 chứng từ mua (684.394.333đ) từ 1 nhà cung cấp chưa nhận hoá đơn đầu vào quá 15 ngày.
      - 6 đối tác bị ghi thành nhiều tên (khác hoa/thường, khoảng trắng), nên doanh thu theo khách
        bị tách đôi. Thống nhất lại tên trong sổ.
- [ ] **D7. Bật lịch nội bộ trên máy dev (tuỳ chọn).** Thêm vào `.env.local`:
      `INTERNAL_SCHEDULER=true` và `BACKUP_DIR=backups`, rồi khởi động lại `npm run dev`. Bộ canh
      gác sẽ chạy mỗi 30 phút, và trang Kiểm tra vận hành hết dòng "Bộ canh gác chưa chạy theo lịch
      lần nào".

---

## E. Cần bạn quyết định (chưa làm vì không phải việc code tự quyết được)

| Việc | Cần quyết gì |
|---|---|
| Bảo hiểm chi trả một phần | Sổ bán hàng (phần lớn khách là công ty bảo hiểm) không nối được với lệnh sửa chữa, vì dữ liệu gốc không có biển số. Khi gara bắt đầu lập lệnh trong app, có thêm liên kết `sổ bán ↔ hoá đơn` không? |
| Cột "tiền thuế được giảm" trong sổ | 213/232 chứng từ bán thấp hơn tiền hàng 0,6%/0,2% (thuế GTGT theo phương pháp trực tiếp). Nếu cần khai thuế từ app thì phải có cột riêng. |
| Test cho phần chạm DB | Cần một Neon branch riêng cho CI và `DATABASE_URL` trong GitHub Secrets. Có muốn không? |
| Ngưỡng giảm giá cần duyệt | Đang đặt: giảm **từ 10%** và **từ 500.000đ** trở lên (cả hai) do nhân viên đặt thì chờ quản lý duyệt; quản lý tự đặt thì coi như đã duyệt. Muốn khác thì báo lại (`lib/revenueGuard.ts` — `DISCOUNT_REVIEW`). |
| "Xưởng ngừng lập lệnh" | Đang đặt: **2 ngày làm việc** (bỏ Chủ nhật) liền không có lệnh mới thì báo lên chuông. Sửa ở Tự động hoá → Báo cáo tuần cho chủ gara → Ngưỡng. Chỉ bắt đầu canh sau khi có lệnh đầu tiên. |
| `npm audit`: 6 lỗ hổng mức trung bình | Qua `drizzle-kit` (công cụ dev, lỗ hổng ở dev server của esbuild, app không dùng) và `exceljs → uuid` (lỗi ở `v3/v5/v6` khi truyền `buf`). "Bản sửa" npm đề xuất là **hạ phiên bản** (drizzle-kit 0.18, exceljs 3.4), sẽ làm hỏng code. Đề xuất: theo dõi, nâng khi thư viện ra bản mới. CI chỉ chặn mức high. |

---

## Cách biết mọi thứ đã xong

1. Trang **Kiểm tra vận hành**: 0 việc chặn go-live.
2. Khung **Vòng tự phát hiện – tự khép**: "Sự cố đang mở" = 0, bộ canh gác chạy lần cuối dưới
   30 phút trước.
3. `curl http://<máy-chủ>/api/health` trả `{"status":"ok"}` với HTTP 200.
4. Trang Tự động hoá: mọi quy tắc đang bật đều có "Lần chạy gần nhất" với nguồn **n8n theo lịch**.
