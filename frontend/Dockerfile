# App ANSER Auto cho bản TỰ HOST — chạy cùng n8n trong docker-compose.yml (profile "app").
#
# Vì sao cần: trước đây bản tự host chạy app bằng `npm run dev`/`npm start` ngoài Docker, không
# ai khởi động lại khi nó chết, và không có gì chạy theo lịch ngoài n8n. Container này có
# `restart: unless-stopped` + lịch nội bộ (INTERNAL_SCHEDULER=true), và n8n gọi thẳng
# http://app:3000 trong mạng compose.
#
# Migration KHÔNG chạy trong image (drizzle-kit là devDependency): chạy `npm run db:migrate`
# từ máy có mã nguồn trước khi dựng bản mới — xem README §Tự host.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `output: "standalone"` chỉ bật khi dựng image (xem next.config.ts) — `npm start` trên máy
# dev và Vercel giữ nguyên như cũ.
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Thư mục sao lưu thuộc user `app` TRƯỚC khi gắn volume: Docker chép quyền sở hữu này sang
# volume mới tạo — không có bước này, volume thuộc root và mọi lần sao lưu lỗi "EACCES".
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/backups && chown app:app /app/backups
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
# `?live=1`: chỉ hỏi tiến trình còn trả lời không, không chạm DB — Neon ngủ đông không được
# làm Docker coi app là hỏng. Sức khoẻ SÂU (DB, bộ canh gác) do workflow n8n hỏi /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/api/health?live=1" >/dev/null || exit 1
CMD ["node", "server.js"]
