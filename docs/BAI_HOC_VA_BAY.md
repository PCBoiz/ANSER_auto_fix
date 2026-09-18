# Bài học, bẫy đã dính, và cách kiểm chứng lại

> Mỗi dòng ở đây đã **thật sự xảy ra** trong quá trình làm, hoặc được đo trên hệ thống thật.
> Đọc trước khi sửa phần liên quan, để khỏi dính lại. Viết cho cả người lẫn AI agent làm tiếp.

## 1. Bẫy trong code

| Bẫy | Chuyện gì xảy ra | Cách đúng | Ở đâu |
|---|---|---|---|
| zod 4 `.partial()` **giữ** `.default()` | PATCH chỉ sửa tên cũng đặt tiền về 0 | Lược đồ PATCH suy từ tầng gốc **không** có default | `ledgerSchemas.ts` |
| Helper `optionalUuid` biến "không gửi" thành `null` | Đặt lại mật khẩu thì gỡ luôn liên kết nhân sự | PATCH luôn bọc `.optional()` bên ngoài rồi `pickDefined()` | `validation.ts` (ghi chú BẪY) |
| Thứ tự union với `z.coerce` | `""` bị ép thành `0`: xoá trống ô ngưỡng thành "không cảnh báo" | Union theo thứ tự `null`, `""`, rồi mới số | `optionalNonNegativeInt` |
| Drizzle `= any(${mảng})` | Mảng bị bung thành tuple, SQL sai | Dùng `in ${mảng}` | `readiness.ts` |
| Hàm dùng chung đặt trong file `"use client"` | Server Component gọi thì lỗi 500 lúc chạy; build và typecheck vẫn xanh | Để ở module thuần (`src/lib/`) | `lib/format.ts` |
| `Date.now()` trong component | Lint `react-hooks/purity` chặn | Lấy thời điểm từ dữ liệu đã đo (vd `report.checkedAt`) | `readiness/page.tsx` |
| Ô công thức / rich-text của ExcelJS | Giá đọc ra `null` mà không báo | `unwrapCell()` trước khi parse | `partsImport.ts` |
| Ngưỡng tồn `stock <= coalesce(min, 5)` | Ngưỡng 0 vẫn cảnh báo (`0 <= 0`) | `belowThresholdSql`: null = mặc định, 0 = tắt | `store/parts.ts` |
| "Đọc rồi mới ghi" để chống chạy trùng | Hai tiến trình cùng thấy "chưa chạy" | Upsert có điều kiện trong **một** câu lệnh (`claimSlot`); `on conflict do nothing` cho thông báo | `store/systemState.ts` |
| Biết dòng upsert là thêm mới hay cập nhật | — | `returning (xmax = 0)`: đúng chỉ với dòng vừa INSERT | `syncIncidents` |
| Khoá thông báo kèm ngày (`…:2026-09-18`) | Sửa xong vẫn còn thông báo hôm nay; chưa sửa thì mỗi ngày thêm một bản | Khoá **không** ngày, có vòng đời mở/đóng | `ARCHITECTURE.md` §12 |
| Mốc "lịch còn chạy" bị lịch nội bộ đẩy | n8n chết cả tuần mà bản tin vẫn trông đúng giờ | `last_scheduled_run_at` chỉ tính nguồn n8n | `automation/rules.ts` |
| Danh sách bảng sao lưu viết cứng | Lệch schema (19/22) mà không ai biết | Một file JSON dùng chung + test khoá | `backupTables.json` |
| Server standalone (`node server.js`) | **Không** tự đọc `.env.local`, nên `DATABASE_URL is not set` và mọi trang 500 | Truyền env: `node --env-file=…` hoặc `env_file` của compose | `Dockerfile` |

## 2. Bẫy của n8n (đo trên n8n 2.39.7)

- Public API **không cho xoá** workflow hay credential (HTTP 405). Muốn "làm sạch" thì tắt và đổi tên.
- n8n **từ chối bật** workflow có node Gửi Email chưa gán credential (*"Missing required credential:
  smtp"*). Vì vậy đồng bộ không thử bật khi chưa có SMTP.
- Tạo workflow trên n8n vừa khởi động có thể **quá 5 giây**. n8n vẫn tạo xong nhưng app báo lỗi.
  Lệnh ghi dùng timeout 20 giây, lệnh đọc 5 giây.
- Vân tay nội dung **cố ý bỏ qua credential** (id khác nhau giữa các máy). Hệ quả: workflow tạo lúc
  chưa có SMTP sẽ không bao giờ được gán, **kể cả khi bấm Đồng bộ**. Phải kiểm tra riêng
  (`lacksSmtpCredential`).
- Mở rồi lưu workflow trong n8n UI có thể thêm tham số mặc định, và bị tính là "lệch mẫu". Không
  phải lỗi; bấm Đồng bộ là hết.
- `$execution.mode`: `production` khi tự chạy theo lịch, `test` khi bấm Execute.
  `$getWorkflowStaticData` **chỉ lưu** khi chạy production. Thử tay thì trạng thái chống spam
  không đổi.
- Node HTTP dùng để kiểm tra sức khoẻ phải bật `fullResponse` + `neverError` và
  `onError: continueRegularOutput`. Nếu không, đúng lúc app chết (cần báo nhất) workflow lại dừng
  giữa chừng.
- API key cần đủ scope (`workflow:activate`/`deactivate`…). Xem `ARCHITECTURE.md` §8.4.2.
- Hai project Compose cùng tên "frontend" sẽ xoá container của nhau. Xem `ARCHITECTURE.md` §8.4.1.

## 3. Bẫy công cụ và môi trường

| Bẫy | Cách đúng |
|---|---|
| `npm run data:clean-demo --apply`: npm **nuốt** cờ, script chỉ chạy xem trước, người gõ tưởng đã xoá | `npm run data:clean-demo -- --apply` (có `--` ở giữa). Script giờ in "CHƯA XOÁ GÌ" |
| `lệnh \| tail` che mã thoát của lệnh | Kiểm tra `$?` ngay sau lệnh, hoặc `${PIPESTATUS[0]}`. Đã từng commit 2 lỗi lint vì vậy |
| Docker Desktop "Failed to apply delta update" | Cài lại. Trong lúc chờ, thử n8n bằng npm (mục 5) |
| CI trên fork đỏ, job 0 bước | Tài khoản GitHub bị khoá thanh toán, không phải do code. Dùng `npm run check` |
| (AI agent) Công cụ ghi file giải mã `\uXXXX` thành ký tự thật | Viết regex Unicode bằng cách khác, hoặc sinh bằng script. Sau khi sửa, quét ký tự vô hình (BOM, zero-width) |
| (AI agent) Python trên Windows không mở được đường dẫn `/c/...` của Git Bash | Dùng dạng `C:/...` |

## 4. Nguyên tắc an toàn đã giữ khi làm trên dữ liệu thật

- Không in, không commit bí mật trong `frontend/.env.local`.
- Không tạo bản ghi thử **tiêu tốn sequence** trong DB thật (vd số hoá đơn `HD-2026-0001`).
  Bản ghi thử chỉ dùng ở bảng không có sequence, và xoá ngay sau khi kiểm tra.
- Mọi script ghi dữ liệu mặc định **chỉ xem trước**; không chạy `--apply` khi chưa có quyết định
  của chủ dữ liệu.
- Kiểm thử đồng bộ n8n có ghi `n8n_workflow_id` vào DB thật: chụp lại trước, **trả nguyên** sau.
- `backups/` bị gitignore. File sao lưu chứa mã băm mật khẩu và thông tin khách.

## 5. Cách kiểm chứng lại

**Hằng ngày trước khi push:** `npm run check` (typecheck → lint → 181 test → build → quét bundle).
Không cần DB.

**Test chỉ cho module thuần** (`src/lib/`, và các hàm tách khỏi chỗ chạm DB). Muốn test được thì
đặt logic ở đó. Đáng chú ý:
- `opsLoop.test.ts`: đối soát sự cố, nhịp kỳ vọng, khe lịch theo giờ Việt Nam, sức khoẻ.
- `n8nTemplates.test.ts`: render **cả 10** file mẫu, vân tay, ranh giới tự sửa/người quyết.
- `appWatchdogWorkflow.test.ts`: **chạy thật** đoạn mã của node Code trong workflow canh gác với
  đồng hồ giả.
- `backup.test.ts`: danh sách bảng khớp schema và khoá ngoại.

**Thử đồng bộ với n8n thật mà không cần Docker** (cách đã làm hôm 18/09):
1. Vào một thư mục tạm: `npm init -y && npm install n8n` (khoảng 6 phút).
2. `N8N_USER_FOLDER=<thư mục tạm>/data N8N_PORT=5690 N8N_SECURE_COOKIE=false npx n8n start`
3. Tạo owner: `POST http://localhost:5690/rest/owner/setup`. Đăng nhập: `POST /rest/login`.
4. Tạo API key: lấy `GET /rest/api-keys/scopes`, rồi `POST /rest/api-keys` với
   `{label, scopes, expiresAt: null}`.
5. Chạy `syncN8nWorkflows` bằng `tsx`, với `N8N_API_URL=http://localhost:5690` và key vừa tạo.
   **Chụp và trả lại** `automation_rules.n8n_workflow_id`.
6. Kịch bản: n8n trống → tạo; chạy lại → khớp; sửa tay → lệch; Đồng bộ → về mẫu và bật; canh gác
   → sạch.

**Thử giao diện:** Chrome DevTools MCP (mở trang thật, bấm, chụp, đọc console, Lighthouse). Cách
này bắt được lỗi mà curl không thấy (4 lỗi ở đợt 1).

**Thử bản build Docker khi chưa có Docker:**
```bash
NEXT_OUTPUT=standalone npx next build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
cd .next/standalone && PORT=3100 node --env-file=../../.env.local server.js
```
