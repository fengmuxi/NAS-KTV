# API 接口参考（REST）

> 本文档汇总 NASKTV 后端暴露的 REST 接口。实时通信（房间/设备/队列/任务进度）走 WebSocket，消息类型见 [ARCHITECTURE.md](../ARCHITECTURE.md#websocket-消息类型)；本文件只列 HTTP 接口。
>
> 约定：
> - 基础路径（容器内/反代后）：`/api`
> - 除「设备注册」「房间加入」等标注「无需 JWT」的接口外，其余管理接口需带 `Authorization: Bearer <token>`（登录后获取）。
> - 路径参数用 `:xxx` 表示，例如 `/api/songs/:id`。

## 一、认证接口

```
POST   /api/auth/login              管理员登录（返回 token）
POST   /api/auth/logout             退出登录
GET    /api/auth/me                 获取当前登录用户
```

## 二、歌曲接口

```
GET    /api/songs                   歌曲列表（分页 / 搜索 / 筛选）
GET    /api/songs/:id               歌曲详情
PUT    /api/songs/:id               编辑歌曲信息
DELETE /api/songs/:id               删除歌曲
POST   /api/songs/upload            上传歌曲（音频 / MV，支持大文件分片）
GET    /api/songs/:id/lyrics        获取歌词
GET    /api/songs/:id/stream        音频流（支持 range）
GET    /api/songs/:id/mv            MV 视频流
```

## 三、扫描接口

```
POST   /api/scan/trigger            触发扫描（入库新文件）
GET    /api/scan/status             扫描状态
GET    /api/scan/history            扫描历史
```

## 四、人声分离接口

```
POST   /api/songs/:id/separate              触发单首分离
POST   /api/songs/separate-batch            批量分离
GET    /api/songs/:id/separation            查询分离状态
DELETE /api/songs/:id/separation            取消分离任务
GET    /api/songs/:id/vocals                人声音频流
GET    /api/songs/:id/instrumental          伴奏音频流
GET    /api/admin/separation/stats          分离统计
GET    /api/admin/separation/queue          任务队列
POST   /api/admin/separation/retry          批量重试
```

## 五、设备与房间接口

```
# 设备注册（电视端调用，无需 JWT）
POST   /api/devices/register                电视端首次启动注册（生成房间码）
GET    /api/devices/:device_id/status       查询设备授权状态（含授权类型 / 过期时间）

# 设备授权管理（管理员，需 JWT）
GET    /api/admin/devices                   设备列表（支持按状态 / 授权类型筛选）
GET    /api/admin/devices/pending           待授权设备列表
POST   /api/admin/devices/:id/authorize     授权设备
                                          Body: { "type": "permanent|temporary",
                                                  "expires_hours": 24,
                                                  "name": "客厅电视" }
POST   /api/admin/devices/:id/revoke        撤销授权
POST   /api/admin/devices/:id/renew         续期临时授权
                                          Body: { "expires_hours": 24,
                                                  "type": "temporary|permanent" }
PUT    /api/admin/devices/:id              编辑设备信息（名称等）
DELETE /api/admin/devices/:id              删除设备记录

# 房间加入（手机端调用，无需 JWT 但需房间码）
POST   /api/rooms/join                      加入房间（校验授权状态及是否过期）
                                          -- 已授权且未过期：返回 session_token
                                          -- 未授权 / 已过期：返回 403
```

## 六、AI 解析接口

```
# AI 配置管理
GET    /api/admin/ai/config                 获取 AI 配置（API Key 脱敏返回）
PUT    /api/admin/ai/config                 更新 AI 配置
                                          Body: { "enabled": true,
                                                  "base_url": "https://api.openai.com/v1",
                                                  "api_key": "sk-xxx",
                                                  "model": "gpt-4o-mini",
                                                  "temperature": 0.3,
                                                  "prompt_template": "...",
                                                  "auto_parse_after_scan": true,
                                                  "auto_parse_after_upload": true,
                                                  "confidence_threshold": 0.85 }
POST   /api/admin/ai/test                   测试 AI 连接（发送一个简单请求验证配置）

# AI 解析任务管理
POST   /api/songs/:id/ai-parse              触发单首 AI 解析
POST   /api/songs/ai-parse-batch            批量 AI 解析（Body: { "song_ids": [1,2,3] }）
GET    /api/songs/:id/ai-parse              查询 AI 解析状态 / 结果
GET    /api/admin/ai-parse/stats            AI 解析统计
GET    /api/admin/ai-parse/queue            任务队列
GET    /api/admin/ai-parse/review           待审核列表
POST   /api/admin/ai-parse/retry            批量重试
POST   /api/admin/ai-parse/:id/approve      审核通过（应用解析结果）
POST   /api/admin/ai-parse/:id/reject       审核拒绝
PUT    /api/admin/ai-parse/:id              修改解析结果后应用
```

## 七、歌手管理接口

```
GET    /api/artists                         歌手列表（分页 / 搜索 / 首字母筛选）
GET    /api/artists/:id                     歌手详情（含歌曲列表）
POST   /api/artists                         新增歌手（Body: { "name", "avatar", "bio" }）
PUT    /api/artists/:id                     编辑歌手
DELETE /api/artists/:id                     删除歌手（关联歌曲迁移到指定歌手或「未知」）
                                          Body: { "migrate_to": 123 }
POST   /api/artists/merge                   合并歌手（Body: { "source_ids": [1,2], "target_id": 3 }）
GET    /api/artists/:id/songs               歌手下所有歌曲
```

## 八、分类管理接口

```
# 分类组管理
GET    /api/categories                      所有分类组（含分类项树）
POST   /api/categories                      新增分类组（Body: { "name", "sort_order" }）
PUT    /api/categories/:id                  编辑分类组
DELETE /api/categories/:id                  删除分类组（需先清空分类项）

# 分类项管理
POST   /api/categories/:id/items            新增分类项（Body: { "name", "sort_order" }）
PUT    /api/category-items/:id              编辑分类项
DELETE /api/category-items/:id             删除分类项（自动解除歌曲关联）

# 歌曲 - 分类关联
POST   /api/songs/:id/categories            为歌曲添加分类（Body: { "category_item_ids": [1,2,3] }）
DELETE /api/songs/:id/categories/:itemId   从歌曲移除某分类
GET    /api/category-items/:id/songs        分类项下所有歌曲
```

## 九、歌单接口

```
GET    /api/playlists                歌单列表
POST   /api/playlists                创建歌单
PUT    /api/playlists/:id            编辑歌单
DELETE /api/playlists/:id            删除歌单
POST   /api/playlists/:id/songs      添加歌曲到歌单
DELETE /api/playlists/:id/songs/:songId  从歌单移除
```

## 十、内部回调接口

```
POST   /api/internal/separation-callback    Separator 服务回调（更新分离任务状态）
POST   /api/internal/scan-callback          扫描完成回调
```

## 参考

- 架构与 WebSocket 消息：[ARCHITECTURE.md](../ARCHITECTURE.md)
- 数据库表结构：[ARCHITECTURE.md](../ARCHITECTURE.md#数据库-schema-概览) / 规划见 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md)
- 环境变量（含 AI / 分离配置）：[docs/DEVELOPMENT.md](./DEVELOPMENT.md) §五
