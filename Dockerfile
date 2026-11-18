# syntax=docker/dockerfile:1
# INCH 生产镜像。三个 target：api（Fastify 后端）、web（Caddy + 前端静态文件）。
# db 使用官方 postgres 镜像，见 docker-compose.yml。

# ---------- 后端：编译 ----------
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npm run build

# ---------- 后端：仅生产依赖（argon2 是原生模块，需要编译工具链）----------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------- 前端：编译 ----------
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 运行时：API ----------
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY --from=backend-build /app/dist ./dist
# migrate.ts 用 ../migrations/ 解析目录，编译后位于 dist/src/，所以放进 dist/migrations。
COPY backend/migrations ./dist/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","dist/src/server.js"]

# ---------- 运行时：Web ----------
FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /app/dist /srv
EXPOSE 80 443
