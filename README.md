# 飞牛 NAS KTV 系统（nasktv）

![Release](https://img.shields.io/github/v/release/fengmuxi/NAS-KTV?label=release)
![License](https://img.shields.io/github/license/fengmuxi/NAS-KTV)
![Build](https://github.com/fengmuxi/NAS-KTV/actions/workflows/release.yml/badge.svg)

部署在飞牛 NAS 上的家庭 KTV 系统，通过三端协同提供完整的点歌与演唱体验：**Admin Web**（管理员后台）负责歌曲库管理、MV/音频上传、人声分离任务监控、设备授权与 AI 辅助解析配置；**TV App**（Android TV 端播放器，Tauri 2 外壳）负责大屏播放、原伴唱切换、歌词同步与遥控器操作；**Mobile H5**（手机点歌端）负责扫码加入房间、搜索点歌、队列管理与播放控制。

## 核心特色

- **AI 人声分离（Demucs v4）**：自动分离人声与伴奏，实现原伴唱无缝切换，无需准备双音轨。
- **AI 辅助解析（OpenAI 兼容接口）**：歌曲入库后自动解析歌手、分类、语种、年代，降低人工标注成本。
- **设备授权机制**：电视端 App 安装时生成固定房间码，默认未授权，管理员可临时或永久授权。
- **多房间支持**：一台 NAS 可同时服务多台电视，房间之间相互隔离。
- **NAS 本地化部署**：SQLite 单文件存储，Docker Compose 一键部署，数据全量留存在本地。

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 编程语言 | TypeScript（主） / Python（分离服务） / Rust（Tauri 外壳） |
| 后端 | Node.js LTS 20+ / Express / WebSocket (ws) / SQLite3 (better-sqlite3) / Drizzle ORM / JWT + bcrypt / pino |
| 前端（Admin Web + Mobile H5） | React 18 + TypeScript / Vite / TailwindCSS / React Router DOM / Zustand / Axios / lucide-react / sonner / react-hook-form |
| TV App | Tauri 2 (Rust) 外壳 + React + Vite WebView / HTML5 video/audio + Web Audio API / qrcode |
| 人声分离 | FastAPI (Python) / Demucs v4 (htdemucs_base / htdemucs_ft) / ffmpeg + torchaudio / uv 包管理 |
| 包管理 | pnpm workspace（monorepo） |
| 部署 | Docker 多阶段构建 / Docker Compose / Nginx 反向代理 |

## 项目结构（要点）

```
nasktv/
├── packages/
│   ├── backend/          # Node.js API + WebSocket（端口 3000）
│   ├── admin-web/        # 管理后台 SPA（端口 5173 dev）
│   ├── mobile-h5/        # 手机点歌 H5 SPA（端口 5174 dev）
│   ├── tv-app/           # Tauri Android TV App
│   ├── separator/        # Python + Demucs 人声分离微服务（端口 8001）
│   └── shared/           # 共享类型与 Drizzle schema
├── deploy/               # 生产部署文档
├── docs/                 # 开发 / API 文档
├── .github/              # CI/CD 工作流与密钥说明
├── docker-compose.yml    # 5 服务编排（backend + separator + web + admin-web + mobile-h5）
├── .env.example          # 环境变量示例
└── package.json
```

## 快速启动

### 本地开发

```bash
pnpm install                     # 安装依赖
pnpm dev                         # 启动所有 dev server + :8080 统一反代
```

首次运行还需：复制 `.env.example` 为 `.env`、创建 `data/` 目录、执行数据库迁移。完整的环境要求、各子包开发命令、ffmpeg 安装、调试与 FAQ 见 **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**。

### 生产部署（飞牛 NAS）

```bash
docker compose up -d --build
```

部署架构、数据卷、运维命令、备份/升级、安全与 TV App 打包见 **[deploy/README.md](./deploy/README.md)**。

## CI/CD 与版本管理

本项目使用 **GitHub Actions + release-please** 实现全自动的版本管理、打包与发布。打 `v*` tag 时自动构建 Docker 镜像、TV 桌面端与安卓端，并把产物挂到 GitHub Release。

| 文件 | 触发 | 作用 |
|------|------|------|
| `.github/workflows/version.yml` | 推送 `main` | release-please：解析约定式提交，开/更新 Release PR、算版本、维护 `CHANGELOG.md`、打 tag、建 Release |
| `.github/workflows/docker.yml` | tag（`v*`） | 矩阵构建 `backend` / `separator` / `web`，多架构 `linux/amd64 + arm64`，推送阿里云 ACR |
| `.github/workflows/desktop.yml` | tag（`v*`） | TV 桌面端：Windows（`x86_64`/`i686`）+ macOS（`x86_64`/`aarch64`），**无签名** |
| `.github/workflows/android.yml` | tag（`v*`） | TV 安卓端：`arm64-v8a`(64) / `armeabi-v7a`(32)，`tauri android build --apk`，**无签名** |
| `.github/workflows/release.yml` | tag（`v*`） | 编排器：等 Release 就绪后串行调用上面三个构建任务，并挂产物 |

> 完整的密钥与环境变量清单（含 ACR 配置、自动变量、已移除的签名密钥、与后端运行时变量的区别）见 [.github/CI.md](./.github/CI.md)。

### 提交信息约定（决定版本号）

| 前缀 | 示例 | 版本变化（当前 0.1.0） |
|------|------|------------------------|
| `feat:` | `feat: 新增歌单批量导入` | 0.1.0 → **0.2.0** |
| `fix:` | `fix: 修复二维码刷新闪烁` | 0.1.0 → **0.1.1** |
| `feat!:` 或含 `BREAKING CHANGE:` | `feat!: 重构房间协议` | 0.1.0 → **1.0.0** |
| `chore:` / `docs:` / `refactor:` / `perf:` | `chore: 升级依赖` | 不升版本（仍进 Release 说明） |

**日常节奏**：按约定提交到 `main` → release-please 自动开/更新「Release vX.Y.Z」PR → 合并该 PR 即完成打 tag + 发布 + 构建。不要手动改版本号、手动打 tag 或手动建 Release（会与机器人冲突）。

## 文档导航

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 系统架构（架构图 / 服务划分 / 通信机制 / WebSocket 消息 / 数据流 / 数据库概览 / 数据卷）
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — 本地开发指南（环境 / 各子包命令 / 环境变量 / 调试 / 规范）
- [docs/API.md](./docs/API.md) — REST API 接口参考
- [deploy/README.md](./deploy/README.md) — 生产部署指南
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) — 开发路线图与规划历史
- [.github/CI.md](./.github/CI.md) — CI/CD 密钥与环境变量说明
- [AGENTS.md](./AGENTS.md) — AI 编码助手项目指令
- [.env.example](./.env.example) — 环境变量完整示例

## License

[MIT](./LICENSE) © 2026 fengmuxi
