# NASKTV 日志系统优化改动清单

本次在「分析 → 实现」中落地了两批改动（P0 + P1 + P2），均已通过 backend tsc 与 admin-web build。

## P0 — 直接提升排障效率（已实现）
1. **时间范围过滤时区修复**
   - `packages/backend/src/services/log-service.ts`：`queryLogs` 改用 `new Date()` 转 epoch 毫秒做数值比较，不再用 ISO 字符串字典序（非 UTC 环境会误判为空）。
   - `packages/admin-web/src/api/logs.ts`：`fetchLogs` 发送前把 `datetime-local` 转 epoch 毫秒。
2. **前端渲染 meta（错误栈/请求上下文）**
   - `packages/admin-web/src/pages/Logs.tsx`：每条日志下方增加可折叠 `<details>` 展示 `entry.meta`，`error` 级别默认展开；新增 `safeStringify` 防止序列化异常。

## P1 — 全链路覆盖（已实现）
3. **downloader 日志接入**
   - `packages/downloader/app/main.py`：新增 `MemoryLogHandler` 内存缓冲 + `/api/logs` 端点（结构与 separator 一致）。
   - `packages/backend/src/services/downloader-log-poller.ts`：新增轮询器（5s，`:8002/api/logs`，service=downloader）。
   - `packages/backend/src/index.ts`：注册 `startDownloaderLogPoller`，并在 SIGTERM/SIGINT 停止。
   - `packages/admin-web/src/pages/Logs.tsx`：服务下拉新增「Downloader」。

## P2 — 体验打磨（已实现）
4. **日志导出**
   - `packages/backend/src/routes/logs.ts`：新增 `GET /system/logs/export`，支持 `format=json|csv`（沿用筛选条件，CSV 带 BOM）。
   - `packages/admin-web/src/api/logs.ts`：新增 `exportLogs`（带 token 下载 blob）。
   - `packages/admin-web/src/pages/Logs.tsx`：底部新增「导出 JSON」「导出 CSV」按钮。
5. **运行时调级**
   - `packages/backend/src/logger.ts`：新增 `setLogLevel`（允许 trace/debug/info/warn/error/fatal）。
   - `packages/backend/src/routes/logs.ts`：新增 `PATCH /system/logs/level`（body `{level}`）。
6. **移除 oklch 高亮**
   - `packages/admin-web/src/pages/Logs.tsx`：`highlightMatches` 的 `color-mix(in oklch,...)` 改为显式 `rgba(217,119,6,0.22)`。
7. **轮询去重稳健化**
   - `separator-log-poller.ts` / `downloader-log-poller.ts`：单次拉取上限 50 → 200，降低 5s 内日志突发被截断丢失的风险。

## 校验
- backend `tsc --noEmit`：通过（exit 0）。
- admin-web `tsc + vite build`：通过。

## 未做（后续可选）
- 日志落盘 / 持久化（重启仍清空，仅内存缓冲 5000）。
- 请求追踪 id（traceId）串联一次请求链。
- WS 实时流服务端 keyword/时间过滤（前端已在客户端过滤 keyword，时间过滤对实时流意义有限）。

## 验证建议
本地 `pnpm dev` 启动 backend + downloader 后，打开 Admin「系统日志」页：切换 Downloader 服务、按级别/时间筛选、点击「导出 JSON/CSV」、用 PATCH 调级验证后端 verbose 日志。
