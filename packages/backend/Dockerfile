# 声明 VITE_API_BASE_URL：docker.yml 通过 --build-arg 把它透传给所有镜像，
# 本镜像虽不消费该参数，声明后可消除 buildx "build arg 未消费" 的告警。
ARG VITE_API_BASE_URL

FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter @nasktv/backend...

# 生产依赖：仅安装 dependencies（不含 devDependencies），大幅缩小镜像
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @nasktv/backend...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
# NOTE: skipped tsc --noEmit — production image uses tsx (JIT), no precompile needed.
# Type errors are caught by desktop/android CI builds which run full tsc.
COPY packages/backend/src ./packages/backend/src/
COPY packages/backend/assets ./packages/backend/assets/
COPY packages/backend/package.json ./packages/backend/
COPY packages/backend/drizzle ./packages/backend/drizzle/
COPY packages/shared/src ./packages/shared/src/
COPY packages/shared/package.json ./packages/shared/

FROM node:20-alpine AS production
RUN addgroup --system --gid 1001 nasktv && \
    adduser --system --uid 1001 nasktv
WORKDIR /app
COPY --from=build --chown=nasktv:nasktv /app/packages/backend/src ./packages/backend/src
COPY --from=build --chown=nasktv:nasktv /app/packages/backend/assets ./packages/backend/assets
COPY --from=build --chown=nasktv:nasktv /app/packages/backend/package.json ./packages/backend/
COPY --from=build --chown=nasktv:nasktv /app/packages/backend/drizzle ./packages/backend/drizzle
COPY --from=build --chown=nasktv:nasktv /app/packages/shared/src ./packages/shared/src
COPY --from=build --chown=nasktv:nasktv /app/packages/shared/package.json ./packages/shared/
COPY --from=prod-deps --chown=nasktv:nasktv /app/node_modules ./node_modules
RUN mkdir -p data/db data/songs data/separation data/uploads && \
    chown -R nasktv:nasktv data
USER nasktv
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "packages/backend/src/index.ts"]
