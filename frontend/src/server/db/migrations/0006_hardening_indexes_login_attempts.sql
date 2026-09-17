CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"success" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD COLUMN "last_run_status" text;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD COLUMN "last_run_summary" text;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD COLUMN "last_run_source" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "specialty" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "login_attempts_email_time_idx" ON "login_attempts" USING btree ("email","attempted_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE INDEX "appointments_scheduled_at_idx" ON "appointments" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attendance_logs_employee_time_idx" ON "attendance_logs" USING btree ("employee_id","clock_in_at");--> statement-breakpoint
CREATE INDEX "invoices_issued_at_idx" ON "invoices" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "part_transactions_part_id_idx" ON "part_transactions" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_transactions_order_id_idx" ON "part_transactions" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "part_transactions_created_at_idx" ON "part_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "parts_branch_id_idx" ON "parts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "parts_category_idx" ON "parts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "purchase_ledger_posting_date_idx" ON "purchase_ledger" USING btree ("posting_date");--> statement-breakpoint
CREATE INDEX "purchase_ledger_partner_idx" ON "purchase_ledger" USING btree ("partner_name");--> statement-breakpoint
CREATE INDEX "purchase_ledger_invoice_status_idx" ON "purchase_ledger" USING btree ("invoice_status");--> statement-breakpoint
CREATE INDEX "sales_ledger_voucher_date_idx" ON "sales_ledger" USING btree ("voucher_date");--> statement-breakpoint
CREATE INDEX "sales_ledger_partner_idx" ON "sales_ledger" USING btree ("partner_name");--> statement-breakpoint
CREATE INDEX "service_order_labors_order_id_idx" ON "service_order_labors" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_labors_technician_id_idx" ON "service_order_labors" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "service_order_parts_order_id_idx" ON "service_order_parts" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_parts_part_id_idx" ON "service_order_parts" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "special_orders_order_id_idx" ON "service_order_special_orders" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "special_orders_status_idx" ON "service_order_special_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_orders_status_idx" ON "service_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_orders_vehicle_id_idx" ON "service_orders" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "service_orders_customer_id_idx" ON "service_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_orders_branch_id_idx" ON "service_orders" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "service_orders_received_at_idx" ON "service_orders" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "service_orders_delivered_at_idx" ON "service_orders" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "users_employee_id_idx" ON "users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "vehicles_customer_id_idx" ON "vehicles" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "vehicles_next_service_at_idx" ON "vehicles" USING btree ("next_service_at");