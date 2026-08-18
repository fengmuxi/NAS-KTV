# 飞牛 NAS KTV 系统 — 部署指南

> 本文档聚焦**生产部署（Docker Compose）**。本地开发（环境要求、首次搭建、各子包 dev 启动、数据库迁移、日志、构建、Separator 的 venv 一键脚本 / GPU 检测 / HuggingFace 镜像 / 手动 GPU PyTorch 安装、ffmpeg 安装）请参考 **[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)**。

## 一、项目概览

飞牛 NAS KTV（nasktv）是部署在飞牛 NAS 上的家庭 KTV 系统，三端协同：

| 端 | 说明 | 技术栈 |
|---|------|--------|
| Admin Web | 管理后台 SPA | React 18 + Vite + TailwindCSS |
| Mobile H5 | 手机点歌 H5 | React 18 + Vite + TailwindCSS |
| TV App | 电视播放器 | Tauri 2 (Rust) + React WebView |
| Backend | API + WebSocket | Node.js 20 + Express + SQLite |
| Separator | 人声分离微服务 | Python 3.12 + FastAPI + Demucs v4 |
| Downloader | 歌曲下载微服务 | Python 3.11 + FastAPI + musicdl |

pnpm workspace monorepo，所有子包位于 `packages/` 目录下。生产部署由 4 个服务组成：`backend` / `separator` / `downloader` / `web`（详见第三节）。

---

## 二、本地开发环境

本文档**不重复**本地开发步骤。请移步 **[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)**，包含：

- 环境要求（Node / pnpm / Python / Rust / ffmpeg 等，按子项目按需安装）
- 首次搭建（`pnpm install`、`.env` 配置、数据目录、数据库迁移）
- 各子包 dev 启动与访问地址
- Separator venv 一键脚本、GPU 自动检测、HuggingFace 镜像、手动 GPU PyTorch 安装
- ffmpeg 安装说明

> 生产部署只需要 Docker，不需要在本机装 Node / pnpm / Python / Rust 等开发工具；歌曲文件放进 `data/songs/` 后执行 `docker compose up -d --build` 即可。

---

## 三、生产环境部署（Docker Compose）

### 3.1 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | 飞牛 NAS（原生 Docker 支持）或任何 Linux 主机 |
| CPU 架构 | aarch64 (ARM64) 或 x86_64 |
| Docker | 20.10+ |
| Docker Compose | v2.0+（使用 `docker compose` 命令） |
| 可用内存 | ≥ 2GB（separator 推理需要；不启用分离可降至 512MB） |
| 可用磁盘 | ≥ 10GB（模型缓存 ~80MB + 歌曲库 + 分离结果） |
| 网络 | 局域网可达，手机与电视需能访问 NAS 的 8080 端口 |

> TV App 为 Tauri Android APK，不走 Docker，需单独在开发机用 Android Studio 打包后安装到电视。

### 3.2 部署架构

系统由 4 个 Docker 服务组成，通过 `web` 反向代理对外提供统一入口（8080 端口）：

```
┌─────────────────────────────────────────────────────┐
│  Nginx (web) :8080                                  │
│  ┌─────────────────────────────────────────────┐    │
│  │ /admin/*  → admin-web:80   (管理后台 SPA)    │    │
│  │ /h5/*     → mobile-h5:80   (手机点歌 SPA)    │    │
│  │ /api/*    → backend:3000   (REST API)        │    │
│  │ /ws       → backend:3000   (WebSocket)       │    │
│  │ /         → 302 → /admin/                    │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
         │
    ┌────┴────────────┐
    │ backend         │ ──→ separator:8001  (人声分离，容器内通信)
    │                 │ ──→ downloader:8002 (歌曲下载，容器内通信)
    └─────────────────┘
```

| 服务 | 技术栈 | 容器内端口 | 对外暴露 | 说明 |
|------|--------|-----------|---------|------|
| `backend` | Node.js + Express | 3000 | 3000（可选调试） | API + WebSocket |
| `separator` | Python + Demucs | 8001 | 无 | 人声分离，仅容器内通信 |
| `downloader` | Python + musicdl | 8002 | 无 | 歌曲下载（QQ/酷狗/酷我/网易云/汽水/5SING/波点），仅容器内通信 |
| `admin-web` | React SPA + nginx | 80 | 无（通过 web） | 管理后台静态托管 |
| `mobile-h5` | React SPA + nginx | 80 | 无（通过 web） | 手机点歌 H5 静态托管 |
| `web` | nginx:alpine | 80 | 8080 | 反向代理，统一对外入口 |

### 3.3 数据卷与持久化

| 宿主机目录 | 容器内路径 | 用途 | 挂载服务 |
|-----------|-----------|------|---------|
| `data/db` | `/app/data/db` | SQLite 数据库 | backend（读写） |
| `data/songs` | `/app/data/songs` | 歌曲库原始文件 | backend（读写）、separator（只读） |
| `data/separation` | `/app/data/separation` | 分离结果输出 | backend、separator（读写共享） |
| `data/uploads` | `/app/data/uploads` | 上传临时目录 | backend（读写） |
| `data/separator-cache` | `/app/cache` | Demucs 模型缓存（~80MB） | separator（读写） |
| `data/downloader-cache` | `/app/data/downloader-cache` | 下载器运行缓存（搜索结果/临时态） | downloader（读写） |

> **重要**：`data/db` 和 `data/songs` 是核心数据，必须备份。

### 3.4 首次部署

```bash
# 1. 克隆仓库
git clone <仓库地址> nasktv
cd nasktv

# 2. 复制环境变量模板并修改
cp .env.example .env
vi .env
# 必须修改：
#   JWT_SECRET=<随机强密钥>    # openssl rand -hex 32
#   ADMIN_PASSWORD=<强密码>
# 建议修改：
#   AI_ENABLED=true            # 如需 AI 解析
#   AI_API_KEY=<你的 API Key>

# 3. 创建数据目录
mkdir -p data/{db,songs,separation,uploads,separator-cache,downloader-cache}

# 4. 将歌曲文件放入 data/songs/（可选，也可通过后台上传）
cp /path/to/your/songs/*.mp3 data/songs/

# 5. 构建并启动所有服务
docker compose up -d --build

# 6. 查看启动状态
docker compose ps

# 7. 查看日志确认无错误
docker compose logs -f backend
docker compose logs -f separator
docker compose logs -f downloader
```

### 3.5 生产环境访问地址

| 入口 | 地址 |
|------|------|
| 管理后台 | `http://NAS_IP:8080/admin/` |
| 手机 H5 | `http://NAS_IP:8080/h5/` |
| API | `http://NAS_IP:8080/api/` |
| WebSocket | `ws://NAS_IP:8080/ws` |
| 健康检查 | `http://NAS_IP:8080/api/health` |

> 将 `NAS_IP` 替换为飞牛 NAS 的实际局域网 IP。访问 `/admin` 和 `/h5` 时建议带尾部斜杠。

### 3.6 首次登录

- 管理后台地址：`http://NAS_IP:8080/admin/`
- 默认账号：`.env` 中 `ADMIN_USERNAME` 的值（默认 `admin`）
- 默认密码：`.env` 中 `ADMIN_PASSWORD` 的值（默认 `admin123`，**务必修改**）

### 3.7 环境变量配置

所有环境变量定义在项目根目录 `.env` 文件中，`docker compose` 会自动读取。完整说明见 `.env.example`。

#### 后端基础

| 变量 | 默认值 | 说明 | 是否必改 |
|------|--------|------|---------|
| `PORT` | `3000` | 后端端口（容器内固定） | 否 |
| `NODE_ENV` | `production` | Docker 部署自动设为 production | 否 |
| `JWT_SECRET` | `your-jwt-secret-change-me` | JWT 签名密钥 | **必改** |
| `DB_PATH` | `/app/data/db/nasktv.db` | SQLite 路径（容器内） | 否 |
| `ADMIN_USERNAME` | `admin` | 管理员用户名 | 否 |
| `ADMIN_PASSWORD` | `admin123` | 管理员密码 | **必改** |
| `SCAN_PATH` | `/app/data/songs` | 歌曲扫描目录（容器内） | 否 |

#### 人声分离

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SEPARATOR_SERVICE_URL` | `http://separator:8001` | 分离服务地址（Docker 自动设为容器名） |
| `SEPARATION_OUTPUT_DIR` | `/app/data/separation` | 分离结果目录（容器内） |
| `SEPARATION_AUTO_ENABLE` | `true` | 新歌自动触发分离 |
| `SEPARATION_CONCURRENCY` | `2` | 最大并发分离数 |
| `FFMPEG_PATH` | 留空 | ffmpeg 路径（容器内已预装，无需设置） |
| `HF_ENDPOINT` | 留空 | HuggingFace 镜像（容器内已设为 hf-mirror.com） |

#### AI 解析

| 变量 | 默认值 | 说明 | 是否必改 |
|------|--------|------|---------|
| `AI_ENABLED` | `false` | AI 功能总开关 | 否 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | AI API 地址 | 否 |
| `AI_API_KEY` | 留空 | AI API 密钥 | 启用时必填 |
| `AI_MODEL` | `gpt-4o-mini` | 模型名称 | 否 |
| `AI_AUTO_PARSE_AFTER_SCAN` | `true` | 扫描后自动解析 | 否 |

#### 歌曲下载

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DOWNLOADER_SERVICE_URL` | `http://downloader:8002` | 下载服务地址（Docker 自动设为容器名） |
| `DOWNLOAD_CONCURRENCY` | `2` | 最大并发下载数（防止压垮人声分离队列） |
| `ENABLED_SOURCES` | 留空（启用全部） | 启用的音乐平台源，逗号分隔的 musicdl 短名：`qq,kugou,kuwo,netease,soda,fivesing,bodian` |

兼容的 AI 服务商：OpenAI / DeepSeek / 通义千问 / Moonshot / 本地 Ollama 等。

---

## 四、常用运维命令

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 重新构建并启动（代码更新后使用）
docker compose up -d --build

# 查看所有服务状态
docker compose ps

# 查看某个服务的实时日志
docker compose logs -f backend
docker compose logs -f separator
docker compose logs -f downloader
docker compose logs -f web

# 进入容器调试
docker compose exec backend sh
docker compose exec separator bash
docker compose exec downloader bash

# 查看资源占用
docker stats
```

---

## 五、数据备份与恢复

### 必须备份

- `data/db/nasktv.db` — SQLite 数据库（歌曲元数据、用户、房间、设备授权等）
- `data/songs/` — 歌曲库原始文件
- `.env` — 环境变量配置（含 JWT_SECRET）

### 可选备份

- `data/separation/` — 分离结果（丢失后可重新触发分离任务生成）
- `data/separator-cache/` — 模型缓存（丢失后需重新下载约 80MB）
- `data/downloader-cache/` — 下载器运行缓存（丢失无影响，下次运行自动重建）

### 备份命令

```bash
# 备份数据库（带日期戳）
cp data/db/nasktv.db data/db/nasktv.db.bak.$(date +%Y%m%d)

# 全量备份（含配置）
tar -czf nasktv-backup-$(date +%Y%m%d).tar.gz \
  data/db/nasktv.db data/songs/ .env docker-compose.yml
```

### 恢复

```bash
docker compose down
cp data/db/nasktv.db.bak.20260730 data/db/nasktv.db
tar -xzf songs-backup-20260730.tar.gz
docker compose up -d
```

---

## 六、升级流程

```bash
# 1. 备份数据（重要！）
cp data/db/nasktv.db data/db/nasktv.db.bak.$(date +%Y%m%d)

# 2. 拉取最新代码
git pull

# 3. 检查 .env.example 是否有新增配置项，同步到本地 .env
diff .env.example .env

# 4. 重新构建并启动
docker compose up -d --build

# 5. 查看日志确认无错误
docker compose logs -f backend
docker compose logs -f downloader
```

> 数据卷自动保留，无需手动迁移。如 schema 有变更，backend 启动时会自动执行迁移。

---

## 七、常见问题排查

### 7.1 端口冲突（8080 被占用）

修改 `docker-compose.yml` 中 `web` 服务的端口映射：
```yaml
web:
  ports:
    - "9090:80"  # 改为其他可用端口
```

### 7.2 权限问题（data 目录无法写入）

```bash
chmod -R 777 data           # 简单方案
# 或
chown -R 1001:1001 data     # 更安全
```

### 7.3 模型下载慢（首次分离时下载 Demucs 约 80MB）

- 模型缓存于 `data/separator-cache`，下载完成后后续无需重复下载
- 容器内已默认配置 `HF_ENDPOINT=https://hf-mirror.com` 国内镜像
- 查看下载进度：`docker compose logs -f separator`

### 7.4 Separator 报错 No module named 'xxx'

依赖文件 `packages/separator/requirements.txt` 中应包含所有必要依赖。如遇缺失：
1. 将缺失的包添加到 `requirements.txt`
2. 重新构建：`docker compose up -d --build separator`

### 7.5 分离任务失败

```bash
# 查看 separator 日志
docker compose logs -f separator

# 检查 ffmpeg 是否可用
docker compose exec separator ffmpeg -version

# 确认音频格式受支持：mp3, flac, m4a, wav, ogg, mp4, mkv
```

### 7.6 下载任务失败 / 搜索无结果

- 下载器依赖第三方音乐解析源，**稳定性随平台政策变动**，部分歌曲/平台可能临时不可用，属正常现象
- 先在管理后台「歌曲下载」页确认勾选的平台中是否有可用源；若所有源都失败，多为解析源整体抖动，稍后重试
- 查看下载器日志：`docker compose logs -f downloader`
- 检查下载目录权限：`docker compose exec downloader ls -l /app/data/songs/Downloads`
- 重新构建（改动依赖后）：`docker compose up -d --build downloader`
- 歌词缺失：部分平台常无 LRC 歌词，与 KTV 同步歌词弱冲突，可手动在后台补歌词

#### torchaudio 后端降级

torchaudio 2.9+ 默认要求 `torchcodec` 后端。当 `torchcodec` 未安装时，系统会自动降级：
1. 尝试 torchaudio 默认后端
2. 尝试 soundfile 后端
3. 尝试 ffmpeg 后端
4. 直接调用 ffmpeg 子进程解码/编码

Docker 镜像中已安装 `soundfile` 和 `ffmpeg`，降级链完整可用。如看到 `TorchCodec is required` 警告属正常现象，不影响功能。

### 7.6 admin/h5 页面空白

- 确认通过 `http://NAS_IP:8080/admin/` 与 `http://NAS_IP:8080/h5/`（带尾部斜杠）访问
- 打开浏览器开发者工具 Console 检查资源路径
- 检查 web 服务日志：`docker compose logs -f web`

### 7.7 手机无法扫码加入房间

1. 确认手机与 NAS 在同一局域网
2. 确认手机能访问 `http://NAS_IP:8080/h5/`
3. 确认电视端 App 已启动且已获得管理员授权
4. 检查 backend 日志：`docker compose logs -f backend`

### 7.8 HuggingFace 模型下载超时

```bash
# 检查镜像配置
docker compose exec separator env | grep HF_ENDPOINT

# 手动设置镜像源（在 .env 中添加）
HF_ENDPOINT=https://hf-mirror.com

# 重启 separator
docker compose restart separator
```

---

## 八、安全建议

1. **修改默认密码**：部署后立即修改 `ADMIN_PASSWORD`
2. **强随机 JWT_SECRET**：使用 `openssl rand -hex 32` 生成
3. **限制网络访问**：不要将 8080 端口暴露到公网，仅限局域网
4. **定期备份**：至少备份 `data/db/nasktv.db` 和 `data/songs/`
5. **HTTPS**：如需外网访问，在前端加 HTTPS 反代（Caddy / Nginx + Certbot）
6. **AI API Key 保护**：`.env` 文件权限设为 600

---

## 九、TV App 打包（单独流程）

TV App 不走 Docker，需在开发机单独打包。完整的本地开发环境搭建（Rust / JDK 17 / Android SDK / NDK / cargo 镜像 / Windows 踩坑）见 **[docs/DEVELOPMENT.md §4.5](../docs/DEVELOPMENT.md#45-tv-appandroid-tv-app--tauri-2)**。

```bash
# 前置条件：Node.js + pnpm + Rust + JDK 17+ + Android SDK (platform 36) + NDK 26+
# 环境变量：JAVA_HOME / ANDROID_HOME / NDK_HOME
cd packages/tv-app

# 安装依赖
pnpm install

# 添加 Android 编译目标（4 个 ABI）
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 初始化 Android 工程（仅首次）
pnpm exec tauri android init

# 打包 APK（Release）
pnpm --filter @nasktv/tv-app exec tauri android build --apk

# 产物路径：packages/tv-app/src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
# 将 APK 传输到电视安装
```

**Windows 环境搭建要点**（2026-08 实测通过）：

```powershell
# 1. Rust + Android targets
rustup-init.exe -y --default-toolchain stable-msvc --profile minimal
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 2. JDK 17（Tauri 2 必需，旧 JDK 1.8 不可用）
setx JAVA_HOME "C:\Program Files\Java\jdk-17.0.11"

# 3. Android SDK cmdline-tools + NDK + Platform（sdkmanager 需 JDK 17）
setx ANDROID_HOME "C:\Users\<用户>\AppData\Local\Android\Sdk"
"%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" --install "platforms;android-36" "ndk;26.3.11579264"
setx NDK_HOME "%ANDROID_HOME%\ndk\26.3.11579264"

# 4. VS2022 Build Tools C++ 工具链（cargo 交叉编译 Android 前，宿主编译需要 MSVC 14.29+）
vs_buildtools.exe --quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended

# 5. cargo 国内镜像 + 代理规避（否则拉依赖会卡住/报 ECONNRESET）
#    编辑 %USERPROFILE%\.cargo\config.toml：rsproxy-sparse（sparse+https://rsproxy.cn/index/）
#    打包命令前临时设置：$env:NO_PROXY="*"
```

**已知问题速查**：
- Windows 报 `Failed to create a symbolic link` → 开启系统「开发者模式」，或改用 `gradlew assembleDebug`
- 首次打包耗时 10-20 分钟（Rust 依赖编译 + 4 ABI 交叉编译），之后增量很快
- 完整踩坑记录与开发流程见 [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) §4.5.7

**桌面版打包（Windows 本机运行，不需 JDK/Android SDK）**：

```powershell
# 仅需 Rust + MSVC 工具链；前端会自动先 build
pnpm --filter @nasktv/tv-app exec tauri build --bundles nsis

# 产物：
#   便携 exe：packages/tv-app/src-tauri/target/release/nasktv.exe
#   安装包：  packages/tv-app/src-tauri/target/release/bundle/nsis/NASKTV_<版本>_x64-setup.exe
```

- 若配置了 cargo 代理，打包前临时 `$env:NO_PROXY="*"`（同 APK 打包）
- 首次打包约 3-5 分钟（Rust release 编译），之后增量很快
- 可执行文件依赖 WebView2 运行时（Win10/11 自带，旧系统需装 WebView2 Runtime）
