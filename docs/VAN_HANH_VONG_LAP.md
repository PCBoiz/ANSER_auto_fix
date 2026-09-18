# Sổ tay vận hành — vòng lặp tự phát hiện, tự khép

> Đọc khi: chuông báo một việc lạ, nhận email cảnh báo từ n8n, hoặc muốn biết hệ thống đang tự
> làm gì sau lưng. Thiết kế và lý do: `ARCHITECTURE.md` §12.

## 1. Vòng lặp một trang giấy

```
LỊCH (30 phút tự host | mỗi sáng trên Vercel)  →  BỘ CANH GÁC TRONG APP
   │
   ├─ an toàn ──────► TỰ SỬA ─► ghi "Hệ thống đã tự khắc phục" (mờ, xanh trên chuông)
   └─ cần phán đoán ─► CHUÔNG (1 bản ghi/sự cố) ─► BẠN xử lý
                                                     │
   ĐO LẠI: lượt sau / "Kiểm tra lại ngay" / mở trang Kiểm tra vận hành / "Đồng bộ workflow"
   └─ không còn thấy ─► ĐÓNG: "Đã khắc phục sau X" (gạch ngang, mờ)

n8n ──(mỗi 30 phút hỏi /api/health)──► app chết hoặc vòng trên hỏng → EMAIL; hồi phục → EMAIL
app ──(ghi mốc mỗi lần n8n hỏi)─────► n8n ngừng hỏi quá 2 giờ → CHUÔNG
```

Nguyên tắc: **không ai bấm "đã xong"**. Sự cố chỉ đóng khi lần đo sau không còn thấy nó.

## 2. Lịch chạy

| Việc | Khi nào | Ai gọi |
|---|---|---|
| Canh gác (`watchdog`) | Mỗi 30 phút | Lịch nội bộ (`INTERNAL_SCHEDULER=true`) hoặc Vercel Cron mỗi sáng |
| Sao lưu (`backup`) | Mỗi ngày, từ 2h sáng | Lịch nội bộ, chỉ khi có `BACKUP_DIR` |
| Bản tin sáng lên chuông (`morning_brief`) | Mỗi ngày, từ 7h | Lịch nội bộ / Vercel Cron |
| Tổng hợp kế toán lên chuông (`accounting_digest`) | Thứ Hai, từ 8h | Lịch nội bộ / Vercel Cron |
| Email bản tin, cảnh báo kho, nhắc khách… | Theo từng workflow | n8n |
| Canh gác app (`app_watchdog.json`) | Mỗi 30 phút | n8n |

Lịch nội bộ có **bắt kịp**: máy tắt lúc 7h, bật lại lúc 10h vẫn chạy bản tin hôm đó. Mỗi "khe"
(ngày, tuần, nửa giờ) chạy đúng **một** lần, dù có hai tiến trình (khoá trong bảng `system_state`).

Chạy tay: trang Tự động hoá → "Chạy ngay" (bản tin), trang Kiểm tra vận hành → "Kiểm tra lại
ngay" (canh gác). Lần chạy tay **không** được tính là "lịch còn sống".

## 3. Mỗi sự cố trên chuông nghĩa là gì, làm gì

### Việc chặn go-live (`readiness:*`)
Lấy từ trang Kiểm tra vận hành, **chỉ** mức chặn. Xử lý theo nút "Mở trang xử lý" trên trang đó.
Danh sách hiện tại và cách làm: `docs/VIEC_CAN_LAM.md` mục A.

### Canh gác (`watchdog:*`)

| Khoá | Mức | Nghĩa | Làm gì | Tự đóng khi |
|---|---|---|---|---|
| `watchdog:rule:<loại>` | cao | Quy tắc **từng** chạy theo lịch nay im quá nhịp (8 giờ với lịch 6 giờ, 26 giờ với lịch ngày, 8 ngày với lịch tuần) | Xem n8n còn chạy không, workflow còn Active không; Tự động hoá → Lịch sử chạy | n8n chạy lại theo lịch |
| `watchdog:n8n:unreachable` | cao | App gọi API n8n không được | `docker compose up -d`; nếu n8n vẫn chạy thì API key hết hạn: tạo key mới → `N8N_API_KEY` | n8n trả lời lại |
| `watchdog:n8n:no-smtp` | cao | n8n chưa có credential SMTP, mọi email sẽ lỗi | n8n → Credentials → thêm SMTP. App tự gán ở lượt sau | Có SMTP |
| `watchdog:n8n:sync-error` | cao | Đồng bộ workflow lỗi (thường thiếu `N8N_INTERNAL_TOKEN`, hoặc API key thiếu scope) | Đọc lỗi đầu tiên trong thông báo | Lượt đồng bộ sau không lỗi |
| `watchdog:n8n:drift` | thường | Workflow trên n8n khác bản mẫu, có thể ai đó đã sửa tay (hoặc mở rồi lưu lại trong n8n UI) | Muốn giữ bản sửa: sửa file mẫu trong `frontend/n8n-workflows/` cho khớp. Không cần: bấm **Đồng bộ workflow** | Hết lệch |
| `watchdog:n8n:inactive` | thường | Quy tắc bật trong app, workflow tắt trên n8n. Bộ canh gác **không tự bật** (có workflow gửi khách) | Muốn gửi: bấm **Đồng bộ workflow**. Không muốn: tắt quy tắc trong app | Hai bên khớp |
| `watchdog:n8n:no-alert-email` | thường | Chưa có email nhận cảnh báo app chết, nên workflow canh gác bị để tắt | Cài đặt → Email doanh nghiệp | Có email (canh gác tự bật ở lượt sau) |
| `watchdog:n8n:app-watchdog-silent` | cao | Workflow "Canh gác app" trên n8n **đã từng** hỏi app nhưng im quá 2 giờ. App chết lúc này sẽ không ai được báo | Mở n8n: workflow còn Active? Lịch sử chạy có lỗi? Hoặc bấm Đồng bộ workflow | n8n hỏi lại |
| `watchdog:backup:failed` | cao | Lần sao lưu gần nhất lỗi (kèm lỗi: đầy đĩa, không có quyền ghi…) | Xử lý theo lỗi | Lần sao lưu sau thành công |
| `watchdog:backup:stale` | cao | Bản sao thành công gần nhất quá 36 giờ khi sao lưu tự động đang bật | Lịch nội bộ còn bật không (`INTERNAL_SCHEDULER`)? App có bị tắt đêm qua không? | Có bản mới |

### Hệ thống đã tự khắc phục (`watchdog:autofix:*`, chữ xanh)
Không cần làm gì. Đây là dấu vết để biết hệ thống đã phải can thiệp:
- Tạo workflow còn thiếu (luôn ở trạng thái tắt).
- Gán SMTP cho node Email đang trống.
- Tắt workflow mà app đã tắt.
- Bật workflow canh gác.

**Cùng một việc tự sửa lặp đi lặp lại** (vd: ngày nào cũng "tự tạo workflow…") nghĩa là có ai
hoặc cái gì đang xoá nó. Hãy tìm nguyên nhân.

## 4. Email từ n8n

| Tiêu đề | Nghĩa | Làm gì |
|---|---|---|
| 🔴 ANSER Auto không phản hồi | `/api/health` không trả lời hoặc DB chết | Kiểm tra máy chủ, container `anser-auto-app`, Neon |
| 🟠 ANSER Auto: vòng tự động đang hỏng | App sống nhưng có sự cố canh gác mức cao đang mở, hoặc bộ canh gác trong app im quá 26 giờ. Email liệt kê lý do | Mở chuông trong app, xử lý theo bảng mục 3 |
| … (nhắc lại) | Vẫn chưa xong sau 3 giờ | — |
| 🟢 ANSER Auto đã hoạt động lại | Đã hết, kèm thời gian gián đoạn | Không cần làm gì |

Chống spam: báo ngay lần đầu, nhắc lại mỗi 3 giờ (không phải mỗi 30 phút), báo một lần khi hồi phục.

## 5. `/api/health`

| Trạng thái | HTTP | Khi nào |
|---|---|---|
| `ok` | 200 | Mọi thứ ổn. Việc chặn go-live **không** làm hỏng trạng thái (đó là việc cài đặt, không phải hồi quy) |
| `degraded` | 503 | Có sự cố canh gác mức cao đang mở, hoặc bộ canh gác trong app im quá 26 giờ |
| `down` | 503 | DB không trả lời trong 8 giây |

- Ai cũng gọi được nhưng chỉ nhận `{"status": …}`. Gửi kèm header `X-Internal-Token: <N8N_INTERNAL_TOKEN>`
  thì nhận thêm danh sách kiểm tra và lý do.
- `?live=1`: chỉ hỏi tiến trình còn sống không, không chạm DB. Dùng cho healthcheck của Docker.

Kiểm tra tay (bash):
```bash
curl -s http://localhost:3000/api/health
curl -s -H "X-Internal-Token: $N8N_INTERNAL_TOKEN" http://localhost:3000/api/health
```

## 6. Biến môi trường của vòng lặp

| Biến | Dùng cho | Ghi chú |
|---|---|---|
| `INTERNAL_SCHEDULER=true` | Bật lịch trong tiến trình | Chỉ tự host. **Không** đặt trên Vercel |
| `BACKUP_DIR`, `BACKUP_KEEP` | Sao lưu tự động (mặc định giữ 14 bản) | Chỉ tự host. Docker đặt sẵn `/app/backups` |
| `APP_URL_FOR_N8N` | Địa chỉ app mà n8n gọi tới, được điền vào workflow lúc đồng bộ | Mặc định `http://host.docker.internal:3000`; compose: `http://app:3000` |
| `N8N_API_URL`, `N8N_API_KEY` | App điều khiển n8n (đồng bộ, bật/tắt, lịch sử) | Key cần scope `workflow:*`, `credential:list` |
| `N8N_INTERNAL_TOKEN` | Bảo vệ `/api/n8n/internal/*` và chi tiết `/api/health` | Thiếu ở production thì endpoint trả 503 |
| `N8N_NOTIFY_EMAIL` | Email dự phòng khi Cài đặt chưa có email doanh nghiệp | — |
| `CRON_SECRET` | Bảo vệ `/api/cron/automation` | Vercel Cron tự gửi |

## 7. Khi nghi vòng lặp không chạy

1. Trang Kiểm tra vận hành, khung "Vòng tự phát hiện – tự khép": bộ canh gác chạy lần cuối bao
   lâu trước? "Chưa chạy theo lịch lần nào" nghĩa là chưa bật `INTERNAL_SCHEDULER` hoặc Cron.
2. Bấm **Kiểm tra lại ngay**, đọc dòng kết quả ("Mở X, đóng Y, tự sửa Z; …").
3. Log server: dòng `[scheduler] …` mỗi lần một việc chạy; `[watchdog] …` khi ghi nhịp lỗi.
4. `curl` `/api/health` kèm token (mục 5).
