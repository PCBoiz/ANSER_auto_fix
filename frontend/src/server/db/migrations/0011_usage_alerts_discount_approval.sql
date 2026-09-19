ALTER TABLE "notifications" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolve_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_orders" ADD COLUMN "discount_approved_amount" integer;--> statement-breakpoint
ALTER TABLE "service_orders" ADD COLUMN "discount_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "service_orders" ADD COLUMN "discount_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_discount_approved_by_users_id_fk" FOREIGN KEY ("discount_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Viết tay (không phải drizzle-kit sinh): điền dữ liệu cho các cột mới.
-- 1) Bật email báo nhanh KHÔNG được gửi dồn mọi sự cố đang mở từ trước (5 việc chặn go-live…):
--    coi như đã báo rồi. Chỉ sự cố mở SAU migration này mới được gửi email.
UPDATE "notifications" SET "alerted_at" = now() WHERE "resolved_at" IS NULL;--> statement-breakpoint
UPDATE "notifications" SET "resolve_alerted_at" = now() WHERE "resolved_at" IS NOT NULL;--> statement-breakpoint
-- 2) Lần đăng nhập cuối lấy từ nhật ký đăng nhập thành công.
--    GHI CHÚ SAU KHI CHẠY (20/09/2026): lệnh này KHÔNG điền được gì — loginThrottle xoá nhật ký
--    của email khi đăng nhập thành công, nên bảng không có dòng `success` nào. last_login_at chỉ
--    có từ lần đăng nhập đầu tiên sau migration (store/users.ts — touchLastLogin).
UPDATE "users" u SET "last_login_at" = a.last_ok
FROM (
  SELECT lower("email") AS email, max("attempted_at") AS last_ok
  FROM "login_attempts" WHERE "success" GROUP BY lower("email")
) a
WHERE lower(u."email") = a.email;
