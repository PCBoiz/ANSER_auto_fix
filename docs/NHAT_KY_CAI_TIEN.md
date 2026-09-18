# Nhật ký cải tiến — ANSER Auto

> Ghi lại **đã làm gì, vì sao, ở commit nào** để khỏi quên. Repo gốc: `Dgsonn/ANSER_auto`.
> Mọi thay đổi được đẩy lên fork `PCBoiz/ANSER_auto_fix`, nhánh `main`.
>
> Chi tiết kỹ thuật từng quyết định nằm ở `ARCHITECTURE.md` §11 (đợt rà soát) và §12 (vòng
> lặp). Việc còn lại của bạn: `docs/VIEC_CAN_LAM.md`.

## Bối cảnh

Yêu cầu ban đầu:
1. Đọc kỹ mã nguồn và hạ tầng.
2. Tham khảo các nguồn: grilling skill, playbook AI-native SDLC, system-design-primer,
   agency-agents, ui-ux-pro-max, chrome-devtools-mcp, emilkowalski/skills…
3. Rà xem app có chạy đúng luồng không, theo danh sách:

> **Chặn trước khi dùng thật:** chưa deploy ra ngoài localhost, dữ liệu demo còn lẫn, 2 tài
> khoản test cần đổi, 781 phụ tùng chưa có giá bán, thông tin doanh nghiệp còn placeholder.
> **Nên làm sớm:** index DB, validate zod, rate-limit đăng nhập, xoá tài khoản, backup DB.
> **Tính năng còn thiếu:** in hoá đơn, xác nhận n8n chạy đúng lịch, sửa/xoá trong sổ kế toán,
> import Excel qua UI, ý tưởng workflow. **Khoảng trống nghiệp vụ nhỏ:** branches chưa phân biệt
> chuyên môn, tên chi nhánh thiếu dấu.

Đã chốt khi hỏi trước lúc làm:
- Làm cả 4 mảng: go-live, tính năng thiếu, mở rộng n8n, UI/UX + hiệu năng.
- Được đọc DB thật qua `frontend/.env.local`.
- Bỏ hẳn bộ 10 workflow đã revert (commit `981f2b2` → revert `e4c131d`) và thiết kế lại từ đầu.

Sau đó bạn yêu cầu thêm: "tiếp tục", "tiếp tục cải tiến", "biến nó thành 1 vòng lặp khép kín",
và "cứ tiếp tục cải tiến… tổng hợp việc cần làm".

---

## Đợt 1 — 17/09/2026 tối: rà soát và vá theo danh sách

| Commit | Nội dung | Vì sao |
|---|---|---|
| `5a41c80` | Đóng đăng ký công khai (chỉ mở khi DB rỗng hoặc `ALLOW_PUBLIC_REGISTER`). Bỏ admin demo tự tạo, thay bằng `BOOTSTRAP_ADMIN_*`. Buộc đổi mật khẩu tạm (chặn ở API và proxy qua cờ `mcp` trong JWT). Chống dò mật khẩu bằng bảng `login_attempts`. Thêm 41 index DB. | Ai cũng tạo được tài khoản và đọc sạch dữ liệu. Admin `demo1234` tự sống lại mỗi lần khởi động. DB chưa có index nào. |
| `3f2ebde` `1d76bf8` | Trang Chi nhánh (chuyên môn, email cảnh báo, cảnh báo tên thiếu dấu), Nhập giá hàng loạt, Nhập phụ tùng từ Excel qua giao diện (xem trước rồi mới ghi, tồn đầu kỳ đi qua phiếu nhập). | Các mục "tính năng thiếu" và "khoảng trống nghiệp vụ". |
| `bd66fc2` | In hoá đơn A4 (có số tiền bằng chữ). Sửa/xoá sổ kế toán. Font Be Vietnam Pro + JetBrains Mono có subset tiếng Việt. | Geist không có "ă", "ễ". Sổ chưa sửa/xoá được. |
| `d8de1d2` | Tự động hoá: ngưỡng và công tắc bật/tắt thành thật (endpoint đọc từ DB), ghi nhịp chạy + nguồn chạy, 2 bản tin gộp (`morning_brief`, `accounting_digest`) thay bộ 10 workflow đã revert, chuông thông báo, lịch nội bộ `/api/cron/automation`. | Sửa ngưỡng trên app không có tác dụng; tắt trong app thì n8n vẫn gửi; không ai biết workflow có chạy không. |
| `23884ae` | zod cho 11 route nghiệp vụ. Trang Tài khoản: xoá / đặt lại mật khẩu / đổi email. Dò tài khoản còn dùng mật khẩu đã lộ. | `Number(x) \|\| 0` biến chữ thành 0đ; chưa xoá được tài khoản. |
| `2243528` | Tổng quan nhanh 23 lần (~8s → ~0,34s). Phân trang kho. Tương phản WCAG AA (Lighthouse 100). Sửa 4 lỗi tìm ra khi thử bằng trình duyệt thật. | Đo bằng Chrome DevTools MCP. |

## Đợt 2 — 18/09/2026 sáng: "tiếp tục cải tiến"

| Commit | Nội dung |
|---|---|
| `094a802` | Cập nhật README và ARCHITECTURE theo đợt 1. |
| `fafb1cb` | Nâng Next.js 16.2.12 → 16.3.5: vá lỗi RCE không cần xác thực trên server Windows. |
| `d3b5534` | 84 test vitest đầu tiên + CI GitHub Actions. Ngay lần chạy đầu bắt được 2 lỗi thật: ô ngưỡng trống bị ép thành 0; Excel ô công thức đọc ra `null`. |
| `8451efe` | zod cho 13 route còn lại: 40/40 route có body đều qua `parseBody`. |
| `ca8b903` | Rate-limit trong RAM cho import Excel, nhập giá hàng loạt, chạy tay bản tin. |
| `abc12ef` | Dữ liệu mẫu chỉ seed khi `SEED_DEMO_DATA=true`. Nhận diện mẫu bằng cả mã lẫn tên. |
| `2450f28` | `npm run check`: chuỗi kiểm tra trên máy giống hệt CI. |

## Đợt 3 — 18/09/2026: vòng lặp vận hành khép kín

Vòng lặp: **phát hiện → tự sửa (khi an toàn) / báo lên chuông (khi cần người) → đo lại → đóng**.

| Commit | Nội dung |
|---|---|
| `1c33f99` | Sự cố có vòng đời (migration 0008): một bản ghi mỗi sự cố, tự đóng khi đo lại không còn thấy, mở lại khi tái phát. Tự đồng bộ 10 workflow lên n8n (điền token, địa chỉ app, SMTP, email cảnh báo; phát hiện sửa tay bằng vân tay nội dung). Workflow mới `app_watchdog.json`: n8n canh app qua `/api/health`. `/api/health` đo thật (ok/degraded/down). Nhịp kỳ vọng riêng từng quy tắc (migration 0009). Lịch trong tiến trình + `system_state` (migration 0010). |
| `dfb588c` | Dockerfile + dịch vụ `app` trong compose (profile `app`), `output: standalone` chỉ khi build image. |
| `a6b8124` | Tài liệu: ARCHITECTURE §12, README tự host, n8n README bỏ import tay. |
| `0b2edf2` | Canh chính người canh gác: app ghi mốc mỗi lần workflow canh gác của n8n hỏi theo lịch; im quá 2 giờ thì báo. Nút "Kiểm tra lại ngay". |

**Ranh giới quan trọng nhất:** bộ canh gác được tự tạo workflow thiếu, tự gán SMTP, tự **tắt**
theo app. Nó **không** tự đè bản sửa tay và **không** tự **bật** workflow nghiệp vụ, vì 4 workflow
gửi thẳng cho khách thật. Việc bật chờ người bấm "Đồng bộ workflow".

## Đợt 4 — 18/09/2026 chiều: "cứ tiếp tục cải tiến"

| Commit | Nội dung |
|---|---|
| `02e8e30` | Sao lưu tự động vào vòng lặp: 2h sáng, đọc lại đối chiếu số dòng, xoay vòng giữ 14 bản, canh gác báo khi lỗi hoặc quá 36 giờ. Kiểm tra vận hành nhắc khi quá 7 ngày không có bản nào. Danh sách bảng về một file JSON dùng chung (danh sách cũ đã lệch schema 19/22). Có test khoá lệch. |
| commit ngay sau `02e8e30` | Sửa hướng dẫn sai `npm run … --apply`: npm nuốt cờ, script chỉ chạy xem trước mà người gõ tưởng đã xoá/ghi. Script giờ in "CHƯA XOÁ GÌ" kèm đúng lệnh. Thêm các file `docs/*.md`. Sửa số workflow gửi khách: là 4, trước đây ghi nhầm 3. |

---

## Số liệu đã đo trên dữ liệu thật (đừng đo lại từ đầu)

| Điều | Kết quả đo | Hệ quả |
|---|---|---|
| Đuôi "G3.000" trong tên phụ tùng | Là **giá nhập** (G/giá vốn trung vị 1,00 trên 495 mã) | Không dùng để điền giá bán |
| 213/232 chứng từ bán có tổng < tiền hàng 0,6%/0,2% | Thuế GTGT **phương pháp trực tiếp**, VAT = 0 | Không ép `trước thuế + VAT = tổng` |
| Mốc 00:00–07:00 giờ VN lùi 1 ngày khi format trên server UTC | Có, đã sửa bằng `timeZone`. Chứng từ sổ (lưu 00:00Z) **không** bị ảnh hưởng (đo cả 12 tháng) | — |
| Ngưỡng tồn `0 <= 0` | Đặt ngưỡng 0 vẫn cảnh báo; mô phỏng sau khi sửa: 588 → 1 dòng | `belowThresholdSql` |
| Quy tắc tự động trong DB | Cả 9 quy tắc đều "bật", chưa có lần chạy theo lịch nào | Không tự bật workflow gửi khách |
| Sao lưu | 1.186 dòng / 19 bảng / ~0,5 MB | Nhẹ, sao lưu hằng ngày thoải mái |
| Tổng quan | ~8s → ~0,34s | Gộp truy vấn |

## Trạng thái cuối (18/09/2026)

- **181 test**, `npm run check` sạch. CI trên fork đỏ vì tài khoản GitHub bị khoá thanh toán,
  không phải do code.
- **Migration 0000–0010 đã áp vào DB thật.**
- **Kiểm tra vận hành:** 5 việc chặn + 7 cảnh báo, đều là việc của người vận hành (xem
  `VIEC_CAN_LAM.md`).
- **Sự cố đang mở:** 5 việc chặn go-live + "Không liên lạc được với n8n" (Docker hỏng).
- **Sao lưu:** `frontend/backups/` có bản 17/09 và 18/09 (gitignore, chứa dữ liệu nhạy cảm).
