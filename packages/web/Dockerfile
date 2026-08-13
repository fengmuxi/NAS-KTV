# Stage 1: build admin-web
FROM node:20-alpine AS admin-build
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/admin-web/package.json ./packages/admin-web/
RUN pnpm install --frozen-lockfile --filter @nasktv/admin-web
COPY tsconfig.base.json ./
COPY packages/admin-web ./packages/admin-web/
# 前端构建期参数：留空则前端用 `${window.location.origin}/api`（同源相对路径，配合 nginx 反代）；
# 跨域部署（前端与后端不同源）时由 CI 通过 --build-arg 注入绝对地址。
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @nasktv/admin-web build

# Stage 2: build mobile-h5
FROM node:20-alpine AS h5-build
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/mobile-h5/package.json ./packages/mobile-h5/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter @nasktv/mobile-h5...
COPY tsconfig.base.json ./
COPY packages/mobile-h5 ./packages/mobile-h5/
COPY packages/shared ./packages/shared/
# 同 admin-build：跨域部署时由 CI 注入 VITE_API_BASE_URL
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @nasktv/mobile-h5 build

# Stage 3: production with nginx（同时托管 admin-web + mobile-h5 + 反代 backend）
FROM nginx:alpine
COPY --from=admin-build /app/packages/admin-web/dist /usr/share/nginx/html/admin
COPY --from=h5-build /app/packages/mobile-h5/dist /usr/share/nginx/html/h5
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
