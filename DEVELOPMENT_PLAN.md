# 飞牛 NAS KTV 系统 — 开发路线图与规划历史

> 文档定位：本文件记录 nasktv 的**产品规划、功能模块设计、开发路线图、风险与待确认事项、版本变更记录**。属于「规划 / 历史」性质的参考。
>
> 已实现并落地的**技术参考**已拆分到各自的权威文档，本文不再重复，请按需跳转：
> - 系统架构（架构图 / 服务划分 / 通信机制 / WebSocket 消息 / 数据流 / 数据库概览 / 数据卷）：[ARCHITECTURE.md](./ARCHITECTURE.md)
> - 本地开发（环境 / 各子包命令 / 环境变量 / 调试 / 规范 / ffmpeg）：[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
> - REST API 接口清单：[docs/API.md](./docs/API.md)
> - 生产部署（Docker / 运维 / 备份 / 升级 / 安全 / TV 打包）：[deploy/README.md](./deploy/README.md)
> - 项目总览与文档导航：[README.md](./README.md)

> 版本：v1.8 ｜ 最后更新：2026-07-30 ｜ 状态：开发进行中

---

## 一、项目概述

### 1.1 项目定位
部署在飞牛 NAS 上的家庭 KTV 系统，支持三端协同：
- **管理员后台**：歌曲库管理、MV/音频上传、人声分离任务监控、设备授权管理、AI 辅助解析配置、歌手与分类维护
- **电视 KTV App**：Android TV 端播放器，支持原伴唱切换、歌词同步、遥控器操作
- **手机点歌 H5**：扫码加入房间、搜索点歌、队列管理、播放控制

### 1.2 核心特色
- **AI 人声分离**：基于 Demucs v4，对音频/MV 文件自动分离人声与伴奏，实现原伴唱切换
- **AI 辅助解析**：对接 OpenAI 标准接口，扫描入库后自动解析歌手、分类、语种、年代等信息，减少手动维护成本
- **设备授权机制**：电视端 App 安装时生成固定房间码，默认未授权，管理员可临时或永久授权后才能使用点歌功能
- **多房间支持**：一台 NAS 可服务多台电视，房间码隔离
- **NAS 本地化**：歌曲库扫描 NAS 目录，SQLite 单文件存储，Docker 一键部署

> 技术栈（TypeScript / Python / Rust、Express+WS、React+Vite、Tauri 2、FastAPI+Demucs、pnpm workspace 等）已实现并维护于代码仓库，详见 [README.md](./README.md#技术栈) 与 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 二、技术栈（规划摘要）

> 以下为规划阶段的技术选型摘要，落地细节与版本以各包 `package.json` / `pyproject.toml` / `Cargo.toml` 为准。

| 类别 | 技术 | 说明 |
|------|------|------|
| 编程语言 | TypeScript（主） + Python（分离服务） + Rust（Tauri 外壳） | 全栈统一 |
| 后端运行时 | Node.js LTS 20+ | Express + WebSocket |
| 包管理 | pnpm workspace | monorepo 管理 |
| 数据库 | SQLite3 (better-sqlite3) | 单文件持久化 |
| ORM | Drizzle ORM | 类型安全 |
| 认证 | JWT + bcrypt | 后台鉴权 |
| 实时通信 | WebSocket (ws) | 房间消息同步 |
| AI 接口 | OpenAI SDK（openai npm 包） | 兼容 OpenAI 协议的 AI 辅助解析 |
| 前端 | React 18 + Vite + TailwindCSS + Zustand + Axios | Admin Web / Mobile H5 |
| 电视端 | Tauri 2.0 (Rust) + React WebView | Android TV APK |
| 人声分离 | FastAPI + Demucs v4 + ffmpeg + torchaudio | uv 包管理 |
| 部署 | Docker 多阶段 + Compose + Nginx 反代 | 飞牛 NAS |

### 2.1 前端 UI 设计强制约束（Hallmark）

> **强制规则**：所有前端 UI 设计与页面实现（Admin Web / Mobile H5 / TV App WebView）**必须**通过 `Use Skill: hallmark` 产出，禁止直接手写无约束的 Tailwind/HTML/CSS。详见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) §十 与 [AGENTS.md](./AGENTS.md)。

| 端 | Genre | 推荐主题聚类 |
|----|-------|-------------|
| Admin Web | `modern-minimal` | Coral / Cobalt |
| Mobile H5 | `editorial`（或 `playful`） | Specimen / Atelier / Newsprint / Studio / Garden / Hum |
| TV App WebView | `atmospheric` | Bloom / Midnight / Terminal / Aurora / Lumen |

---

## 三、系统架构（已实现，见 ARCHITECTURE.md）

架构图、服务划分、反向代理路由、通信机制、WebSocket 消息类型、数据流、数据库概览与数据卷策略均已实现，统一维护于 **[ARCHITECTURE.md](./ARCHITECTURE.md)**，本文不再重复。

---

## 四、功能模块规划

### 4.1 管理员后台（Admin Web）

| 模块 | 功能点 |
|------|--------|
| 仪表盘 | 歌曲总数、今日点播次数、活跃房间数、热门歌曲 Top10、分离任务统计、AI 解析统计 |
| 歌曲管理 | 列表/网格视图、搜索（歌名/歌手/拼音首字母/分类）、批量操作、ID3 标签解析、手动编辑、删除、AI 解析状态标识 |
| 歌曲上传 | 单文件/批量上传、拖拽、支持音频和 MV 视频 |
| 歌手管理 | 歌手列表、新增/编辑/删除、头像上传、拼音首字母自动生成、合并歌手、歌曲数量统计 |
| 分类管理 | 分类树（语种/年代/风格/心情/主题）、新增/编辑/删除/排序、分类下歌曲数量统计 |
| 歌单管理 | 创建主题歌单、拖拽排序、封面设置 |
| 人声分离 | 任务概览、当前任务进度、队列列表、失败重试、试听伴奏/人声、批量分离 |
| AI 解析中心 | 解析任务概览、当前任务进度、批量解析、失败重试、解析结果审核与修正、AI 配置 |
| 设备授权 | 待授权设备列表、临时/永久授权、已授权设备管理（撤销/续期/转永久/重命名）、设备活跃状态监控 |
| 系统设置 | 扫描路径配置、分离参数、AI 解析参数、JWT 密钥、房间空闲超时、自动开关 |

### 4.2 电视 KTV App（Tauri）

| 模块 | 功能点 |
|------|--------|
| 首次启动注册 | 本地生成 device_id（UUID 持久化）→ 调用后端注册 → 获取房间码 |
| 等待授权界面 | 显示房间码 + "等待管理员授权"提示 + 设备 ID + 注册时间 |
| 授权状态监听 | WS 连接监听授权状态变更（授权/撤销/过期/关闭） |
| 临时授权倒计时 | 临时授权时在界面角落显示剩余时间，即将到期时弹出提醒 |
| 绑定房间 | 授权后显示房间码 + 二维码（手机扫码加入） |
| 播放界面 | 全屏 MV/音频可视化、逐行歌词同步、底部状态栏 |
| 播放控制 | 上一首/下一首/暂停/原伴唱切换/音调±/混响 |
| 原伴唱切换 | 三模式循环：原唱→伴奏→人声辅助→原唱 |
| 点歌队列 | 右侧悬浮显示待播列表 |
| 遥控器适配 | 方向键导航、OK 键确认、数字键输入房间码 |

### 4.3 手机点歌 H5（Mobile H5）

| 模块 | 功能点 |
|------|--------|
| 加入房间 | 扫码进入 或 手动输入房间码（后端校验房间授权状态及是否过期） |
| 授权校验提示 | 未授权/已过期房间显示"该房间尚未授权或授权已过期，请联系管理员" |
| 搜索点歌 | 拼音搜索（首字母/全拼）、歌手索引 A-Z |
| 分类浏览 | 按语种/年代/风格/心情/主题分类筛选歌曲 |
| 歌手浏览 | 歌手 A-Z 索引、歌手详情页（全部歌曲） |
| 点歌操作 | 加入队列、插队播放、置顶、取消 |
| 我的点歌 | 查看已点歌曲状态（待播/播放中/已播） |
| 播放控制 | 切歌（投票制或独享）、调节音量 |
| 歌单浏览 | 浏览管理员创建的歌单并点歌 |

### 4.4 人声分离功能

**支持输入**：纯音频文件（MP3/FLAC/M4A）— 主流场景；MV 视频文件（MP4/MKV 等）— 自动提取音频后分离。

**分离输出**：`vocals.mp3`（人声）/ `instrumental.mp3`（伴奏）。

**使用场景**：伴奏模式（KTV 核心）、原唱模式、人声辅助（伴奏 + 小音量人声叠加）。

**处理流程**：
```
1. 接收任务（音频或视频路径）
2. ffmpeg 提取/转码为 WAV (44.1kHz stereo)        阶段: extracting (10%)
3. Demucs 模型加载（首次启动慢，后续缓存）
4. Demucs 推理分离                                阶段: separating (10%-80%)
5. 输出 vocals.wav + no_vocals.wav
6. ffmpeg 转码为 MP3 (320kbps)                    阶段: encoding (80%-95%)
7. 回调 Backend 更新数据库                        阶段: done (100%)
8. 清理中间 WAV 文件
```

### 4.5 AI 辅助解析功能

**支持输入**：歌曲文件名 + ID3/Vorbis 标签原始信息；已有歌手库、分类库（作为 AI 参考上下文）。

**解析输出**：
```json
{
  "title": "吻别",
  "artist": "张学友",
  "artist_pinyin": "zhangxueyou",
  "artist_first_letter": "Z",
  "language": "粤语",
  "era": "90年代",
  "genre": "流行",
  "mood": "伤感",
  "confidence": 0.95,
  "need_review": false
}
```

**触发方式**：扫描后自动触发 / 上传后自动触发 / 手动单首 / 手动批量 / 失败重试。

**提示词模板**（后台可编辑，详见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) 与代码 `ai-prompt.ts`）。

**解析结果处理**：`confidence >= 0.85` 且 `need_review=false` → 自动应用；否则进入待审核，管理员确认后才应用。AI 解析结果不影响原始文件。

### 4.6 歌手与分类管理

- **歌手管理**：列表（A-Z 分组/搜索/分页）、新增/编辑/删除、合并（如"张学友"与"Jacky Cheung"）、歌曲数量统计。删除时关联歌曲迁移到指定歌手或"未知歌手"。
- **分类管理**：「分类组 + 分类项」两级结构（语种/年代/风格/心情/主题 + 自定义）。支持分类组/项增删改排序、歌曲归类、AI 自动归类、分类歌曲数统计。

---

## 五、数据库设计

> 数据库为 SQLite3 单文件，schema 定义在 `packages/shared/src/schema/`（Drizzle ORM），是**当前实现的唯一来源**。下表为规划阶段的设计说明，概览亦可参考 [ARCHITECTURE.md](./ARCHITECTURE.md#数据库-schema-概览)；修改 schema 必须生成并执行 Drizzle 迁移（见 [AGENTS.md](./AGENTS.md)）。

### 5.1 核心表结构（规划）

```
users              管理员用户
  id, username, password_hash, role, created_at

songs              歌曲
  id, title, artist_id, album_id
  file_path, file_type (audio|video)
  duration, lyrics_path
  pitch_default, play_count, created_at
  # 人声分离字段
  vocals_path, instrumental_path
  separation_status (pending|processing|completed|failed)
  separation_model (htdemucs|htdemucs_ft)
  separation_started_at, separation_completed_at, separation_error
  # AI 解析字段
  ai_parsed (0|1)  ai_parsed_at  ai_confidence  ai_need_review (0|1)  raw_tags (JSON)

artists            歌手
  id, name, pinyin, first_letter, avatar, bio, created_at
  song_count  -- 冗余字段

categories         分类组
  id, name (语种|年代|风格|心情|主题), sort_order, created_at

category_items     分类项
  id, category_id, name, sort_order
  song_count  -- 冗余字段

song_categories    歌曲-分类关联（多对多）
  id, song_id, category_item_id
  source (manual|ai)

playlists          歌单
  id, name, cover, description, sort_order

playlist_songs     歌单歌曲
  playlist_id, song_id, sort_order

rooms              房间（设备授权机制）
  id, code, device_id (UUID), name
  authorized (0|1), authorized_at, authorized_by
  authorize_type (permanent|temporary)
  authorize_expires_at
  status (pending|active|closed|revoked)
  device_info (JSON)
  created_at, closed_at, last_active_at

room_queues        房间队列
  id, room_id, song_id, user_session_id
  status (pending|playing|played|skipped)
  sort_order, requested_at

room_sessions      房间会话
  id, room_id, nickname, avatar, joined_at, left_at

play_history       播放历史
  id, room_id, song_id, played_at, duration_played

separation_tasks   分离任务
  id, song_id, status, model, priority
  progress, stage, error
  created_at, started_at, completed_at

ai_parse_tasks     AI 解析任务
  id, song_id, status (pending|processing|completed|failed|reviewing)
  model, prompt_template, result (JSON), error
  confidence, need_review
  created_at, started_at, completed_at

settings           系统配置
  key, value
  -- AI 相关：ai_enabled, ai_base_url, ai_api_key, ai_model, ai_temperature,
     ai_prompt_template, ai_auto_parse_after_scan, ai_auto_parse_after_upload,
     ai_confidence_threshold
  -- 分离相关：separation_auto_enable, separation_default_model, separation_max_concurrent
```

### 5.2 索引设计（规划）

- `songs.title` + `songs.artist_id` — 列表查询
- `songs.separation_status` / `songs.ai_parsed` + `songs.ai_need_review` — 任务筛选
- `room_queues.room_id` + `room_queues.status` — 队列查询
- `artists.first_letter` / `artists.name` UNIQUE
- `songs.file_path` UNIQUE / `rooms.device_id` UNIQUE / `rooms.code` UNIQUE
- `rooms.authorized` + `rooms.status` / `rooms.authorize_type` + `rooms.authorize_expires_at`

---

## 六、项目目录结构（见 README）

当前实际目录结构以仓库为准，顶层结构见 [README.md](./README.md#项目结构要点)；各子包内部组织随实现演进，请以代码为准。原规划目录树（阶段 1 设计）保留于本文历史，不再作为权威参考。

---

## 七、Docker Compose 编排（见 deploy/README）

生产部署的 5 服务编排（`backend` / `separator` / `web` / `admin-web` / `mobile-h5`）、数据卷挂载、首次部署与运维命令，统一维护于 **[deploy/README.md](./deploy/README.md)**，并以仓库根 `docker-compose.yml` 为最终实现。本文不再重复。

---

## 八、API 接口规划（见 docs/API.md）

REST 接口清单（认证 / 歌曲 / 扫描 / 分离 / 设备房间 / AI 解析 / 歌手 / 分类 / 歌单 / 内部回调）已整理为独立的 **[docs/API.md](./docs/API.md)**。WebSocket 消息类型见 [ARCHITECTURE.md](./ARCHITECTURE.md#websocket-消息类型)。

---

## 九、开发阶段路线图

### 阶段1：基础设施 + 后端核心（地基）
- [x] pnpm workspace 脚手架（packages/shared, backend, admin-web, mobile-h5, tv-app, separator）
- [x] tsconfig.base.json 共享配置
- [x] Drizzle schema 全表定义（含分离字段）
- [x] drizzle.config.ts + 首次迁移脚本
- [x] Express 框架 + JWT 中间件 + 错误处理
- [x] SQLite 连接（better-sqlite3）
- [x] 管理员登录、歌曲 CRUD 接口
- [x] ESLint + Prettier 代码规范配置
- [x] Docker 多阶段构建配置
- [x] Docker Compose 部署编排

**验证标准**：能用 REST API 登录、增删改查歌曲

---

### 阶段2：歌曲库扫描器 + 歌手分类基础
- [x] 递归扫描（支持 .mp3/.flac/.m4a/.mp4）
- [x] music-metadata 解析 ID3/Vorbis 标签
- [x] chardet 编码检测（解决 GBK 乱码）
- [x] pinyin-pro 生成拼音首字母
- [x] MV/音频文件类型识别
- [x] 歌词文件(.lrc) 关联匹配
- [x] 增量扫描（基于 mtime）
- [x] 扫描进度 WS 推送
- [x] 歌手自动入库（标签中的歌手自动创建记录）
- [x] 默认分类组初始化（语种/年代/风格/心情）

**验证标准**：扫描本地 1000+ 歌曲，标签解析正确，可重复扫描不重复入库，歌手和默认分类已建立

---

### 阶段2.5：人声分离微服务
- [x] Python + FastAPI + Demucs 环境搭建
- [x] uv 包管理配置（pyproject.toml）
- [x] 音频/视频统一处理（ffmpeg 提取音频）
- [x] Demucs v4 调用封装
- [x] 进度回调机制
- [x] MP3 转码输出
- [x] Dockerfile（PyTorch 基础镜像）
- [x] 模型缓存持久化

**验证标准**：手动调用 API 分离一首 MV/音频，产出 vocals.mp3 + instrumental.mp3

---

### 阶段2.6：AI 辅助解析服务
- [x] openai npm 包集成（兼容 OpenAI 协议）
- [x] ai-client 封装（Base URL/API Key/Model 可配置）
- [x] ai-prompt 提示词模板构造（含已有歌手/分类参考）
- [x] AI 解析任务队列（ai-parse-queue）
- [x] 解析结果 JSON 解析与校验
- [x] 歌手自动匹配/新建逻辑
- [x] 分类自动关联逻辑
- [x] 置信度阈值判断（自动应用 vs 待审核）
- [x] AI 配置接口（GET/PUT /api/admin/ai/config）
- [x] AI 连接测试接口
- [x] 解析进度 WS 推送

**验证标准**：配置 AI 接口后手动触发单首解析返回正确信息；扫描后自动触发（开关开启时）；低置信度进入待审核

---

### 阶段3：管理后台 UI
- [x] Hallmark Pre-flight 扫描（tokens.css）
- [x] Vite + React + TailwindCSS 搭建
- [x] 路由结构（Login/Dashboard/Songs/Scan/Separation/AiParse/Artists/Categories/Playlists/Devices/Settings）
- [x] Zustand 状态管理 / Axios + JWT 拦截器
- [x] 仪表盘统计图表（含 AI 解析统计）
- [x] 歌曲管理 / 上传 / 扫描任务 / 歌手管理 / 分类管理 / AI 解析中心 / 设备授权管理 / 系统设置
- [x] 每页面交付前通过 Hallmark 58 道 slop-test 门禁

**验证标准**：后台可视化操作所有歌曲功能，能看到待授权设备并完成授权，能管理歌手和分类，能配置 AI 并查看解析任务

---

### 阶段3.5：后端集成分离服务
- [x] separator-client 实现（HTTP 调用 Python 服务）
- [x] separation-queue 任务队列（并发控制、重试）
- [x] 扫描后自动入队分离任务
- [x] 分离任务 WS 进度推送
- [x] Admin 分离管理页 / 分离结果音频流接口 / 失败重试机制

**验证标准**：后台上传 MV/音频，Admin 页面实时看到分离进度，完成后可试听

---

### 阶段4：WebSocket + 设备授权 + 房间机制
- [x] WS 服务器 + 设备连接路由（按 device_id）
- [x] 房间码生成（后端生成 6 位随机码）
- [x] 设备注册接口（POST /api/devices/register）
- [x] 授权状态管理（pending/active/revoked/closed）
- [x] 临时授权/永久授权逻辑（authorize_type + authorize_expires_at）
- [x] 临时授权过期定时检查任务（每分钟扫描）
- [x] 过期前提醒推送（实现为提前 5 分钟，见 index.ts setInterval）
- [x] 授权状态校验中间件
- [x] 授权/撤销/续期 WS 推送
- [x] 点歌/插队/切歌消息协议
- [x] WS 断线重连（指数退避）/ 心跳检测 / 设备活跃状态更新 / 房间状态恢复

**验证标准**：电视端模拟注册 → 后台临时授权 → 收到授权消息并显示倒计时；过期后自动撤销回到等待界面；未授权/已过期房间点歌被拒绝

---

### 阶段5：手机点歌 H5
- [x] Hallmark Pre-flight 扫描（复用 tokens.css，mobile genre）
- [x] 移动端 UI（搜索/队列/我的点歌/歌单/分类/歌手）
- [x] WS 客户端 + 房间加入流程（含授权校验及过期提示）
- [x] 拼音搜索（首字母/全拼）/ 歌手索引 A-Z / 分类浏览
- [x] 点歌/插队/取消操作 / 播放状态实时同步
- [x] 未授权/已过期房间提示界面
- [x] 每页面交付前通过 Hallmark 58 道 slop-test 门禁（含移动端响应四档）

**验证标准**：手机扫码加入已授权房间点歌能进队列；扫码加入未授权/已过期房间显示提示；能按分类和歌手浏览点歌

---

### 阶段6：电视端 Tauri App（基础）
- [x] Tauri 项目搭建 + Android TV 打包配置
- [x] Hallmark Pre-flight 扫描（atmospheric genre）
- [x] 首次启动注册流程 / 等待授权界面 / 授权状态 WS 监听 / 临时授权倒计时
- [x] 授权后界面（二维码 + 播放器）/ 音频播放器 + 歌词同步 / MV 视频播放器
- [x] 房间 WS 连接 + 队列监听 / 基础遥控器键值映射
- [x] 每页面交付前通过 Hallmark 58 道 slop-test 门禁

**验证标准**：电视 APK 安装后首次启动能注册并显示房间码；临时授权显示倒计时；过期后回到等待界面；能播放手机点的歌

---

### 阶段6.5：TV 端原伴唱切换 + 高级控制
- [x] 双音轨同步播放（原文件 + 伴奏）
- [x] 原伴唱三模式切换（原唱/伴奏/人声辅助）
- [x] 音调调整（Web Audio API）/ 混响效果
- [x] 遥控器完整交互 / Android TV Leanback UI 规范适配
- [ ] 每页面/组件交付前通过 Hallmark 58 道 slop-test 门禁

**验证标准**：电视播放 MV/音频时按遥控器能切换原伴唱，音调可调；新增控件 CSS 首行带 Hallmark stamp

---

### 阶段7：飞牛 NAS Docker 部署
- [x] backend / admin-web / mobile-h5 多阶段 Dockerfile
- [x] separator Dockerfile（PyTorch 基础镜像）
- [x] docker-compose.yml 完整编排（5 服务）
- [x] nginx 反代配置
- [x] 数据目录挂载规范
- [x] 部署文档（见 deploy/README.md）

**验证标准**：NAS 上一键 `docker compose up` 全部服务可用

---

### 阶段8：体验优化（可选）
- [ ] 拼音搜索优化（模糊匹配）
- [ ] 歌词动效（卡拉 OK 逐字高亮）
- [ ] 音频可视化动效（频谱/波形）
- [ ] 房间切歌投票机制
- [ ] 歌曲收藏/历史
- [ ] 多语言支持
- [ ] 性能优化（大列表虚拟滚动）

---

## 十、关键风险与应对

| 风险 | 应对 |
|------|------|
| Tauri Android TV 打包环境复杂 | 备选方案：先做 Web 版 TV 界面，浏览器访问验证流程，再迭代 Tauri |
| FLAC/ID3 标签乱码 | chardet 库自动检测编码（GBK/UTF-8） |
| 大量歌曲扫描慢 | 流式扫描 + 进度 WS 推送，后台异步任务 |
| Android TV 遥控器适配 | 优先使用方向键+OK 键的最小交互集，复杂操作引导用手机 |
| WS 断线重连 | 心跳检测 + 自动重连 + 房间状态恢复 |
| Demucs CPU 推理慢（10 分钟 MV 需 15 分钟） | 异步队列 + 后台静默处理，不阻塞上传 |
| 飞牛 NAS 内存不足（ARM 设备普遍 2-4GB） | 限制并发=1，分块处理长 MV，监控内存 |
| 模型文件大（htdemucs 约 80MB） | 首次启动自动下载到持久化目录，避免重建容器重下 |
| 分离失败（音频格式异常） | 错误捕获 + 重试机制 + 失败原因记录 |
| NAS 无 GPU | CPU 模式运行，提供「高质量模型」可选开关 |
| 存储占用增加（每 MV+ 约 2 倍 MP3 体积） | 提供清理功能（删除已分离的音轨） |
| 电视端伪造 device_id 注册多个房间 | 限制同一 IP 的注册频率，管理员可手动清理无效设备 |
| 未授权电视端尝试 WS 点歌 | WS 消息处理前校验 authorized 字段，拒绝并返回错误 |
| 已授权房间被撤销时正在播放 | 立即停止播放，推送 ROOM_UNAUTHORIZED，清空队列 |
| 电视端 App 重装生成新 device_id | 旧房间记录保留（状态改为 closed），新 device_id 重新注册 |
| 设备长时间未活跃 | 定时任务检查 last_active_at，超时（如 30 天）自动改为 closed |
| 临时授权过期但用户正在唱歌 | 过期前提醒，过期后立即撤销并停止播放 |
| AI 接口不可用/超时 | 任务失败入队重试，不影响扫描入库主流程 |
| AI 解析结果不准确 | 置信度阈值过滤，低置信度进入待审核，管理员可手动修正 |
| AI 接口费用失控 | 提供批量解析开关和每日解析上限配置 |
| AI API Key 泄露 | 配置页脱敏显示，不返回完整 Key 给前端 |
| 歌手合并误操作 | 合并前二次确认，合并操作记录日志 |
| 分类被删除后歌曲孤立 | 删除分类项时自动解除关联，歌曲不丢失 |

---

## 十一、系统配置项（见开发/部署文档）

- **后端 / 分离 / AI 环境变量**（`.env`）：完整清单与默认值见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) §五 与 [deploy/README.md](./deploy/README.md#37-环境变量配置)。
- **Admin 系统设置页可配置项**（扫描路径、分离开关/模型/并发、AI 开关/接口/阈值/每日上限、设备授权默认时长、房间空闲超时、JWT 过期等）与上面环境变量一一对应，写入 `settings` 表，优先级：**settings 表 > 环境变量 > 默认值**。

---

## 十二、待确认事项

以下为开发前需确认的细节，请在核对时反馈：

1. **管理员账号初始化**：首次启动是否使用环境变量创建默认 admin 账户？还是命令行交互式创建？
2. **房间码格式**：6 位数字+字母混合（已确定，避免易混淆字符 0/O、1/I）？
3. **切歌机制**：默认独享（谁点谁切）还是投票制（多数同意才能切）？
4. **歌词来源**：仅依赖本地 .lrc 文件？还是需要在线 API 补全（如网易云歌词）？
5. **专辑封面**：仅从音频标签提取？还是支持在线补全？
6. **TV 端首次配置**：手动输入 NAS IP？还是通过 mDNS 自动发现？
7. **H5 端是否需要登录**：手机端进入房间是否需要昵称/头像？还是匿名加入？
8. **分离结果清理**：是否提供自动清理策略（如删除歌曲时同步删除分离文件）？
9. **设备授权审批方式**：管理员手动逐一授权？还是支持批量授权？
10. **授权撤销后电视端行为**：立即清空队列并回到等待界面？还是给 30 秒缓冲提示？
11. **临时授权默认时长选项**：提供哪些预设选项？（如 2 小时/4 小时/8 小时/1 天/7 天/自定义）
12. **临时授权过期前提醒时间**：10 分钟是否合适？是否需要可配置？
13. **AI 解析默认对接哪个服务**：OpenAI 官方？DeepSeek？通义千问？还是留空让用户自己配？
14. **AI 解析并发数**：AI 接口通常有 QPS 限制，建议并发数（如 2-5）？
15. **AI 解析失败重试次数**：默认重试几次后标记为失败？
16. **歌手合并是否需要审计日志**：合并操作是否需要记录日志以便追溯？

---

## 十三、开发优先级建议

**MVP（最小可用版本）路径**：

```
阶段1 → 阶段2 → 阶段3 → 阶段4 → 阶段5 → 阶段6 → 阶段7
        ↓
        阶段2.5（可与阶段3并行，人声分离微服务）
        阶段2.6（可与阶段3并行，AI 解析服务）
                ↓
                阶段3.5（依赖阶段2.5和3，集成分离服务）
                                ↓
                                阶段6.5（依赖阶段3.5的伴奏分离结果）
```

**先跑通核心闭环**：扫描歌曲 → 手机点歌 → 电视播放 → 再叠加人声分离和 AI 解析高级功能。

**AI 解析和人声分离均为可选增强功能**，不开启时不影响基础 KTV 流程。

---

## 文档变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-29 | 初版规划，含三端架构 + 人声分离功能 |
| v1.1 | 2026-07-29 | 调整房间码机制：电视端 App 安装时固定生成，默认未授权，需管理员授权后才能使用 |
| v1.2 | 2026-07-29 | ①房间授权支持临时/永久两种方式；②新增 AI 辅助解析；③新增歌手和分类手动维护功能 |
| v1.3 | 2026-07-29 | 阶段1 基础设施搭建完成 |
| v1.4 | 2026-07-29 | 阶段2 歌曲库扫描器完成 |
| v1.5 | 2026-07-29 | 阶段2.5 人声分离微服务 + 阶段2.6 AI 解析服务完成 |
| v1.6 | 2026-07-29 | 强制要求所有前端 UI 经 Hallmark 技能产出（新增 §2.1 Hallmark 约束） |
| v1.7 | 2026-07-30 | 阶段4 剩余三项补全（心跳/设备活跃状态/房间状态恢复） |
| v1.8 | 2026-07-30 | 阶段7 飞牛 NAS Docker 部署完成 |

> **2026-08 文档重构**：将已落地的技术参考（架构 / 本地开发 / API / 生产部署）拆分到各自权威文档（ARCHITECTURE.md、docs/DEVELOPMENT.md、docs/API.md、deploy/README.md），本文重定位为「开发路线图与规划历史」，仅保留产品规划、功能模块、路线图、风险、待确认与变更记录。

---

**阶段1、2、2.5、2.6、3、3.5、4、5、6、7 已完成，可继续执行阶段6.5（TV 端原伴唱切换+高级控制）或阶段8（体验优化，可选）。**
**注意：自 v1.6 起，所有前端 UI 设计与页面实现必须先 `Use Skill: hallmark`。**
