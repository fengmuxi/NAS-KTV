# AGENTS.md — AI 编码助手项目指令

本文件供 AI 编码助手在本仓库工作时遵循。请先完整阅读再动手改代码。

## 通用行为准则

> 以下准则偏重谨慎而非速度；对于琐碎任务，可自行判断取舍。

### 1. 先思考再编码

**不要假设、不要隐瞒困惑、主动暴露权衡。**

动手实现前：
- 明确陈述你的假设；不确定时先提问。
- 存在多种理解时，把选项摆出来，不要默默选一个。
- 若有更简单的方案，直说；该反驳时反驳。
- 任何不清晰之处立即停下，说出困惑点并提问。

### 2. 简单优先

**用最少代码解决问题，不做投机性设计。**

- 不做需求之外的功能。
- 不为一处使用的代码做抽象。
- 不做未被要求的"灵活性/可配置性"。
- 不为不可能发生的场景写错误处理。
- 如果写了 200 行而 50 行就能解决，重写。

自问："资深工程师会觉得这过度复杂吗？" 若是，就简化。

### 3. 外科手术式修改

**只动必须动的，只清理自己造成的烂摊子。**

编辑既有代码时：
- 不"顺手改进"相邻代码、注释或格式。
- 不重构没坏的东西。
- 匹配既有风格，哪怕换成你会写得不同。
- 发现无关的死代码，提出来即可，不要删除。

你的改动造成孤儿引用时：
- 移除**你的改动**导致不再使用的 import / 变量 / 函数。
- 未经要求不删除改动前就存在的死代码。

检验标准：每一行改动都应能追溯到用户的请求。

### 4. 目标驱动执行

**定义可验证的成功标准，循环直到验证通过。**

把任务转化为可验证目标：
- "加校验" → "先写非法输入测试，再让测试通过"
- "修 bug" → "先写能复现它的测试，再让测试通过"
- "重构 X" → "确保重构前后测试都通过"

多步骤任务先给出简短计划：
```
1. [步骤] → 验证: [检查项]
2. [步骤] → 验证: [检查项]
3. [步骤] → 验证: [检查项]
```

强成功标准让你能独立循环；弱标准（"能跑就行"）会不断需要澄清。

### 5. 语言优先级

**回复与输出优先使用简体中文**，所有回答与解释尽量以中文给出。

## 项目概览

飞牛 NAS 家庭 KTV 系统（nasktv），三端协同（Admin Web 管理后台 / Android TV App 播放器 / Mobile H5 点歌端）。后端 Node.js + Express + WebSocket + SQLite（better-sqlite3 + Drizzle ORM），Python 微服务提供 Demucs v4 人声分离与 musicdl 歌曲下载，AI 辅助解析歌曲元数据。pnpm workspace monorepo，无测试/lint 套件。Docker Compose 部署（backend / separator / downloader / web）。

## 目录结构（要点）

- `packages/shared/src/schema/` — 数据库 schema（Drizzle，三端共用）；`src/types/` — 共享类型（ws / api / room / device）
- `packages/backend/src/routes/` — HTTP 路由（统一在 `index.ts` 注册）
- `packages/backend/src/services/` — 业务服务（room / device / song / scanner / separation / ai / settings 等）
- `packages/backend/src/ws/` — WebSocket handlers（在 `src/index.ts` 初始化）
- `packages/backend/drizzle/` — 迁移文件（只追加，禁止修改历史迁移）
- 前端：`packages/admin-web/`（:5173）、`packages/mobile-h5/`（:5174）、`packages/tv-app/`（Tauri，:1420）、`packages/separator/`（FastAPI，:8001）
- 本地数据全部在**项目根 `./data/`**（db / songs / separation / uploads）

## 常用命令

```bash
pnpm install                     # 安装依赖
pnpm dev                         # 启动所有 dev server + :8080 统一反代（自动清理端口）
pnpm build                       # 构建所有 TS 包（含类型检查）
docker compose up -d --build     # Docker 部署

# ⚠️ 首次跑 pnpm dev 前，两个 Python 微服务必须先各自建好 venv（否则会报 venv not found）：
#   pnpm --filter @nasktv/separator run setup
#   pnpm --filter @nasktv/downloader run setup
# （setup 只需执行一次；之后直接 pnpm dev 即可把它们一起拉起。也可 docker compose 部署，无需本地 venv）

pnpm --filter @nasktv/backend dev            # 热重载（:3000）
pnpm --filter @nasktv/backend build          # 类型检查（tsc --noEmit --rootDir ../..）
pnpm --filter @nasktv/backend db:generate    # 生成迁移
pnpm --filter @nasktv/backend db:migrate     # 执行迁移
pnpm --filter @nasktv/backend db:studio      # Drizzle Studio

pnpm --filter @nasktv/admin-web dev|build    # admin-web（mobile-h5 / tv-app 同理）
pnpm --filter @nasktv/tv-app exec tauri android build --apk   # 打包 Android APK（Tauri 2）
pnpm --filter @nasktv/tv-app exec tauri android init          # 首次初始化 Android 工程（一次性）

pnpm --filter @nasktv/separator run setup    # 一键装 Python 环境（uv + venv）
pnpm --filter @nasktv/separator dev          # uvicorn --reload（:8001）
pnpm --filter @nasktv/downloader run setup   # 一键装 Python 环境（uv + venv，musicdl 等）
pnpm --filter @nasktv/downloader dev         # uvicorn --reload（:8002，歌曲下载微服务）
```

## 路径与环境（重要）

- `src/config/index.ts` 以**项目根**（PROJECT_ROOT，本地=仓库根，Docker=`/app`）为基准解析所有相对路径（`DB_PATH` / `SCAN_PATH` / `SEPARATION_OUTPUT_DIR` 等），`.env` 也从项目根加载。
- `pnpm --filter` 下进程 CWD 是**子包目录**，不要假设 CWD 是项目根；DB 中存储的相对路径（如 `data\separation\song_1\vocals.mp3`）同样按项目根解析。
- 关键环境变量见 `.env.example`：`PORT` / `JWT_SECRET` / `DB_PATH` / `SCAN_PATH` / `SEPARATOR_SERVICE_URL` / `SEPARATION_OUTPUT_DIR` / `SEPARATION_CONCURRENCY` / `HF_ENDPOINT`（默认 hf-mirror.com）/ `AI_ENABLED` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_PARSE_CONCURRENCY`。并发数优先级：**settings 表 > 环境变量 > 默认 1**（`getSeparationConcurrency()` / `getAiParseConcurrency()` 在 `settings-service.ts`）。

## 验证与常见坑

- **无测试/lint**：改动后的验证 = 对应包 `build`（前端 `tsc && vite build`，backend `tsc --noEmit --rootDir ../..`）。`@nasktv/shared` 无 build 脚本，禁止对其执行 build。
- **Windows 编辑代码**：用 edit/write 工具修改，**禁止 PowerShell `Set-Content` / `Out-File` 写含中文的代码文件**（曾损坏为 UTF-8 BOM/替换字符导致中文尾字乱码吞并下一行）；文件行尾保持 LF。
- **老库迁移验证**：迁移必须先复制备份 `data/` 历史库副本，再执行 `db:migrate`，确认升级不报错、数据完整后再提交。
- **WS 心跳**：客户端每 25s 发 PING，服务端 60s 无消息强制断开；客户端指数退避重连（1s×2^n 上限 16s，**最多 5 次**），离线超约 1 分钟需用户手动重进房间。

## 强制约束

### 1. Hallmark 设计系统（前端 UI）

- 所有前端 UI 必须通过 `Use Skill: hallmark` 设计与构建，禁止手写无约束的 Tailwind / HTML / CSS。
- 覆盖 8 状态交互（default/hover/focus-visible/active/disabled/loading/error/success）；颜色用 OKLCH `var(--color-*)` 令牌（禁止内联 hex/rgb）；4pt 间距系统。
- 调性：Admin Web → modern-minimal（Coral/Cobalt）；Mobile H5 → editorial（Specimen/Atelier）；TV App → atmospheric（Bloom/Midnight/Aurora）。
- 交互元素必须有 `tabIndex` + `role`（D-pad 导航，TV 端必备）；禁止 `focus:outline-none`（用 `focus-visible:ring`）。
- 新增组件 CSS 首行带 Hallmark stamp 注释。

### 2. 后端路由与 WS 注册位置

- HTTP 路由注册在 `packages/backend/src/routes/index.ts`；WS handlers 在 `src/index.ts` 初始化。
- 房间广播走 `room-service.ts`，设备广播走 `device-service.ts`，禁止在路由层直接广播。

### 3. 数据库变更与老版本兼容（重要）

- **任何 schema 变更都必须生成并执行 Drizzle 迁移**（`db:generate` → `db:migrate`），禁止只改 schema 不写迁移、禁止直接改线上库。
- **禁止破坏性变更**：禁止删除已有列/表/索引、禁止改名、禁止改类型或约束导致旧数据无法读取（除非同时提供数据重建迁移 SQL）。
- 新增列必须有默认值或允许 NULL；新增 NOT NULL 列必须提供启动时异步回填逻辑（参考 `backfillMissingDurations()` / `backfillFileHashes()` 模式，在 `index.ts` 调用）。
- 历史迁移文件（`0000_initial.sql` 起）不可修改，只允许追加新迁移；老库脏数据清洗放迁移 SQL 中（参考 `0006_dedup.sql`）。
- 必须以 `data/` 下的真实老库验证升级不报错、数据不丢失，再提交代码。

### 4. 编码规范

- TypeScript：Drizzle where 用 `eq()`，**禁止 `===`**；避免 `any`；风格遵循 `.prettierrc`（单引号/分号/2 空格/行宽 100/arrowParens: avoid/LF）。
- 日志用 pino，禁止 `console.log`；密码 bcrypt 哈希，鉴权 JWT。
- separator：端口固定 **8001**（不是 8000）；模型 `htdemucs_base` / `htdemucs_ft`；输出 `vocals.mp3` + `instrumental.mp3`（320kbps）；Python >=3.11；模型缓存目录持久化挂载。

## 数据库 Schema 概览

SQLite3 单文件，schema 定义在 `packages/shared/src/schema/`。主要表：`songs` / `artists` / `categories` / `song_categories` / `rooms` / `room_sessions` / `users` / `separation_tasks` / `ai_parse_tasks` / `settings` / `play_history` / `playlists`。

## 数据卷（Docker）

`./data/` 各子目录挂载进容器：`db`（backend 读写）、`songs`（backend 读写 / separator **只读**）、`separation`（backend 与 separator 双向共享）、`uploads`（backend 临时上传）、`separator-cache`（separator 模型缓存，持久化避免重复下载）。

## 禁止事项

- ❌ 禁止手写无约束的 Tailwind / HTML / CSS（必须走 Hallmark 技能）；禁止内联 hex / rgb 颜色。
- ❌ 禁止 `focus:outline-none`（用 `focus-visible:ring`）。
- ❌ 禁止 Drizzle where 使用 `===`（用 `eq()`）。
- ❌ 禁止使用 `console.log`（用 pino）；禁止 separator 使用 8000 端口。
- ❌ 禁止只改 schema 不生成迁移；禁止修改已发布的历史迁移文件（只能追加新迁移）。
- ❌ 禁止对数据库做破坏性变更（删除列/表/索引、改名、改类型）而无老数据兼容与回填方案。
- ❌ 禁止创建文档文件（*.md / README）除非用户明确要求。
- ❌ 禁止在路由层直接做 WS 广播（走对应 service）。

## 工作流程

1. **改前端 UI 前**：先 `Use Skill: hallmark` 获取设计规范，再动手。
2. **改后端前**：先查 `packages/backend/src/routes/index.ts`（路由）；涉及 WS 先查 `src/index.ts` 的 handler 初始化与 `ws/` 目录。
3. **数据库变更（必须先考虑老版本兼容）**：评估现有数据是否受影响（`packages/backend/drizzle/` 已有迁移、`data/` 线上老库）→ 修改 `packages/shared/src/schema/` → `db:generate`（只追加新迁移）→ `db:migrate` → 用真实老库副本验证不报错、数据不丢失 → 需回填则参考 `backfillMissingDurations()` 在 `index.ts` 启动时异步执行。
4. **新增 WS 消息**：在 `packages/shared/src/types/ws.ts` 定义类型 → 对应 `ws/*-handler.ts` 实现 → `index.ts` 注册。
5. **TV App 改动**：注意 D-pad 遥控器导航（`tabIndex` + `role`）；Tauri 2 外壳在 `src-tauri/src/lib.rs`（入口 `main.rs`），移动端需保持 `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 与 `[lib] crate-type` 结构；前端 Tauri API 用 `@tauri-apps/api`（core/event/path）+ `@tauri-apps/plugin-fs`，权限在 `src-tauri/capabilities/default.json`。
6. **人声分离 / AI 解析改动**：同步检查 separator Python 服务与 `separation-queue.ts` / `separator-client.ts`、`ai-parse-service.ts` / `ai-client.ts` / `ai-prompt.ts`。
7. **只改与任务直接相关的代码**：不顺手重构、不补注释、不改格式。

## 参考文档

- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) / [ARCHITECTURE.md](./ARCHITECTURE.md) / [deploy/README.md](./deploy/README.md) / [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) / [.trae/specs/](./.trae/specs/)
