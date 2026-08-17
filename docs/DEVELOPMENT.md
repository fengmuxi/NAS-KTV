# 飞牛 NAS KTV 系统 — 本地开发指南

> 本文档面向开发者在本机进行 nasktv 项目的开发与调试。生产部署请参考 [../deploy/README.md](../deploy/README.md)。

## 一、开发环境要求

### 1.1 必需依赖（开发后端 + Admin Web + Mobile H5）

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | LTS 20+ | 推荐 20.10+，使用 nvm/fnm 管理 |
| pnpm | 8+ | `npm install -g pnpm` 安装 |
| Git | 最新 | 克隆仓库 |

### 1.2 可选依赖（按子项目需要安装）

| 依赖 | 版本 | 用途 | 何时需要 |
|------|------|------|---------|
| Python | 3.11+ | separator 人声分离服务 | 开发 separator 时 |
| uv | 最新 | Python 包管理 | 开发 separator 时 |
| ffmpeg | 6+ | 音频转码 | 开发 separator 时 |
| Rust | stable | Tauri 外壳编译 | 开发 TV App 时 |
| Tauri CLI | 2.0 | TV App 构建工具链 | 开发 TV App 时 |
| Android Studio + NDK | 最新 | 打包 Android TV APK | 打包 TV App 时 |
| Docker Desktop | 20.10+ | 本地 Docker 部署验证 | 集成测试时 |

> **快速开始**：若仅开发后端 + 前端，只需安装 Node.js + pnpm。

### 1.3 推荐开发工具

- **IDE**：VS Code / Trae / WebStorm
- **插件**：ESLint / Prettier / Tailwind CSS IntelliSense / Rust Analyzer（TV App）
- **浏览器**：Chrome / Edge（含 React DevTools）
- **API 调试**：VS Code Thunder Client / Postman / curl
- **SQLite 可视化**：DB Browser for SQLite / TablePlus

## 二、项目结构

```
d:\gitee\nasktv\
├── packages/                    # monorepo 子项目
│   ├── backend/                 # Node.js API + WebSocket（:3000）
│   ├── admin-web/               # 管理后台 SPA（:5173）
│   ├── mobile-h5/               # 手机点歌 H5 SPA（:5174）
│   ├── tv-app/                  # Tauri Android TV App（:1420）
│   ├── separator/               # Python + Demucs 分离服务（:8001）
│   └── shared/                  # 共享类型与 Drizzle schema
├── deploy/                      # 部署文档
├── docs/                        # 开发文档（本文件）
├── .trae/specs/                 # 各阶段规格说明
├── data/                        # 运行时数据（gitignored）
├── docker-compose.yml           # Docker 编排
├── nginx.conf                   # 根反向代理配置
├── .env.example                 # 环境变量模板
├── .env                         # 本地环境变量（gitignored，需手动创建）
├── pnpm-workspace.yaml
├── package.json
├── AGENTS.md                    # AI 助手项目指令
├── ARCHITECTURE.md              # 系统架构
├── README.md                    # 项目总览
└── DEVELOPMENT_PLAN.md          # 开发计划
```

## 三、首次启动

### 3.1 克隆并安装依赖

```bash
git clone <仓库地址> nasktv
cd nasktv

# 安装所有 workspace 依赖（自动处理内部链接）
pnpm install
```

### 3.2 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 修改 .env 中的关键配置（本地开发用默认值即可）
# 必改：JWT_SECRET（开发环境可随意，生产必改）
# 可选：ADMIN_PASSWORD（默认 admin123）
```

**本地开发推荐配置**（`.env`）：

```bash
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
JWT_SECRET=dev-secret-change-in-production
DB_PATH=./data/db/nasktv.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
SCAN_PATH=./data/songs
SEPARATOR_SERVICE_URL=http://localhost:8001
SEPARATION_OUTPUT_DIR=./data/separated
SEPARATION_AUTO_ENABLE=false
AI_ENABLED=false
VITE_API_BASE_URL=http://localhost:3000/api
VITE_WS_BASE_URL=ws://localhost:3000
```

### 3.3 创建数据目录

```bash
mkdir -p data/{db,songs,separated,uploads,separator-cache}
```

### 3.4 初始化数据库

```bash
# 生成迁移（schema 变更后执行）
pnpm --filter @nasktv/backend drizzle-kit generate

# 执行迁移（首次启动或 schema 变更后）
pnpm --filter @nasktv/backend drizzle-kit migrate
```

> 首次启动 backend 时会自动创建管理员账号（根据 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`）。

### 3.5 启动开发服务

```bash
# 一键启动所有 dev server（后端 + 前端，并行）
pnpm dev

# 或单独启动某个子项目（见下方各子项目章节）
```

## 三-A、项目启动运行完整流程（端到端）

本节给出从零到完整使用 KTV 系统的端到端步骤。适用于首次拉取代码后的本地开发验证。

### 步骤 1：准备环境

```bash
# 确认 Node.js 20+ 与 pnpm 8+ 已安装
node -v    # 应输出 v20.x
pnpm -v    # 应输出 8.x 或更高

# 克隆并进入项目
git clone <仓库地址> nasktv
cd nasktv
```

### 步骤 2：安装依赖

```bash
pnpm install
```

### 步骤 3：配置环境变量

```bash
cp .env.example .env
# 默认值已适用于本地开发，仅需检查 JWT_SECRET（开发环境可保留默认）
```

### 步骤 4：创建数据目录并放入示例歌曲

```bash
mkdir -p data/{db,songs,separated,uploads,separator-cache}

# 可选：放入几首测试歌曲
# cp /path/to/your/songs/*.mp3 data/songs/
```

### 步骤 5：初始化数据库

```bash
# 生成迁移文件（首次或 schema 变更后）
pnpm --filter @nasktv/backend drizzle-kit generate

# 执行迁移（创建表结构）
pnpm --filter @nasktv/backend drizzle-kit migrate
```

迁移执行后 `data/db/nasktv.db` 会自动创建。首次启动 backend 时会根据 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 自动创建管理员账号。

### 步骤 6：启动后端

```bash
# 方式 A：单独启动 backend（推荐首次验证用）
pnpm --filter @nasktv/backend dev

# 方式 B：一键启动所有 dev server（backend + admin-web + mobile-h5）
pnpm dev
```

验证后端启动成功：
```bash
# 健康检查
curl http://localhost:3000/api/health

# 登录获取 token（返回的 token 后续 API 调用需要）
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 步骤 7：启动管理后台（Admin Web）

另开一个终端：
```bash
pnpm --filter @nasktv/admin-web dev
```

浏览器访问 `http://localhost:5173`，使用 `admin` / `admin123` 登录。

### 步骤 8：扫描歌曲入库

登录 Admin Web 后：
1. 进入「系统设置」→ 确认扫描路径为 `./data/songs`
2. 进入「歌曲管理」→ 点击「扫描入库」
3. 等待扫描完成（控制台会输出扫描日志）
4. 扫描完成后可在歌曲列表查看入库的歌曲

### 步骤 9：注册电视设备并授权

TV App 首次启动时会调用 `POST /api/devices/register` 注册到后端，生成房间码。本地开发时可：

**方式 A：通过 TV App WebView 开发模式模拟**
```bash
pnpm --filter @nasktv/tv-app dev
# 浏览器访问 http://localhost:1420，TV App 会自动注册设备
```

**方式 B：通过 API 手动注册**
```bash
curl -X POST http://localhost:3000/api/devices/register \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test-device-001","device_name":"开发调试设备"}'
# 返回值含 room_code
```

然后在 Admin Web「设备授权」页找到待授权设备，点击「永久授权」或「临时授权」。

### 步骤 10：启动 TV App（WebView 开发模式）

```bash
pnpm --filter @nasktv/tv-app dev
# 浏览器访问 http://localhost:1420
```

TV App 收到 `ROOM_AUTHORIZED` WebSocket 消息后，进入正常 KTV 界面，显示房间码与二维码。

### 步骤 11：启动手机点歌 H5

另开一个终端：
```bash
pnpm --filter @nasktv/mobile-h5 dev
```

浏览器访问 `http://localhost:5174`（建议用手机浏览器或 Chrome 移动端模拟）：
- 方式 A：扫描 TV App 显示的二维码（需同局域网）
- 方式 B：手动输入房间码加入

加入后即可搜索点歌、查看队列、控制播放。

### 步骤 12：（可选）启动人声分离服务

如需测试原伴唱切换功能：
```bash
cd packages/separator
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

在 Admin Web「人声分离」页对歌曲触发分离任务，完成后即可在 TV App 切换原唱/伴奏/人声辅助模式。

### 完整启动检查清单

| 服务 | 端口 | 启动命令 | 验证方式 |
|------|------|---------|---------|
| backend | 3000 | `pnpm --filter @nasktv/backend dev` | `curl http://localhost:3000/api/health` |
| admin-web | 5173 | `pnpm --filter @nasktv/admin-web dev` | 浏览器访问 `http://localhost:5173` |
| mobile-h5 | 5174 | `pnpm --filter @nasktv/mobile-h5 dev` | 浏览器访问 `http://localhost:5174` |
| tv-app | 1420 | `pnpm --filter @nasktv/tv-app dev` | 浏览器访问 `http://localhost:1420` |
| separator | 8001 | `pnpm --filter @nasktv/separator dev` | `curl http://localhost:8001/health` |

### 典型开发场景

**场景 1：仅开发后端 API**
```bash
pnpm --filter @nasktv/backend dev
# 用 curl / Thunder Client / Postman 测试 API
```

**场景 2：开发 Admin Web 页面**
```bash
# 终端 1：启动后端
pnpm --filter @nasktv/backend dev
# 终端 2：启动 admin-web（dev server 自动代理 /api 到 3000）
pnpm --filter @nasktv/admin-web dev
```

**场景 3：开发 Mobile H5**
```bash
pnpm --filter @nasktv/backend dev
pnpm --filter @nasktv/mobile-h5 dev
```

**场景 4：开发 TV App WebView**
```bash
pnpm --filter @nasktv/backend dev
pnpm --filter @nasktv/tv-app dev
```

**场景 5：全栈联调（不含 separator）**
```bash
pnpm dev  # 一键启动 backend + admin-web + mobile-h5
# 另开终端启动 TV App
pnpm --filter @nasktv/tv-app dev
```

## 四、各子项目开发指南

### 4.1 shared（共享类型与 Schema）

**环境需求**：Node.js 20+ / pnpm 8+

shared 包是 TS 源码直接导出（无编译步骤），其他包通过 workspace 链接引用。

```bash
# 类型检查
pnpm --filter @nasktv/shared tsc --noEmit
```

**目录结构**：
- `src/schema/` — Drizzle ORM schema 定义（songs / artists / categories / rooms / users 等）
- `src/types/` — 共享 TypeScript 类型（ws.ts / index.ts 等）
- `src/utils/` — 共享工具函数

**修改 schema 后**：
```bash
# 1. 修改 packages/shared/src/schema/ 下的 schema 文件
# 2. 生成迁移
pnpm --filter @nasktv/backend drizzle-kit generate
# 3. 执行迁移
pnpm --filter @nasktv/backend drizzle-kit migrate
```

### 4.2 backend（后端 API + WebSocket）

**环境需求**：Node.js 20+ / pnpm 8+

**端口**：3000

```bash
# 开发模式（tsx 热重载）
pnpm --filter @nasktv/backend dev

# 类型检查
cd packages/backend && npx tsc --noEmit

# 生成数据库迁移
pnpm --filter @nasktv/backend drizzle-kit generate

# 执行数据库迁移
pnpm --filter @nasktv/backend drizzle-kit migrate
```

**关键环境变量**：

| 变量 | 本地开发默认 | 说明 |
|------|------------|------|
| `PORT` | `3000` | 监听端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT 密钥 |
| `DB_PATH` | `./data/db/nasktv.db` | SQLite 路径 |
| `SCAN_PATH` | `./data/songs` | 歌曲库扫描路径 |
| `SEPARATOR_SERVICE_URL` | `http://localhost:8001` | 分离服务地址 |
| `AI_ENABLED` | `false` | 是否启用 AI 解析 |

**开发说明**：
- 路由统一注册在 `packages/backend/src/routes/index.ts`
- WebSocket handlers 在 `packages/backend/src/index.ts` 初始化
- 房间相关 WS 广播由 `services/room-service.ts` 处理
- 设备相关 WS 广播由 `services/device-service.ts` 处理
- 日志使用 pino，禁止 `console.log`

**API 健康检查**：
```bash
curl http://localhost:3000/api/health
```

**登录获取 token**：
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 4.3 admin-web（管理后台 SPA）

**环境需求**：Node.js 20+ / pnpm 8+

**端口**：5173

```bash
# 开发模式（Vite dev server）
pnpm --filter @nasktv/admin-web dev

# 类型检查 + 构建
pnpm --filter @nasktv/admin-web build

# 预览构建产物
pnpm --filter @nasktv/admin-web preview
```

**访问地址**：`http://localhost:5173`

**开发说明**：
- 开发模式 `base: '/'`
- dev server 自动代理 `/api` 和 `/ws` 到 `http://localhost:3000`（见 `vite.config.ts`）
- 生产构建 `base: '/admin/'`（通过 `NODE_ENV` 切换）
- UI 设计必须通过 `Use Skill: hallmark` 技能构建

### 4.4 mobile-h5（手机点歌 H5 SPA）

**环境需求**：Node.js 20+ / pnpm 8+

**端口**：5174

```bash
# 开发模式
pnpm --filter @nasktv/mobile-h5 dev

# 类型检查 + 构建
pnpm --filter @nasktv/mobile-h5 build

# 预览构建产物
pnpm --filter @nasktv/mobile-h5 preview
```

**访问地址**：`http://localhost:5174`

**开发说明**：
- 开发模式 `base: '/'`
- dev server 自动代理 `/api` 和 `/ws` 到 `http://localhost:3000`
- 生产构建 `base: '/h5/'`
- 响应式布局使用 Tailwind `lg` 断点区分桌面/移动
- UI 设计必须通过 `Use Skill: hallmark` 技能构建

### 4.5 tv-app（Android TV App · Tauri 2）

**实际版本**：Tauri **2**（`tauri 2.11` / `@tauri-apps/cli 2.11`）
- `package.json`：`@tauri-apps/cli: "^2.0.0"` / `@tauri-apps/api: "^2.0.0"` / `@tauri-apps/plugin-fs: "^2.0.0"`
- `Cargo.toml`：`tauri = "2"` + `tauri-plugin-fs = "2"`，`[lib] crate-type = ["staticlib", "cdylib", "rlib"]`
- `tauri.conf.json` 使用 v2 schema（`app.windows` / `bundle.android.minSdkVersion`，权限走 `capabilities/default.json`）
- 权限模型：v2 capabilities 替代 v1 `allowlist`；fs 文件访问需 `fs:*` 权限 + `$APPDATA/**` scope

**环境需求**：Node.js 20+ / pnpm 8+ / Rust stable（1.77+）/ Tauri CLI 2 / JDK 17+ / Android SDK（platform 36）+ NDK 26+

**端口**：1420（WebView dev server，Tauri 约定）

> TV App 有三种开发模式，按需选择：
> - **WebView 模式**：仅前端，浏览器访问，最快迭代 UI
> - **Tauri 桌面模式**：Rust 外壳 + WebView，调试 Tauri API
> - **Android APK 模式**：打包到真实电视设备

#### 4.5.1 三种开发模式详解

**模式 A：WebView 开发模式（最快迭代 UI）**

仅启动 Vite dev server，用浏览器访问。适合纯前端 UI 开发、Hallmark 设计迭代、组件调试。

```bash
pnpm --filter @nasktv/tv-app dev
```

- 访问地址：`http://localhost:1420`
- Vite 热重载，改代码即时生效
- dev server 自动代理 `/api` 和 `/ws` 到 `http://localhost:3000`
- **限制**：无法调用 Tauri 原生 API（如文件系统、HTTP 拦截），相关代码需做环境判断

**模式 B：Tauri 桌面开发模式（调试 Tauri API）**

启动 Rust 外壳 + WebView，完整 Tauri 运行时。适合调试 Tauri API、原生能力、Rust 代码。

```bash
pnpm --filter @nasktv/tv-app tauri:dev
```

- `tauri dev` 会先执行 `beforeDevCommand: "pnpm dev"` 启动 Vite（端口 1420）
- 然后编译 Rust 外壳并打开桌面窗口（1920×1080 全屏）
- WebView 加载 `http://localhost:1420`
- Rust 代码修改后自动重新编译重启
- **首次启动较慢**：需编译 Rust 依赖（后续增量编译快）

**模式 C：打包 Android APK（部署到真实电视）**

将 TV App 打包成 APK，安装到 Android TV 设备。

```bash
# Release APK（体积小、性能好）
pnpm --filter @nasktv/tv-app exec tauri android build --apk

# Debug APK（带调试符号、sourcemap）
pnpm --filter @nasktv/tv-app exec tauri android build --apk --debug
```

产物路径：`packages/tv-app/src-tauri/gen/android/app/build/outputs/apk/`
- Release：`.../release/app-release.apk`（universal，含 4 个 ABI）
- Debug：`.../debug/app-debug.apk`

#### 4.5.2 开发前置条件

**基础环境（WebView 模式）**：
```bash
node -v    # 20+
pnpm -v    # 8+
```

**Tauri 桌面模式追加**：
```bash
# 1. 安装 Rust stable
# Windows: https://rustup.rs/
rustc --version  # 应输出 stable

# 2. Tauri CLI 已随 package.json 安装，无需单独 cargo install
pnpm --filter @nasktv/tv-app tauri --version
```

**Android APK 打包追加**：
```bash
# 1. 安装 JDK 17+（Tauri 2 Android 构建必需，与系统其他 Java 版本可共存）
#    https://adoptium.net/ 或 Android Studio 自带 jbr

# 2. 安装 Android SDK（cmdline-tools）+ NDK (Side by side)
#    Android Studio → SDK Manager，或命令行 sdkmanager：
#    sdkmanager --install "platforms;android-36" "ndk;26.3.11579264"
#    推荐版本：NDK 26、SDK Platform 36

# 3. 添加 Android 编译 target
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add i686-linux-android
rustup target add x86_64-linux-android

# 4. 配置环境变量（Windows 示例，路径按实际安装位置）
#    JAVA_HOME = C:\Program Files\Java\jdk-17.0.11
#    ANDROID_HOME = C:\Users\<用户>\AppData\Local\Android\Sdk
#    NDK_HOME = %ANDROID_HOME%\ndk\<版本号>
#    PATH 追加：%ANDROID_HOME%\platform-tools

# 5. 验证
adb --version
rustup target list --installed
```

#### 4.5.3 首次打包 Android APK 完整步骤

```bash
# 1. 确认所有前置条件已就绪（见 4.5.2）

# 2. 初始化 Android 项目（仅需执行一次）
cd packages/tv-app
pnpm exec tauri android init
# 这会在 src-tauri/gen/android/ 下生成 Android 工程

# 3. 配置签名（Release 必需）
#    方式 A：使用 debug 签名快速测试
#    方式 B：生成正式 keystore
keytool -genkey -v -keystore nasktv.keystore -alias nasktv -keyalg RSA -keysize 2048 -validity 10000
#    然后配置 src-tauri/gen/android/app/build.gradle.kts 的 signingConfigs

# 4. 打包
pnpm exec tauri android build --apk
# Release APK 输出：
#   src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
# Debug APK：
pnpm exec tauri android build --apk --debug
#   src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk

# 5. 安装到电视
#    方式 A：adb 安装
adb connect <电视IP>:5555
adb install -r src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk

#    方式 B：U盘拷贝 APK 后在电视上安装
```

#### 4.5.4 TV App 调试技巧

**WebView 模式调试**：
- Chrome DevTools（F12）：Elements / Console / Network / WebSocket 帧
- React DevTools 浏览器插件
- 模拟遥控器：用键盘方向键 + Enter 模拟 D-pad

**Tauri 桌面模式调试**：
- WebView 同样支持 DevTools（右键 → Inspect 或快捷键）
- Rust 日志：终端输出 `println!` 或 `log` crate
- VS Code launch.json 示例：
```json
{
  "type": "lldb",
  "request": "launch",
  "name": "Debug Tauri",
  "cargo": {
    "args": ["build", "--manifest-path", "packages/tv-app/src-tauri/Cargo.toml"]
  }
}
```

**Android APK 调试**：
```bash
# 查看应用日志
adb logcat | grep NASKTV

# 远程调试 WebView
adb forward tcp:9222 localabstract:webview_devtools_remote
# 然后在 Chrome 访问 chrome://inspect

# 模拟遥控器按键
adb shell input keyevent KEYCODE_DPAD_UP
adb shell input keyevent KEYCODE_DPAD_DOWN
adb shell input keyevent KEYCODE_DPAD_LEFT
adb shell input keyevent KEYCODE_DPAD_RIGHT
adb shell input keyevent KEYCODE_DPAD_CENTER
adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE
adb shell input keyevent KEYCODE_MEDIA_NEXT
adb shell input keyevent KEYCODE_MEDIA_PREVIOUS
```

#### 4.5.5 关键配置说明

**`tauri.conf.json` 关键字段（v2 schema）**：
- `build.beforeDevCommand: "pnpm dev"` — `tauri dev` 自动启动 Vite
- `build.devUrl: "http://localhost:1420"` — WebView 加载地址（v1 的 `devPath`）
- `build.frontendDist: "../dist"` — 打包时加载的静态资源目录（v1 的 `distDir`）
- `app.windows[0]` — 窗口配置（1920×1080 全屏）
- `bundle.android.minSdkVersion: 24` — 最低支持 Android 7.0
- `bundle.identifier: "com.nasktv.tvapp"` — 应用包名
- 文件系统权限在 `capabilities/default.json`（`fs:scope` 的 `$APPDATA/**`），不再用 `tauri.allowlist`

**`vite.config.ts` 关键配置**：
- `base: '/'` — Tauri 不支持相对路径
- `server.port: 1420` — Tauri 约定端口
- `server.strictPort: true` — 端口被占用时退出而非切换
- `server.proxy` — 代理 `/api` 和 `/ws` 到 backend

**D-pad 遥控器适配**：
- 所有交互元素必须 `tabIndex` + `role` 属性
- 禁止 `focus:outline-none`，用 `focus-visible:ring` 替代
- 支持的按键：方向键 / OK / MediaPlayPause / MediaNext / MediaPrevious / Menu / 数字键 0-9

#### 4.5.6 常见问题

**Q：`tauri dev` 启动后窗口白屏**
- 检查 Vite 是否已在 1420 端口启动（`tauri dev` 会自动启动）
- 检查 backend 是否已启动（TV App 需连接 WebSocket）
- 打开 DevTools 查看 Console 错误

**Q：Android APK 打包失败 `linker not found`**
- NDK 未安装或路径配置错误
- 检查 `NDK_HOME` 环境变量
- 确认 `rustup target list --installed` 包含 `aarch64-linux-android`
- Windows 桌面侧还需 Visual Studio Build Tools 2022（含 C++ 工具链，MSVC 14.29+）

**Q：Windows 打包报 `Failed to create a symbolic link`**
- `tauri android build` 在 Windows 上复制 .so 到 jniLibs 需要符号链接权限
- 开启 Windows「开发者模式」（设置 → 隐私和安全性 → 开发者选项），或在 Android Studio 里直接 Gradle 构建（`gradlew assembleDebug`）

**Q：cargo 拉取依赖报 `Could not connect to server ... via 127.0.0.1`**
- 本机有 Clash 等代理残留但代理未运行，cargo 误走系统代理
- 设置 `NO_PROXY=*` 环境变量，或配置国内镜像：`~/.cargo/config.toml` 的 `rsproxy-sparse`（`sparse+https://rsproxy.cn/index/`）

**Q：`adb install` 失败 `INSTALL_FAILED_VERIFICATION_FAILURE`**
- 电视端需开启「未知来源应用安装」
- 或用 `adb install -t` 允许测试包

**Q：TV App 在电视上无法连接后端**
- 确认电视与 NAS/开发机在同一局域网
- TV App 默认连 `localhost:3000`，部署到电视后需改为 NAS IP
- 修改 TV App 中的 API_BASE_URL 与 WS_BASE_URL 配置
- 或通过 TV App 设置页配置后端地址

**Q：D-pad 焦点丢失或乱跳**
- 检查 `tabIndex` 顺序是否合理
- 用 `role="button"` 等语义化属性
- 测试时用 `adb shell input keyevent` 逐键验证

#### 4.5.7 实操记录：Windows 从零运行与打包 APK（2026-08 验证）

> 以下为在全新开发机上从零搭好环境、成功产出 APK 的完整记录，含各步骤耗时与踩坑，可直接照做。

**一、运行 TV 端（日常开发）**

```powershell
# 1. 启动后端（TV 端依赖 :3000）
pnpm --filter @nasktv/backend dev

# 2. 方式 A：WebView 模式（最快，浏览器调试 UI）
pnpm --filter @nasktv/tv-app dev
#    浏览器访问 http://localhost:1420（前端代理 /api、/ws 到 :3000）

# 3. 方式 B：Tauri 桌面模式（调试 Rust 外壳 / Tauri API）
pnpm --filter @nasktv/tv-app tauri:dev
#    首次会先跑 beforeDevCommand 启动 Vite，再编译 Rust（约 1-2 分钟），打开 1920×1080 全屏窗口
```

**二、首次搭建打包环境（一次性，约 30-60 分钟）**

```powershell
# 1. 安装 Rust stable（含 MSVC 工具链）
#    下载 https://win.rustup.rs/x86_64 后执行 rustup-init.exe -y --default-toolchain stable-msvc --profile minimal
#    本机实测安装 rustc 1.97.1；装完需新开终端或刷新 PATH（cargo 在 %USERPROFILE%\.cargo\bin）

# 2. 添加 Android 编译目标（4 个 ABI）
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 3. 安装 JDK 17+（Tauri 2 构建必需；本机用 jdk-17.0.11，与已有 JDK 1.8 共存，靠 JAVA_HOME 切换）
#    https://adoptium.net/

# 4. 安装 Android SDK cmdline-tools（若未装 Android Studio）
#    下载 https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip
#    解压到 %ANDROID_HOME%\cmdline-tools\latest\（注意嵌套目录需上移一层）

# 5. 用 sdkmanager 安装 NDK 与 SDK Platform（务必先设 JAVA_HOME=JDK 17）
setx JAVA_HOME "C:\Program Files\Java\jdk-17.0.11"
setx ANDROID_HOME "C:\Users\<用户>\AppData\Local\Android\Sdk"
"%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" --licenses        # 全选 y
"%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" --install "platforms;android-36" "ndk;26.3.11579264"
setx NDK_HOME "%ANDROID_HOME%\ndk\26.3.11579264"

# 6. Windows 桌面编译还需 Visual Studio Build Tools 2022 的 C++ 工具链（rustc 1.97 要求 MSVC 14.29+，VS2017 太老）
#    下载 https://aka.ms/vs/17/release/vs_buildtools.exe
#    vs_buildtools.exe --quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended

# 7.（网络问题）cargo 拉依赖建议配置国内镜像 %USERPROFILE%\.cargo\config.toml：
#    [source.crates-io] replace-with = 'rsproxy-sparse'
#    [source.rsproxy-sparse] registry = "sparse+https://rsproxy.cn/index/"
#    若本机有 Clash 等代理残留但未开代理，cargo 会误走 127.0.0.1 报 ECONNRESET，需先设环境变量 NO_PROXY=*
```

**三、初始化 Android 工程与打包（每次改完代码后）**

```powershell
# 1. 初始化 Android 工程（仅首次；仓库已含 gen/android 时跳过）
pnpm --filter @nasktv/tv-app exec tauri android init
#    生成 src-tauri/gen/android/（Gradle 工程）与 gen/schemas/

# 2. 打包 Debug APK（验证链路，首次约 10-20 分钟：cargo 拉依赖 + 4 ABI 交叉编译 + Gradle）
pnpm --filter @nasktv/tv-app exec tauri android build --apk --debug
#    产物：packages/tv-app/src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk

# 3. 打包 Release APK（体积小；上线前需先配置签名）
pnpm --filter @nasktv/tv-app exec tauri android build --apk
#    产物：.../outputs/apk/release/app-release.apk（universal，含 4 ABI，直接拷到电视安装）
```

**四、本次实操踩坑记录**

| 现象 | 原因 | 解决 |
|------|------|------|
| `tauri android init` 报 `unrecognized subcommand 'android'` | Tauri 1.x CLI 无移动端命令 | 升级到 Tauri 2（tauri 2.11 / cli 2.11），配置同步迁 v2 schema（`app.windows` / `bundle.icon` / `devUrl` / `frontendDist`） |
| `bundle: Additional properties are not allowed ('icons')` | v2 中 `bundle.icons` 改名为 `bundle.icon` | tauri.conf.json 改字段名 |
| `failed to parse Cargo.toml: duplicate key` | 依赖声明重复（if-addrs / tiny_http） | 清理 Cargo.toml 重复行 |
| `error: no library targets found in package` | Tauri 2 移动端要求 lib 目标 | Cargo.toml 加 `[lib] crate-type = ["staticlib","cdylib","rlib"]`；逻辑移入 `src/lib.rs`（`#[cfg_attr(mobile, tauri::mobile_entry_point)]`），`main.rs` 只调 `nasktv_lib::run()` |
| `emit_all` 报错 / 事件收不到 | Tauri 2 移除 `emit_all` | 改用 `app.emit`（`use tauri::Emitter`） |
| `linker link.exe not found` | 缺 MSVC C++ 工具链 | 装 VS2022 Build Tools VCTools（VS2017 的 MSVC 14.16 太老） |
| `Failed to create a symbolic link` | Windows 未开开发者模式，无符号链接权限 | 开「开发者模式」；或跳过 CLI 直接 `gradlew assembleDebug` |
| cargo 下载依赖 `Could not connect ... via 127.0.0.1` | 系统代理残留但代理未运行 | `NO_PROXY=*` + 配置 rsproxy 国内镜像 |
| 前端 fs/path API 导入失效 | Tauri 2 中 fs 移到 `@tauri-apps/plugin-fs`，path 仍在 `@tauri-apps/api/path` | 迁移 device.ts / backend-config.ts；权限从 v1 allowlist 迁到 `capabilities/default.json`（`fs:*` + `$APPDATA/**` scope） |

**五、桌面版打包（Windows 本机运行，2026-08 验证通过）**

不需要 JDK / Android SDK / NDK，仅需 Rust + MSVC 工具链（上面已装）：

```powershell
# 打包（自动先跑前端 build；NSIS 安装包 + 便携 exe）
pnpm --filter @nasktv/tv-app exec tauri build --bundles nsis
#    若配了 cargo 代理，打包前临时 $env:NO_PROXY="*"

# 产物：
#   便携 exe：packages/tv-app/src-tauri/target/release/nasktv.exe（约 10MB）
#   安装包：  packages/tv-app/src-tauri/target/release/bundle/nsis/NASKTV_<版本>_x64-setup.exe（约 2MB）
```

- 首次打包约 3-5 分钟（Rust release 编译 + NSIS 工具链自动下载），之后增量很快
- 运行依赖 WebView2 运行时（Win10/11 自带；旧系统需单独装）
- 想打 MSI 用 `--bundles msi`（需额外 WiX 工具链）；默认不配 bundle.targets 时只打 nsis

### 4.6 separator（人声分离微服务 · Python）

**环境需求**：Python 3.11+ / uv / ffmpeg 6+

**端口**：8001

```bash
# 进入 separator 目录
cd packages/separator

# 安装依赖（含 PyTorch + Demucs，首次约 2GB）
uv sync

# 开发模式（热重载）
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

# 或通过 pnpm 启动
pnpm --filter @nasktv/separator dev      # 开发模式
pnpm --filter @nasktv/separator start    # 生产启动
```

**健康检查**：
```bash
curl http://localhost:8001/health
```

**首次运行说明**：
- 首次启动会下载 Demucs 模型（~80MB）到 `cache/` 目录
- 模型缓存后，后续启动无需重新下载
- ffmpeg 必须可用：`ffmpeg -version`
- PyTorch 体积较大（~2GB），CPU 推理可用但较慢
- 有 CUDA 环境可手动安装 GPU 版 PyTorch 加速

#### Separator 环境管理（venv / GPU / HuggingFace）

**一键搭建 Python 环境**（推荐）：

```bash
# 方式一：通过 pnpm（无需手动 cd）
pnpm --filter @nasktv/separator setup

# 方式二：手动进入目录执行
cd packages/separator
python scripts/setup_venv.py
```

脚本自动完成：用 `uv` 创建 `.venv`（Python 3.12）→ 用国内 PyPI 镜像安装 `requirements.txt` 全部依赖 → 检测 NVIDIA GPU 并安装 CUDA 版 PyTorch（如有）→ 验证 PyTorch / Demucs 安装结果。

| 脚本特性 | 说明 |
|---------|------|
| 自动创建 venv | 用 `uv` 创建 `.venv`，若已存在则跳过 |
| 国内镜像加速 | 默认清华 PyPI 镜像（`pypi.tuna.tsinghua.edu.cn`），可用 `PIP_INDEX_URL` 切换 |
| GPU 自动检测 | 运行 `nvidia-smi` 检测 NVIDIA GPU，有则安装 CUDA 12.4 版 PyTorch |
| 安装验证 | 自动验证 PyTorch 版本、CUDA 可用性、Demucs 可导入 |

切换镜像源示例：
```bash
PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple pnpm --filter @nasktv/separator setup
```

`requirements.txt` 关键依赖：fastapi / uvicorn / numpy / torch / torchaudio / demucs / pydantic / python-multipart / requests / soundfile。

**HuggingFace 模型下载**：Demucs 首次运行需从 HuggingFace 下载模型（约 80MB）。`main.py` 中已配置：若 `HF_ENDPOINT` 未设置，自动使用 `https://hf-mirror.com` 国内镜像；模型缓存于 `packages/separator/cache/`，下载一次后无需重复下载；如需官方源，在 `.env` 设置 `HF_ENDPOINT=https://huggingface.co`。

**手动安装 GPU PyTorch**（可选）：
```bash
cd packages/separator
# 通过后台 API 安装（输出实时日志）：POST http://localhost:8001/api/gpu/install-gpu
# 或手动安装：
.venv\Scripts\python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
```

#### ffmpeg 安装说明

ffmpeg 是 separator 的运行时依赖（音频抽取/转码），安装分两处：**Docker 部署自动装好，本地开发需手动装**。

**Docker / 生产环境（自动安装）** — 唯一自动安装点在 `packages/separator/Dockerfile`：

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libgomp1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
```

基于 `python:3.11-slim`，随 separator 镜像构建，无需额外操作。

**本地开发（需手动安装）** — 没有任何脚本自动装（`scripts/setup_venv.py` 不装 ffmpeg，torch/demucs 的 `install_manager.py` 也不装）。Windows 三种方式：

```bash
# 方式 1：winget
winget install ffmpeg

# 方式 2：choco
choco install ffmpeg

# 方式 3：手动下载
# https://www.gyan.dev/ffmpeg/builds/  解压后将 bin/ 加入 PATH
```

要求 **ffmpeg 6+**，且能直接 `ffmpeg -version` 命中（即在 PATH 中）。

**路径查找逻辑**（见 `packages/separator/app/audio_utils.py`）：`get_ffmpeg_path()` 默认取环境变量 `FFMPEG_PATH`，未设置则直接调用 PATH 中的 `ffmpeg`；`ffprobe` 同理（当 `FFMPEG_PATH` 指向目录或可执行文件时自动推导同级 `ffprobe`）。因此本地只需保证 `ffmpeg`/`ffprobe` 在 PATH 上即可；若装在非标准路径，设置 `FFMPEG_PATH` 环境变量（例如 `C:\ffmpeg\bin\ffmpeg.exe`）即可。

## 五、环境变量完整说明

完整环境变量模板见 [.env.example](../.env.example)。本地开发常用变量说明：

### 5.1 后端变量

| 变量 | 本地默认 | 生产默认 | 说明 |
|------|---------|---------|------|
| `PORT` | `3000` | `3000` | 监听端口 |
| `NODE_ENV` | `development` | `production` | 运行环境 |
| `LOG_LEVEL` | `info` | `info` | 日志级别 |
| `JWT_SECRET` | `dev-secret-...` | **必改** | JWT 密钥 |
| `DB_PATH` | `./data/db/nasktv.db` | `/app/data/db/nasktv.db` | SQLite 路径 |
| `ADMIN_USERNAME` | `admin` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | `admin123` | **必改** | 管理员密码 |
| `SCAN_PATH` | `./data/songs` | `/app/data/songs` | 扫描路径 |
| `SCAN_EXTENSIONS` | `mp3,flac,...` | 同左 | 支持的扩展名 |
| `SCAN_ON_STARTUP` | `false` | `false` | 启动时扫描 |

### 5.2 分离服务变量

| 变量 | 本地默认 | 生产默认 | 说明 |
|------|---------|---------|------|
| `SEPARATOR_SERVICE_URL` | `http://localhost:8001` | `http://separator:8001` | 分离服务地址 |
| `SEPARATION_OUTPUT_DIR` | `./data/separated` | `/app/data/separated` | 输出目录 |
| `SEPARATION_AUTO_ENABLE` | `false` | `false` | 自动触发分离 |
| `SEPARATION_DEFAULT_MODEL` | `htdemucs_base` | `htdemucs_base` | 分离模型 |
| `SEPARATION_MAX_CONCURRENT` | `2` | `2` | 最大并发数 |

### 5.3 AI 解析变量

| 变量 | 本地默认 | 说明 |
|------|---------|------|
| `AI_ENABLED` | `false` | 是否启用 AI 解析 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | AI API 地址 |
| `AI_API_KEY` | `your_api_key_here` | AI 密钥（启用时必填） |
| `AI_MODEL` | `gpt-4o-mini` | AI 模型 |
| `AI_TEMPERATURE` | `0.3` | 生成温度 |
| `AI_AUTO_PARSE_AFTER_SCAN` | `false` | 扫描后自动解析 |
| `AI_AUTO_PARSE_AFTER_UPLOAD` | `false` | 上传后自动解析 |
| `AI_CONFIDENCE_THRESHOLD` | `0.8` | 置信度阈值 |
| `AI_DAILY_LIMIT` | `100` | 每日限制（0=不限） |
| `AI_REQUEST_TIMEOUT` | `30000` | 请求超时（毫秒） |

### 5.4 前端变量（Vite 构建时注入）

| 变量 | 本地默认 | 说明 |
|------|---------|------|
| `VITE_API_BASE_URL` | `http://localhost:3000/api` | API 基础 URL |
| `VITE_WS_BASE_URL` | `ws://localhost:3000` | WebSocket URL |

> 生产部署通过 web 反代访问 `/api` 和 `/ws`，前端变量可设为相对路径或留空。

### 5.5 房间与授权变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `ROOM_DEFAULT_TEMPORARY_HOURS` | `2` | 临时授权默认时长 |
| `ROOM_IDLE_TIMEOUT` | `0` | 空闲超时（分钟，0=不自动） |

## 六、常用开发命令

### 6.1 根目录命令

```bash
# 安装所有依赖
pnpm install

# 启动所有 dev server（并行）
pnpm dev

# 构建所有 TS 包
pnpm build

# 代码格式化
pnpm format

# 代码检查
pnpm lint
```

### 6.2 数据库相关

```bash
# 生成迁移（修改 schema 后）
pnpm --filter @nasktv/backend drizzle-kit generate

# 执行迁移
pnpm --filter @nasktv/backend drizzle-kit migrate

# 查看 Drizzle Studio（可视化数据库）
cd packages/backend && npx drizzle-kit studio
```

### 6.3 Docker 本地验证

```bash
# 构建所有镜像
docker compose build

# 启动所有服务
docker compose up -d

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f [服务名]

# 停止
docker compose down
```

## 七、开发工作流

### 7.1 修改后端 API

1. 在 `packages/shared/src/schema/` 修改 schema（如需）
2. 生成并执行数据库迁移
3. 在 `packages/backend/src/routes/` 添加路由
4. 在 `packages/backend/src/routes/index.ts` 注册路由
5. 涉及 WS → 在 `packages/backend/src/ws/` 添加 handler，在 `index.ts` 初始化
6. 启动 backend：`pnpm --filter @nasktv/backend dev`
7. 用 curl/Thunder Client 测试 API

### 7.2 修改前端页面

1. **先调用 `Use Skill: hallmark`** 获取设计规范
2. 在对应 package（admin-web / mobile-h5 / tv-app）开发
3. 遵循 Hallmark 约束（OKLCH 令牌、8 状态交互、4pt 间距等）
4. CSS 首行带 Hallmark stamp 注释
5. 启动 dev server：`pnpm --filter @nasktv/<包名> dev`

### 7.3 新增 WebSocket 消息类型

1. 在 `packages/shared/src/types/ws.ts` 定义类型
2. 在 `packages/backend/src/ws/` 对应 handler 实现
3. 在 `packages/backend/src/index.ts` 注册 handler
4. 房间广播走 `room-service.ts`，设备广播走 `device-service.ts`
5. 前端在对应 hook（如 `useRoomSync.ts`）订阅消息

### 7.4 修改数据库 Schema

1. 修改 `packages/shared/src/schema/` 下的 schema 文件
2. 运行 `pnpm --filter @nasktv/backend drizzle-kit generate` 生成迁移 SQL
3. 检查 `packages/backend/drizzle/` 下生成的 SQL 文件
4. 运行 `pnpm --filter @nasktv/backend drizzle-kit migrate` 执行迁移
5. 更新受影响的 API 与前端类型

## 八、调试技巧

### 8.1 后端调试

```bash
# 启用 debug 日志
LOG_LEVEL=debug pnpm --filter @nasktv/backend dev

# 查看实时日志
# 日志输出到 stdout，pino-pretty 格式化
```

**VS Code launch.json**（可选）：
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Backend",
  "runtimeExecutable": "tsx",
  "args": ["packages/backend/src/index.ts"],
  "cwd": "${workspaceFolder}/packages/backend"
}
```

### 8.2 数据库调试

```bash
# 启动 Drizzle Studio（浏览器可视化）
cd packages/backend && npx drizzle-kit studio

# 或用 DB Browser for SQLite 直接打开
# data/db/nasktv.db
```

### 8.3 前端调试

- Chrome DevTools → React DevTools
- Network 面板查看 API 请求与 WebSocket 帧
- Console 查看 pino 日志（开发环境输出到浏览器 console）

### 8.4 separator 调试

```bash
# 查看 separator 日志
cd packages/separator
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

# 测试分离 API
curl -X POST http://localhost:8001/separate \
  -H "Content-Type: application/json" \
  -d '{"input_path": "/data/songs/test.mp3", "output_dir": "/data/separated"}'

# 健康检查
curl http://localhost:8001/health
```

## 九、常见问题

### 9.1 pnpm install 失败

```bash
# 清理 node_modules 重装
rm -rf node_modules packages/*/node_modules
pnpm install

# 或检查 pnpm 版本
pnpm --version  # 应 >= 8
```

### 9.2 better-sqlite3 编译失败

better-sqlite3 使用预编译二进制，通常无需编译。如遇网络问题：
```bash
# 配置镜像
npm config set registry https://registry.npmmirror.com
pnpm install
```

### 9.3 端口被占用

```bash
# 查看占用端口的进程
# Windows
netstat -ano | findstr :3000
# Linux/Mac
lsof -i :3000

# 修改 .env 中的 PORT 变量
```

### 9.4 TypeScript 类型错误

```bash
# 检查类型
cd packages/backend && npx tsc --noEmit
cd packages/admin-web && npx tsc --noEmit
cd packages/mobile-h5 && npx tsc --noEmit
```

### 9.5 Vite 代理不生效

确认 `vite.config.ts` 中 proxy 配置：
```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/ws': {
      target: 'ws://localhost:3000',
      ws: true
    }
  }
}
```

### 9.6 WebSocket 连接失败

1. 确认 backend 已启动：`curl http://localhost:3000/api/health`
2. 检查 `.env` 中 `VITE_WS_BASE_URL` 是否正确
3. 浏览器 DevTools → Network → WS 面板查看连接状态

### 9.7 separator 模型下载失败

```bash
# 手动下载模型
cd packages/separator
uv run python -c "import demucs.separate; demucs.separate.main(['--dl', 'htdemucs_base'])"

# 或配置代理
export HTTP_PROXY=http://your-proxy:port
export HTTPS_PROXY=http://your-proxy:port
```

### 9.8 Hallmark 技能调用失败

确认在 Trae IDE 中调用 `Use Skill: hallmark`，技能会：
1. 读取项目已存在的 `tokens.css` / Tailwind 配置
2. 生成 `.hallmark/preflight.json` 与 `.hallmark/log.json`
3. 输出设计规范与组件代码

## 十、代码规范

### 10.1 代码风格

遵循 `.prettierrc` 配置：
- 单引号
- 启用分号
- 2 空格缩进
- 行宽 100
- `arrowParens: avoid`
- LF 行尾

```bash
# 格式化
pnpm format
```

### 10.2 TypeScript 规范

- 使用 Drizzle ORM 的 `eq()` 函数进行 where 查询，**禁止 `===`**
- 类型安全优先，避免 `any`
- 共享类型放 `packages/shared/src/types/`
- 共享 schema 定义在 `packages/shared/src/schema/`

### 10.3 前端规范

- **Hallmark 强制**：任何 UI 改动前先 `Use Skill: hallmark`
- 颜色用 `var(--color-*)` 令牌（OKLCH），禁止内联 hex / rgb
- 4pt 间距系统令牌
- 响应式布局使用 Tailwind `lg` 断点
- 可访问性：交互元素必须有 `tabIndex` 和 `role` 属性
- 禁止 `focus:outline-none`，用 `focus-visible:ring` 替代

### 10.4 后端规范

- 新增路由 → 在 `routes/index.ts` 注册
- 新增 WS 消息 → handler 放 `ws/` 目录，在 `index.ts` 初始化
- 房间广播走 `room-service.ts`，设备广播走 `device-service.ts`
- 日志使用 pino，禁止 `console.log`

## 十一、参考文档

- [../README.md](../README.md) — 项目总览与文档导航
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — 系统架构（架构图 / 服务划分 / 通信机制 / WebSocket 消息 / 数据流 / 数据库概览 / 数据卷）
- [./API.md](./API.md) — REST API 接口参考
- [../AGENTS.md](../AGENTS.md) — AI 编码助手项目指令
- [../deploy/README.md](../deploy/README.md) — 生产部署指南
- [../.env.example](../.env.example) — 环境变量完整示例
- [../DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) — 开发路线图与规划历史
- [.trae/specs/](../.trae/specs/) — 各阶段规格说明
