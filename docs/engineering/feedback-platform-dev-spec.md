---
title: 多产品反馈平台开发说明
sidebar_position: 12
description: "给 Claude Code 的统一反馈平台开发说明：范围、Prisma 数据模型、API、Flutter 接入和内部后台"
---

# 多产品反馈平台开发说明

> 本文档替代 `/Users/yangbo/Downloads/blinklife_feedback_platform.md` 的 v1 草案，直接作为 Claude Code 的实现说明。
>
> 目标不是先做一个“完美通用平台”，而是在 BlinkLife 现有仓库上落一套可运行、可扩展、可继续演进的用户反馈闭环。

## 0. 核心结论

在开始开发前，先统一以下结论：

1. `Web / PC` 不是 product，它们是 `app / platform`。真正的 product 是 `BlinkLife`、`EchoNote` 这类产品线。
2. 当前后端唯一正确技术栈是 `NestJS + Prisma + PostgreSQL`。不要写成 `MySQL / PostgreSQL` 二选一，也不要设计一套脱离 Prisma 的独立 SQL 体系。
3. 现有 API 已经有全局前缀 `/api/v1`，新接口必须挂在这个前缀下，不要再设计成 `/api/feedback/v1`。
4. Phase 1 不做独立 Flutter SDK package，直接在 `blinklife-android/lib/services/` 下实现 `feedback_service.dart`。
5. 不要把现有 `guest_id` 直接上传到反馈平台。反馈系统单独引入 `feedback_install_id`，避免污染 Timeline / ownership 语义。
6. `blinklife-studio` 是桌面剪辑工具，不是反馈后台。Phase 1 的管理端放在 `blinklife-web` 的 internal 页面。
7. 原草案缺少幂等、防重复、状态流转、后台筛选索引、操作审计和权限约束，不能直接进入开发。
8. AI 聚类、时间轴反馈、附件上传都不是 Phase 1 必需项，应后置。

### 0.1 v1.1 修订（落地时对 v1.0 的改动）

v1.0 完成评审后进入实现。以下点与 v1.0 草案不同，以本 spec v1.1 为准：

1. **管理端鉴权**：从"静态 `FEEDBACK_ADMIN_TOKEN`"改为 **JWT + `users.roles` 白名单**。详见 §6.2。
2. **`content` 字段**：`TEXT` → `VARCHAR(10000)`；DTO 层同步校验。详见 §4.4。
3. **限流**：新增基础反滥用层（匿名/登录共享 IP 限流，`POST /feedback/records` 10 次/分钟）。详见 §5.2。
4. **`client_event_id` 生成时机**：写明"表单首次打开时生成并缓存，提交失败保留"，否则幂等失效。详见 §7.3。
5. **版本回归索引**：新增 `(app_id, app_version, created_at desc)` 索引，`app_version` 是后台筛选主键之一。详见 §4.4、§5.3。
6. **用户注销联动**：`feedback_records.user_id` 外键 `ON DELETE SET NULL`；注销 cron 触发时保留反馈但脱敏。详见 §4.4、§8.5（新增）。
7. **actor_type 语义**：登录用户**也可同时写** `anonymous_install_id`（不再互斥），便于同设备历史追溯。
8. **回复与用户端入口**：新增 `admin_reply` 事件（`visibility='user_visible'`）、`has_unread_reply` 字段；`PATCH /admin/feedback/records/:id` 接受 `reply` 参数；新增用户端 `/feedback/records/mine*` 三接口。详见 §4.7、§5.5、§5.7（新增）。
9. **消息中心**：不做。反馈回复复用 `feedback_record_events` + `profile_page` "我的反馈" 入口承载。详见 §7.5（新增）。
10. **UI 入口整合**：同步优化"意见反馈 / 我的反馈 / 关于 BlinkLife / 用户协议 / 隐私政策"入口；砍掉无内容的"帮助中心"。详见 §7.4。
11. **`users.roles` 字段**：新增 TEXT[] 字段用于多产品后台角色白名单。Phase 1 取值 `feedback_admin`。
12. **Web 后台**：`blinklife-web` 无 `src/app/internal/` 与 `src/proxy.ts`，需从零搭 Basic Auth 保护（Next.js 16 起 `middleware` 约定已更名为 `proxy`）。详见 §8.1/§8.3。
13. **Migration 风格**：对齐现有 `account_system_v1_*` 手写 SQL + `INSERT ON CONFLICT` seed，不单独引入 `prisma/seed.ts`。

## 1. 目标与范围

### 1.1 Phase 1 目标

先实现一套 BlinkLife 可用、但数据模型支持多产品扩展的 MVP：

- 用户可以从 Flutter 客户端提交反馈
- 后端能够按产品 / 应用 / 平台统一入库
- 内部可以在后台列表中筛选、查看、更新状态和标签
- 数据模型对未来 `EchoNote`、`BlinkLife Web`、`BlinkLife Studio` 保持兼容

### 1.2 Phase 1 必做

- `blinklife-api`：
  - Prisma 表结构
  - 提交反馈接口
  - 内部管理接口
  - 基础幂等与状态流转
- `blinklife-android`：
  - `feedback_install_id` 本地生成与持久化
  - `feedback_service.dart`
  - 一个最小可用的“意见反馈”页面
- `blinklife-web`：
  - internal feedback 列表页
  - detail 页
  - 基础筛选与状态更新

### 1.3 Phase 1 不做

- AI 聚类、自动摘要、自动优先级
- 文件上传和截图存储
- 独立 SDK package
- 单独的 admin 专用后端服务
- 完整 RBAC 体系
- APNs / FCM 推送通道（红点仅 app 启动/进入 profile_page 时拉取同步）
- 邮件触达（Apple private relay 触达率低，性价比差）
- 通用消息中心（反馈回复复用反馈详情 thread，不为单一业务建平台级中心）

> v1.1 修订：原 v1.0 草案包含”不做我的反馈记录页面”一项。v1.1 决定**做**一个最小版的”我的反馈”入口（见 §5.7 / §7.5），因为没有回复通路会让反馈质量螺旋下降。

## 2. 仓库归属

| 仓库 | 职责 | 本次范围 |
|---|---|---|
| `blinklife-api` | 反馈平台后端、Prisma、接口、内部管理接口 | 必做 |
| `blinklife-android` | Flutter 客户端提交通道与反馈表单 | 必做 |
| `blinklife-web` | internal 管理页 | 必做 |
| `blinklife-studio` | 桌面剪辑工具 | 本期不改 |
| `blinklife-docs` | 本说明文档 | 已更新 |

## 3. 统一领域模型

### 3.1 名词定义

| 名词 | 含义 | 例子 |
|---|---|---|
| `product` | 产品线 | `blinklife`、`echonote` |
| `app` | 某个产品下的具体客户端 | `blinklife_ios`、`blinklife_android`、`blinklife_web`、`blinklife_studio` |
| `platform` | 运行平台 | `ios`、`android`、`web`、`macos`、`windows`、`watchos`、`wearos` |
| `feedback record` | 一条原始反馈事实 | 一次“卡顿”“想加功能”“这个按钮难找” |
| `tag` | 内部运营/产品标签 | `lag`、`export`、`ux` |
| `event` | 对反馈记录的内部操作事件 | `created`、`status_changed`、`tag_added` |

### 3.2 身份策略

反馈提交支持两种 actor：

- 登录用户：服务端从 JWT 解析 `userId`
- 匿名安装：客户端提交 `feedback_install_id`

约束：

- 不信任客户端上传的 `user_id`
- 不复用现有 `guest_id`
- `feedback_install_id` 仅用于反馈平台匿名去重和简单聚合

## 4. 数据库设计

### 4.1 表命名

所有反馈相关表统一加 `feedback_` 前缀，避免和现有业务表冲突。

### 4.2 `feedback_products`

用途：产品线注册表。

建议字段：

- `id UUID PRIMARY KEY`
- `code VARCHAR(32) UNIQUE NOT NULL`
- `name VARCHAR(64) NOT NULL`
- `status VARCHAR(16) NOT NULL DEFAULT 'active'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### 4.3 `feedback_apps`

用途：具体应用注册表。

建议字段：

- `id UUID PRIMARY KEY`
- `product_id UUID NOT NULL`
- `code VARCHAR(64) NOT NULL`
- `name VARCHAR(64) NOT NULL`
- `platform VARCHAR(16) NOT NULL`
- `channel VARCHAR(32)`
- `status VARCHAR(16) NOT NULL DEFAULT 'active'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

约束：

- 外键：`product_id -> feedback_products.id`
- 唯一索引：`(product_id, code)`
- 索引：`(platform, status)`

### 4.4 `feedback_records`

用途：反馈事实表。

建议字段：

- `id UUID PRIMARY KEY`
- `product_id UUID NOT NULL`
- `app_id UUID NOT NULL`
- `user_id BIGINT NULL`
- `actor_type VARCHAR(16) NOT NULL`
- `anonymous_install_id UUID NULL`
- `client_event_id UUID NOT NULL`
- `feedback_type VARCHAR(32) NOT NULL`
- `source_type VARCHAR(32) NOT NULL`
- `scene VARCHAR(64)`
- `page VARCHAR(64)`
- `module VARCHAR(64)`
- `title VARCHAR(200)`
- `content VARCHAR(10000)`（v1.0 为 `TEXT`，v1.1 收紧长度）
- `status VARCHAR(16) NOT NULL DEFAULT 'new'`
- `priority VARCHAR(16) NOT NULL DEFAULT 'medium'`
- `app_version VARCHAR(32)`
- `build_number VARCHAR(32)`
- `os_version VARCHAR(64)`
- `device_model VARCHAR(64)`
- `locale VARCHAR(16)`
- `payload_json JSONB`
- `context_json JSONB`
- `last_admin_reply_at TIMESTAMPTZ NULL` *(v1.1 新增)*
- `has_unread_reply BOOLEAN NOT NULL DEFAULT FALSE` *(v1.1 新增，承担未读红点)*
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

字段说明：

- `actor_type`：`user | anonymous`（v1.1：登录用户提交时 `actor_type='user'` 但仍可附 `anonymous_install_id`，不再互斥）
- `feedback_type`：`bug | feature_request | performance | ux | praise | other`
- `source_type`：`quick_action | form | manual_import`
- `status`：`new | triaged | planned | in_progress | resolved | rejected | archived`（Phase 1 后端不做状态机校验，允许任意跳转；Phase 2 再加）
- `priority`：`low | medium | high | critical`

约束：

- 外键：`product_id -> feedback_products.id` `ON DELETE RESTRICT`
- 外键：`app_id -> feedback_apps.id` `ON DELETE RESTRICT`
- 外键：`user_id -> users.id` **`ON DELETE SET NULL`** *(v1.1：账号注销物理清理时反馈保留，仅脱敏)*
- 唯一索引：`(app_id, client_event_id)`，用于客户端重试去重
- 索引：`(product_id, created_at desc)`
- 索引：`(app_id, created_at desc)`
- 索引：`(status, priority, created_at desc)`
- 索引：`(feedback_type, created_at desc)`
- 索引：`(anonymous_install_id, created_at desc)`
- 索引：**`(app_id, app_version, created_at desc)`** *(v1.1 新增：版本回归查询)*
- 索引：**`(user_id, created_at desc)`** *(v1.1 新增：用户端「我的反馈」列表)*

设计说明：

- 经常筛选的字段单独建列，不要全塞到 JSONB
- 灵活扩展信息放 `payload_json`、`context_json`
- Phase 1 不做全文搜索，先走普通筛选 + 时间倒序
- DTO 层同步做长度/数量上限：`title ≤ 200`、`content ≤ 10000`、`client_tags` ≤ 10 且每个 ≤ 32、`payload/context` JSON 各 ≤ 16KB

### 4.5 `feedback_tags`

用途：内部标签字典。Phase 1 随 `feedback_platform_v1_tags_seed.sql` 迁移 seed 10 个 canonical 标签：`crash / lag / data_loss / ui_glitch / recording / review / clip / ble / watch / sync_account`。后台可通过后续 migration 增补；避免 `PATCH tag_codes` 引用不存在的 code 返回 400。

建议字段：

- `id UUID PRIMARY KEY`
- `product_id UUID NOT NULL`
- `code VARCHAR(32) NOT NULL`
- `name VARCHAR(32) NOT NULL`
- `color VARCHAR(16)`
- `status VARCHAR(16) NOT NULL DEFAULT 'active'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

约束：

- 唯一索引：`(product_id, code)`

注意：

- 客户端提交的自由文本标签不要直接写入这里
- 客户端只允许提交 `client_tags`，先落到 `payload_json.client_tags`
- `feedback_tags` 只存内部整理后的 canonical tags

### 4.6 `feedback_record_tags`

用途：反馈与标签的多对多关系。

建议字段：

- `id UUID PRIMARY KEY`
- `record_id UUID NOT NULL`
- `tag_id UUID NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

约束：

- 外键：`record_id -> feedback_records.id`
- 外键：`tag_id -> feedback_tags.id`
- 唯一索引：`(record_id, tag_id)`

### 4.7 `feedback_record_events`

用途：记录业务处理轨迹（与 `audit_logs` 区分：后者仅用于强安全事件）。

建议字段：

- `id BIGSERIAL PRIMARY KEY`
- `record_id UUID NOT NULL`
- `event_type VARCHAR(32) NOT NULL`
- `operator_type VARCHAR(16) NOT NULL`（v1.1：取值 `admin | system | migration`）
- `operator_id BIGINT NULL`（v1.1：从 `VARCHAR(64)` 改为 `BIGINT`，引 `users.id`；`ON DELETE SET NULL`）
- `visibility VARCHAR(16) NOT NULL DEFAULT 'internal'`（v1.1 新增：`internal | user_visible`）
- `payload_json JSONB`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

建议事件类型：

- `created`
- `status_changed`
- `priority_changed`
- `tags_replaced`
- `note_added`
- `admin_reply`（v1.1 新增，默认 `visibility='user_visible'`；`payload_json.reply_text` 为回复内容）

约束：

- 索引：`(record_id, created_at)` 时间线展示
- 索引：`(record_id, visibility, created_at)` 用户端 `/mine/:id` 只取 user_visible 事件

设计说明：

- Phase 1 不引入复杂工单系统，但必须保留操作轨迹
- 内部备注直接作为 `note_added` 事件存 `payload_json`
- `admin_reply` 事件写入时同步更新 `feedback_records.last_admin_reply_at` + `has_unread_reply=true`

### 4.8 Phase 1 不建的表

本期不建以下表，避免范围失控：

- `feedback_attachments`
- `feedback_clusters`
- `feedback_saved_views`
- `feedback_notifications`

## 5. API 设计

### 5.1 路由前缀

全局前缀已存在：`/api/v1`

因此反馈相关接口统一为：

- 客户端提交：`/api/v1/feedback/records`
- 内部管理：`/api/v1/admin/feedback/...`

### 5.2 客户端提交接口

`POST /api/v1/feedback/records`

认证策略：

- `Authorization` 可选
- 有 JWT：按登录用户入库
- 无 JWT：要求带 `anonymous_install_id`

请求示例：

```json
{
  "product_code": "blinklife",
  "app_code": "blinklife_ios",
  "client_event_id": "01966e49-b2b2-7af5-b6b6-1e2e5d2d1c91",
  "anonymous_install_id": "01966e49-b2b2-7af5-b6b6-1e2e5d2d1c90",
  "feedback_type": "performance",
  "source_type": "form",
  "scene": "clip_finish",
  "page": "review_page",
  "module": "feedback_page",
  "title": "导出后预览卡顿",
  "content": "导出 4K 后回到复盘页，拖动进度条会明显掉帧",
  "client_tags": ["lag", "export"],
  "payload": {
    "action": "manual_submit"
  },
  "context": {
    "platform": "ios",
    "app_version": "5.1.1",
    "build_number": "5110",
    "os_version": "iOS 18.1",
    "device_model": "iPhone 16 Pro",
    "locale": "zh-CN"
  }
}
```

返回示例：

```json
{
  "id": "8a2f6ad3-5f8c-4cf2-b7db-51cfcc4c0a8f",
  "status": "new",
  "deduped": false
}
```

幂等规则：

- 若 `(app_id, client_event_id)` 已存在，则返回已有记录
- 重复提交返回 `200`，并带 `deduped: true`
- 新建也返回 `200`（v1.1 统一用 200；仍带 `deduped: false` 区分）

服务端规则：

- 只接收 `product_code` / `app_code`，由服务端换出 `product_id` / `app_id`
- 忽略客户端传的 `user_id`
- `client_tags` 不直接写入 `feedback_tags`，先落 `payload_json.client_tags`
- Authorization 可选；若 JWT 合法，`actor_type='user'` 且记录 `user_id`；JWT 非法时安静降级为匿名（不抛 401，避免过期 token 阻断反馈）

限流（v1.1 新增）：

- 全局 `ThrottlerGuard` 默认 60 次/分钟/IP
- `POST /feedback/records` 通过 `@Throttle({ default: { limit: 10, ttl: 60_000 } })` 收紧到 10 次/分钟/IP
- 登录/匿名一视同仁按 IP 限流；超限返回 `429 Too Many Requests`

请求体长度约束（v1.1 新增）：

- `title` ≤ 200
- `content` 必填，1–10000 字符（服务端 trim 后校验）
- `client_tags` ≤ 10 个，每个 1–32
- `payload` / `context` JSON 序列化后各 ≤ 16KB；超限返回 `409 Conflict`

### 5.3 内部列表接口

`GET /api/v1/admin/feedback/records`

支持筛选：

- `product_code`
- `app_code`
- `platform`
- `status`
- `priority`
- `feedback_type`
- `source_type`
- `tag_code`
- `keyword`
- `created_from`
- `created_to`
- `page`
- `scene`
- `app_version`（v1.1 新增：按版本回归筛选，对应 `(app_id, app_version, created_at desc)` 索引）

分页：`page_number`（从 1 开始）+ `page_size`（默认 20，上限 100）。

返回字段至少包含：

- `id`
- `product_code`
- `app_code`
- `platform`
- `feedback_type`
- `status`
- `priority`
- `title`
- `content_excerpt`
- `tag_codes`
- `created_at`

### 5.4 详情接口

`GET /api/v1/admin/feedback/records/:id`

返回：

- 完整基础字段
- `payload_json`
- `context_json`
- canonical tags
- `feedback_record_events`

### 5.5 更新接口

`PATCH /api/v1/admin/feedback/records/:id`

允许修改：

- `status`
- `priority`
- `tag_codes`（**全量替换**；空数组表示清空）
- `note`
- `reply`（v1.1 新增：写 `admin_reply` 事件，`visibility='user_visible'`，用户可在"我的反馈"详情看到）

更新规则：

- 修改 `status` 时写入 `status_changed`
- 修改 `priority` 时写入 `priority_changed`
- 替换标签时写入 `tags_replaced`
- 若传 `note`，新增 `note_added` 事件
- 若传 `reply`（v1.1）：
  - 写入 `admin_reply` 事件，`visibility='user_visible'`，`payload_json.reply_text = reply`
  - 更新 `feedback_records.last_admin_reply_at = now()`
  - 更新 `feedback_records.has_unread_reply = true`（用户调 `/read` 后清除）
- 所有 internal 事件的 `operator_id` 必须为当前 admin 的 `users.id`（由 `FeedbackAdminGuard` 注入 `request.user`）

### 5.6 Meta 接口

`GET /api/v1/admin/feedback/meta`

返回：

- products
- apps
- tags

用于后台筛选面板初始化。

v1.1 修订：`enum options`（feedback_type / status / priority / source_type）是常量，前端硬编码，不走此接口。

### 5.7 用户端"我的反馈"接口（v1.1 新增）

均挂在客户端前缀 `/feedback/records/mine*`，要求 JWT，不接受 `anonymous_install_id` 作为身份（否则任何人塞一个 install_id 就能读别人反馈）。

#### `GET /api/v1/feedback/records/mine`

查询参数：

- `unread_only`：`true | false`，默认 false。true 时仅返回 `has_unread_reply=true` 的条目
- `limit`：默认 20，上限 100。**`limit=0` 时仅返回计数**（`items=[]` + `unread_count` + `total_count`），用于 profile 红点同步的轻量路径
- `before`：游标（ISO8601），取 `created_at < before` 的上一页

返回：

```json
{
  "items": [
    {
      "id": "uuid",
      "feedback_type": "bug",
      "status": "in_progress",
      "title": "…",
      "content_excerpt": "…",
      "created_at": "…",
      "last_admin_reply_at": "…",
      "has_unread_reply": true
    }
  ],
  "unread_count": 2
}
```

#### `GET /api/v1/feedback/records/mine/:id`

返回反馈详情 + **仅 `visibility='user_visible'` 的事件**（当前只有 `admin_reply`）。

越权防护：服务端 `findFirst({ id, userId: req.user.id })`，非本人反馈返回 `404 Not Found`（不暴露存在性）。

返回结构：

```json
{
  "id": "uuid",
  "feedback_type": "bug",
  "status": "in_progress",
  "title": "…",
  "content": "…",
  "created_at": "…",
  "last_admin_reply_at": "…",
  "has_unread_reply": false,
  "events": [
    {
      "id": "…",
      "event_type": "admin_reply",
      "created_at": "…",
      "reply_text": "…"
    }
  ]
}
```

#### `POST /api/v1/feedback/records/mine/:id/read`

标记红点已读：设置 `has_unread_reply = false`。越权同样 404。

## 6. 鉴权与权限

### 6.1 客户端提交接口

- 匿名用户允许提交
- 登录用户允许提交
- Phase 1 不做复杂风控

### 6.2 管理接口（v1.1 修订）

v1.0 草案使用 `FEEDBACK_ADMIN_TOKEN` 静态环境变量；v1.1 改为复用 JWT，原因：
- 项目已有 JWT + `audit_logs` + 多设备管理；静态 token 会让 `feedback_record_events.operator_id` 无法追溯到人
- 后台回复功能需要记录"谁回复的"，静态 token 做不到

Phase 1 方案：

- `users` 表新增 `roles TEXT[]`（默认 `{}`），可持有白名单角色
- `FeedbackAdminGuard extends AuthGuard('jwt')`，在 `canActivate` 中额外校验 `request.user.roles` 是否包含 `'feedback_admin'`
- 授予方式（Phase 1 由运维手动）：
  ```sql
  UPDATE users SET roles = array_append(roles, 'feedback_admin') WHERE id = ?;
  ```
- `blinklife-web` 后台页面自身额外用 **Basic Auth**（middleware）做最外层保护，向 blinklife-api 调用时通过环境变量 `FEEDBACK_ADMIN_JWT` 注入已签发的 feedback_admin 用户 JWT；**JWT 不出 Next.js 服务端**

说明：

- 这是 Phase 1 的内部工具权限方案，不是最终 RBAC
- 等真正需要多人后台账号时，再升级为统一后台身份体系（Web 登录 → 服务端按 user.roles 校验，删掉静态 JWT 环境变量）

## 7. Flutter 客户端实现约束

### 7.1 不做独立 SDK package

直接在现有 app 内实现：

- `lib/services/feedback_install_id_service.dart`
- `lib/services/feedback_service.dart`
- `lib/screens/feedback_page.dart`

### 7.2 `feedback_install_id`

新增独立匿名标识：

- 首次提交反馈前生成 UUID
- 使用 `flutter_secure_storage` 持久化
- 不复用 `guest_id`

### 7.3 `feedback_service.dart`

职责：

- 组装 payload
- 调 `ApiService`（复用 JWT 拦截器）
- 登录用户与匿名用户统一走 `ApiService`；匿名时 `AuthService.getAccessToken()` 返回 null，拦截器不挂 Authorization，不触发 401 refresh
- 自动补 `feedback_install_id`（登录用户也带，用于同设备历史追溯）

不要做的事：

- 不把所有通用 HTTP 逻辑复制一遍
- 不新建一个”SDK 初始化器”
- 不在服务层塞 UI 状态
- 不在 service 内部自生 `client_event_id`（避免 service 重试导致新 ID 破坏幂等）

#### `client_event_id` 生成时机（v1.1 关键点）

**必须在反馈表单 StatefulWidget 的 `initState` 生成一次并持有**；重试复用同一 ID，服务端才能去重。

- 新打开反馈页 → `_clientEventId = uuid.v4()`
- 提交失败 → 保留 `_clientEventId`（用户重试时服务端返回 `deduped=true` 或同 ID 新建）
- 提交成功 → 页面内如允许继续提交下一条，需显式重置为新 UUID
- `FeedbackService.submit()` 的入参 `clientEventId` 由调用方提供，service 不自生

### 7.4 反馈页面与入口整合（v1.1）

反馈新建页（`feedback_page.dart`）要求最小化：

- 反馈类型选择（chip 组，不用下拉）
- 标题（可选）
- 内容（必填，trim 后至少 1 字符；hint 引导详细描述但不做硬性字数校验）
- “附带诊断信息”开关（默认开；下方小字说明采集范围 + 隐私政策链接）
- 提交按钮
- 提交成功后展示”已收到”；**不暴露 record_id**

诊断信息开关打开时，附带以下字段到 `context`：

- platform
- os_version
- device_model
- app_version
- build_number
- locale
- 当前页面名（`page` / `scene`）

入口层整合（`profile_page.dart`）：

- 现有 5 个偏好设置行原为死链（”隐私设置 / 帮助中心 / 关于 BlinkLife”）。v1.1 统一收拾：
  - **意见反馈** → `FeedbackPage`（新增）
  - **我的反馈** → `MyFeedbackPage`（v1.1 新增；仅登录态显示，带未读 badge）
  - **关于 BlinkLife** → `AboutPage`（版本/构建号/协议/官网，新增）
  - **帮助中心** → 砍掉入口（Phase 1 无内容，避免空壳）
  - **隐私设置** → 保留入口，Phase 1 不挂跳转（独立立项）
- 协议查看：新增通用 `AssetWebViewPage`，承载 `assets/userprotocol.html` / `assets/privacy.html`；同时清掉 `account_security_page.dart` 里的 `// TODO: 跳转到协议查看页` TODO
- `profile_overlay.dart` 浮层底部增加一行”意见反馈”文字按钮（快捷入口），不加”我的反馈”

Feature flag：`FeatureFlags.kFeedbackEnabled` 默认 `true`。出问题时一键关闭入口与接口调用。

界面约束：

- 不改录制页、复盘页、剪辑页核心结构
- 不新做复杂视觉稿
- thread 详情页气泡样式对齐 iOS 26 Liquid Glass（在已有项目深色 + 圆角卡片风格上即可）

### 7.5 “我的反馈”详情 thread（v1.1 新增）

`my_feedback_detail_page.dart`：

- 顶部：类型 chip + 状态 chip + 提交时间
- 主体气泡：
  - 右侧（蓝色）：用户原始 title + content
  - 左侧（深灰）：历次 `admin_reply` 气泡，头部显示”BlinkLife 团队”
- **无输入框**（Phase 1 不支持用户追加回复，引导新建反馈补充）
- 进入时如 `has_unread_reply=true`，自动调 `POST /mine/:id/read` 清红点
- 红点 badge 同步：`profile_page._loadData()` 调 `FeedbackService().fetchUnreadCount()`（底层 `GET /mine?unread_only=true&limit=0`），登录态且 `kFeedbackEnabled` 时执行

## 8. Web internal 后台实现约束

### 8.1 放置位置

后台页面放在 `blinklife-web`（v1.1 确认：项目为 Next.js 16 + App Router + React 19 + Tailwind 4 + Zustand，无 UI 库）：

- `src/proxy.ts`（v1.1 新增：Basic Auth 保护 `/internal/*`；Next.js 16 起 `middleware` 文件约定更名为 `proxy`）
- `src/app/internal/layout.tsx`（v1.1 新增：统一布局 + noindex）
- `src/app/internal/feedback/page.tsx`（server component，含筛选 + 分页）
- `src/app/internal/feedback/[id]/page.tsx`（server component，展示基础信息 + 事件时间线）
- `src/app/internal/feedback/[id]/FeedbackDetailActions.tsx`（client component，状态/优先级/标签/备注/回复编辑面板）
- `src/app/internal/api/feedback/[id]/route.ts`（Next.js route handler 代理 PATCH；admin JWT 不出服务端）
- `src/lib/feedback-api.ts`（server 端向 blinklife-api 调用的薄封装）

不要放在 `blinklife-studio`。

### 8.2 页面范围

列表页：

- 筛选区
- 列表表格或卡片
- 状态 / 优先级快速修改

详情页：

- 基础信息
- 原始上下文
- 标签编辑
- 处理备注
- 事件时间线

### 8.3 页面鉴权（v1.1）

本期交付 web internal 页面，同时做最小保护：

- 页面访问层：`src/proxy.ts` Basic Auth（Next.js 16 proxy 约定），密码从 `FEEDBACK_ADMIN_BASIC_USER` / `FEEDBACK_ADMIN_BASIC_PASSWORD` 环境变量读取；未配置时返回 503，防止"忘记配 env → 后台裸奔"
- API 调用层：server component / route handler 通过环境变量 `FEEDBACK_ADMIN_JWT` 向 blinklife-api 调用；浏览器只通过 `/internal/api/*` 路由和 Next.js server 通信
- 客户端 `FeedbackDetailActions` 的 `fetch('/internal/api/feedback/:id', { method: 'PATCH' })` 由 Next.js 代理转发；admin JWT 绝不出服务端

不要把 admin JWT 暴露到浏览器侧。

### 8.5 数据保留与用户注销联动（v1.1 新增）

- **不做 hard delete**：管理端无删除按钮，用 `status='archived'` 软归档覆盖垃圾/违规场景；Phase 2 再考虑 `merged_into_id` 做合并
- **账号注销联动**：
  - `AccountCleanupTask @Cron(EVERY_DAY_AT_3AM)` 物理清理 `users.status='deleting'` + 宽限期过期的用户
  - `feedback_records.user_id` 外键 `ON DELETE SET NULL`，反馈保留用于产品数据分析
  - 注销 cron 执行前额外将关联反馈的 `anonymous_install_id` 设为 NULL，做设备级脱敏
  - `context_json.device_model / os_version / locale` 保留（非个人标识）
- **日志与审计**：
  - `feedback_record_events` 存业务时间线
  - `audit_logs` 仅对强安全事件写入（登录/注销/设备撤销等）
  - 两处避免重复记账

## 9. 后端实现拆解

### 9.1 `blinklife-api` 目录建议（v1.1 实施结果）

实际新增：

- `src/feedback/feedback.module.ts`
- `src/feedback/feedback.controller.ts`（含 POST + 3 个 `/mine*`）
- `src/feedback/feedback-admin.controller.ts`
- `src/feedback/feedback.service.ts`
- `src/feedback/dto/create-feedback.dto.ts`
- `src/feedback/dto/list-feedback.dto.ts`
- `src/feedback/dto/update-feedback.dto.ts`
- `src/feedback/guards/feedback-admin.guard.ts`（v1.1：放在模块内，不塞到 `src/common/guards/`）

并修改：

- `prisma/schema.prisma`
- `src/app.module.ts`（接入 `ThrottlerModule` + `FeedbackModule`）
- `src/auth/auth.module.ts`（`exports: [AuthService, JwtModule]`，让 feedback 复用 JwtService 做可选验签）
- `src/auth/jwt.strategy.ts`（validate 返回 `roles` 字段）

### 9.2 Prisma 建模要求（v1.1）

- 使用 Prisma model 声明表结构，`npx prisma generate` 生成 client
- 时间字段统一 `@db.Timestamptz()`
- 统一 `@map("snake_case")`
- 关联现有 `User` 表时使用 `BigInt`
- Migration 风格对齐现有 `account_system_v1_*.sql`：手写 SQL + `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ON CONFLICT DO NOTHING` 幂等保证
- 新 migration 命名：`feedback_platform_v1_up.sql`
- Seed（blinklife product + 4 apps）直接 `INSERT ON CONFLICT DO NOTHING` 写在同一文件末尾，不引入 `prisma/seed.ts` 脚手架

### 9.3 Seed 要求

至少插入：

- product: `blinklife`
- apps:
  - `blinklife_ios`
  - `blinklife_android`
  - `blinklife_web`
  - `blinklife_studio`

说明：

- `EchoNote` 先不强制接客户端
- schema 必须允许未来新增 `echonote`

## 10. 测试与验收

### 10.1 后端必须验证

- 匿名提交成功
- 登录用户提交成功
- 同一 `client_event_id` 重试被去重
- 列表筛选可用
- 状态更新写入事件表
- 标签替换写入事件表

### 10.2 Flutter 必须验证

- 未登录可提交
- 已登录可提交
- 页面提交失败有错误提示
- `feedback_install_id` 持久化后多次提交通用

### 10.3 Web 必须验证

- internal 页面能打开列表
- 筛选能生效
- detail 页能改状态 / 优先级 / 标签
- 操作后刷新仍能看到最新数据

## 11. Phase 2 / Phase 3 预留

### 11.1 Phase 2

- 附件上传
- Web / Studio 客户端接入
- 看板统计
- 更细的标签体系

### 11.2 Phase 3

- AI 聚类
- 相似问题归并
- 自动标签
- 自动优先级
- 版本回归识别

## 12. Claude Code 执行顺序（v1.1 实施结果）

v1.1 已按以下顺序执行完毕：

1. `blinklife-api`：
   - Prisma schema（6 张 feedback 表 + `users.roles`）
   - `feedback_platform_v1_up.sql` migration + INSERT seed
   - `@nestjs/throttler` 接入
   - feedback module / controller / service / DTO / guard
   - `/mine*` 三个用户端接口
   - admin PATCH 支持 `reply`
2. `blinklife-android`：
   - `feedback_install_id_service.dart`
   - `feedback_service.dart`
   - `feedback_page.dart`
   - `my_feedback_page.dart` / `my_feedback_detail_page.dart`
   - `about_page.dart` / `asset_webview_page.dart`
   - `feature_flags.dart` 加 `kFeedbackEnabled`
   - `profile_page.dart` / `profile_overlay.dart` / `account_security_page.dart` 整合入口
3. `blinklife-web`：
   - `src/proxy.ts`（Basic Auth；Next.js 16 proxy 约定）
   - `src/app/internal/layout.tsx`
   - `src/app/internal/feedback/page.tsx`（列表）
   - `src/app/internal/feedback/[id]/page.tsx`（详情）
   - `src/app/internal/feedback/[id]/FeedbackDetailActions.tsx`（编辑面板）
   - `src/app/internal/api/feedback/[id]/route.ts`（PATCH 代理）
   - `src/lib/feedback-api.ts`
4. 文档（本 spec）

执行约束：

- 不要先做 AI
- 不要先做附件上传
- 不要新建独立 SDK 仓库
- 不要把反馈后台做进 `blinklife-studio`
- 不要复用 `guest_id`
- 不要用 `BackdropFilter` 做 Android 浮层（CLAUDE.md 已规定降级方案）

## 13. Definition Of Done

满足以下条件才算 Phase 1 完成：

- BlinkLife iOS / Android 可以提交反馈
- 后端按 product / app / platform 正确入库
- 内部后台能筛选、查看、改状态、改优先级、改标签、写备注
- 客户端重试不会产生重复记录
- 所有改动贴合现有仓库结构，没有额外造轮子

