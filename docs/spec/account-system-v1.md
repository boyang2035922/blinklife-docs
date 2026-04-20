---
title: 账号体系规范 v1
sidebar_position: 1
description: "BlinkLife 主账号 + 多身份绑定 + 资产归属 + 权益 + 设备 + 审计 的平台型底座合约"
---

# 账号体系规范 v1

> 本文档是 BlinkLife 账号体系的合约权威源。覆盖客户端（Android / WatchOS / Wear / Web / Studio / iOS）与后端（NestJS + Postgres）的共同约定。
>
> 本规范目标不是做"登录功能"，而是构建可承载资产、可接支付、可向多端与多产品扩展的**平台底座**。

:::info 实施状态（2026-04-20）
- §2 身份模型：**全部落地**（users/user_profiles/auth_identities/auth_sessions/user_devices/user_entitlements 六表已建）
- §3 认证协议：**Apple / 微信 / 游客升级 / token 刷新 / 登出 均已落地**；token 刷新已切读 `auth_sessions`
- §5 客户端状态机：**已落地**（AccountSecurityPage 入口 + 15 天宽限期 + cron 物理清理）
- §6 API 合约：**已落地**（`/auth/*` / `/user/profile|identities|devices` / `/account/delete/*`），路由前缀使用 `/user` 而非规范里的 `/me`
- §9 迁移规划：**阶段 1-5 全部完成**。阶段 4 切读已通过；阶段 5 已下线老 `refresh_tokens` 表（因无线上用户直接破坏性清理，跳过阶段 4→5 过渡期）
- 多产品前瞻：JWT 加 `aud='blinklife'`、`audit_logs.product` DB 默认 `'blinklife'` 已预埋
- §7 合规 / §4 权益订单：iOS Xcode Sign in with Apple capability + IAP 集成 **待人工对接**
:::

## 0. 术语与前提

| 术语 | 含义 |
|---|---|
| **主账号** | BlinkLife 内部 `users.id`（UUID v7 字符串）。唯一、稳定、与第三方解耦。 |
| **身份（Identity）** | 第三方登录凭证（Apple / WeChat / Phone）。一个主账号可绑多个身份，一个身份只能绑一个主账号。 |
| **会话（Session）** | 一次登录产生的 access + refresh token 组合，与设备一对一绑定。 |
| **资产（Asset）** | 归属于主账号的数据：录制、打点、剪辑、收藏、分享等。 |
| **权益（Entitlement）** | 主账号可使用的付费能力，如 Pro 会员、AI 次数、云存储配额。 |
| **游客** | 未登录用户，本地以 `guest_id`（UUID v7）标识。游客数据仅本地，不入服务端。 |

**前提冻结**：
- 后端数据库：**PostgreSQL**（与 `blinklife-api/prisma/schema.prisma` L10 一致，与参考文档中 MySQL DDL 仅作语义参考）
- 主键类型：**UUID v7 字符串**（不再用 BigInt autoincrement）
- 时间一律 UTC（`TIMESTAMPTZ`）
- 字段命名后端 `snake_case`（数据库）+ `camelCase`（Prisma）+ `snake_case`（API JSON），各层转换
- 登录方式首发：**Apple Sign-in + 微信登录**（iOS 上架硬约束）

## 1. 分层架构

```text
┌─────────────────────────────────────────────┐
│  Risk & Audit（风控与审计）                 │  audit_logs
├─────────────────────────────────────────────┤
│  Payment（支付）                            │  orders / payment_transactions
├─────────────────────────────────────────────┤
│  Entitlement（权益）                        │  user_entitlements / skus
├─────────────────────────────────────────────┤
│  Asset（资产归属）                          │  cloud_recording.owner_user_id 等
├─────────────────────────────────────────────┤
│  Device（设备）                             │  user_devices
├─────────────────────────────────────────────┤
│  Profile（资料）                            │  user_profiles
├─────────────────────────────────────────────┤
│  Identity（身份）                           │  users / auth_identities / auth_sessions
└─────────────────────────────────────────────┘
```

**跨层调用约束**：
- Asset / Entitlement / Payment 只能依赖 Identity（读 `user_id`），**不得依赖 auth_identities / auth_sessions** 的内部结构
- 业务代码**禁止**直接写 `users.is_vip` 之类的硬编码字段；权益一律查 `user_entitlements`
- 支付结果**不得直接改权限**，必须走「订单 → 票据验证 → 交易记录 → 发放 entitlement → 业务读 entitlement」闭环

**谁拥有什么数据**：

| 层 | 数据所有者 | 其他层访问方式 |
|---|---|---|
| Identity | 认证服务 | 只读 `user_id` |
| Profile | 用户服务 | 只读（公开字段） |
| Asset | 各业务服务（录制 / 剪辑 / 分享） | 按 `owner_user_id` 查询 |
| Entitlement | 权益服务 | 调用 `checkEntitlement(user_id, feature)` |
| Payment | 支付服务 | 发事件通知 Entitlement 发放权益 |
| Device | 设备服务 | 认证服务写，业务层只读 |
| Audit | 审计服务 | 只写（各层调用 `audit.log()`） |

## 2. 身份模型（核心数据表）

### 2.1 `users`（主账号表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | UUID v7，客户端可预生成，服务端幂等接受 |
| `legacy_id` | BigInt | UNIQUE, NULL | 迁移期保留的老自增 ID，新账号为空 |
| `status` | varchar(32) | NOT NULL | `active / deleting / deleted / banned` |
| `register_source` | varchar(32) | NOT NULL | 首次注册来源：`wechat / apple / phone / guest_upgrade` |
| `risk_level` | varchar(16) | NOT NULL, default `normal` | `normal / review / blocked` |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |
| `deleted_at` | timestamptz | NULL | 软删除时间 |

**约束**：
- `id` 一律 UUID v7，禁止使用 BigInt autoincrement（见 §9 迁移）
- `users` 本身不存第三方 openid / apple sub / phone，全部下沉到 `auth_identities`
- `legacy_id` 仅迁移期使用，切换完成后保留但不再写

### 2.2 `user_profiles`（用户资料表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `user_id` | UUID | PK, FK → users.id | |
| `nickname` | varchar(64) | | |
| `avatar_url` | varchar(512) | | |
| `display_name` | varchar(64) | | |
| `sports_preferences` | jsonb | | 运动偏好，结构化 |
| `locale` | varchar(16) | | |
| `timezone` | varchar(64) | | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**约束**：资料与身份分离——改头像 / 昵称不影响 Identity 层；首发保留最小字段。

### 2.3 `auth_identities`（身份绑定表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | NOT NULL, FK → users.id | |
| `provider` | varchar(32) | NOT NULL | `wechat / apple / phone / email` |
| `provider_user_id` | varchar(128) | NOT NULL | 微信 openid / Apple sub / 手机号 |
| `union_key` | varchar(128) | NULL | 微信 unionid / Apple email（可选） |
| `credential_meta` | jsonb | NULL | 非敏感元数据（上次授权 scope 等） |
| `is_primary` | boolean | NOT NULL, default false | 该用户的首选登录方式 |
| `bound_at` | timestamptz | NOT NULL | |
| `last_login_at` | timestamptz | NULL | |
| UNIQUE (`provider`, `provider_user_id`) | | | 一个第三方身份只能绑一个主账号 |
| INDEX (`user_id`) | | | |

**约束**：
- 微信登录：`provider='wechat'`, `provider_user_id=openid`, `union_key=unionid`
- Apple 登录：`provider='apple'`, `provider_user_id=sub`, `union_key=email`（可选）
- 手机号：`provider='phone'`, `provider_user_id=E.164 手机号`
- `credential_meta` 不存敏感凭证（access_token / secret），仅存可审计的元数据

### 2.4 `auth_sessions`（会话表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | NOT NULL, FK → users.id | |
| `device_id` | UUID | NOT NULL, FK → user_devices.id | |
| `access_token_hash` | varchar(128) | NOT NULL | SHA-256 hash；明文 token 不入库 |
| `refresh_token_hash` | varchar(128) | NOT NULL | |
| `status` | varchar(32) | NOT NULL | `active / revoked / expired` |
| `expires_at` | timestamptz | NOT NULL | refresh_token 过期时间 |
| `revoked_at` | timestamptz | NULL | |
| `login_ip` | varchar(64) | NULL | |
| `login_region` | varchar(64) | NULL | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |
| INDEX (`user_id`), (`device_id`) | | | |

**约束**：
- Token 不明文入库，只存 hash
- 登出 = 将 `status` 改为 `revoked`
- 单设备最多一个 `active` session；新登录撤销旧 session

### 2.5 `user_devices`（设备表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | NOT NULL, FK → users.id | |
| `device_type` | varchar(32) | NOT NULL | `ios_phone / android_phone / apple_watch / wear_os / web / pc_studio / ble_ring` |
| `device_name` | varchar(128) | NULL | 如 "iPhone 15 Pro" |
| `os_version` | varchar(64) | NULL | |
| `app_version` | varchar(64) | NULL | |
| `device_fingerprint` | varchar(256) | NULL | 客户端生成的稳定指纹（非 IDFA） |
| `trusted_flag` | boolean | NOT NULL, default true | |
| `last_active_at` | timestamptz | NULL | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |
| INDEX (`user_id`) | | | |

## 3. 认证协议

### 3.1 Apple Sign-in 流程

```text
客户端
  ├─ 触发 ASAuthorizationAppleIDProvider.performRequest()
  ├─ 用户完成 Apple 授权
  ├─ 获得 identity_token + authorization_code
  └─ POST /v1/auth/apple
        { identity_token, authorization_code, device_info }
            ↓
后端
  ├─ 验证 identity_token（Apple 公钥验签）
  ├─ 解析 sub / email
  ├─ 查询 auth_identities(provider='apple', provider_user_id=sub)
  │     ├─ 存在 → user_id = 该绑定
  │     └─ 不存在 →
  │          ├─ 新建 users
  │          ├─ 新建 user_profiles（最小资料）
  │          ├─ 新建 auth_identities
  │          └─ register_source = 'apple'
  ├─ upsert user_devices(device_info)
  ├─ 新建 auth_sessions（revoke 同设备旧 session）
  └─ 返回 { access_token, refresh_token, user, entitlements }
```

### 3.2 微信登录流程

流程同 Apple，差异：
- `POST /v1/auth/wechat` 接收 `code`
- 后端用 `code` 换微信 `openid / unionid / access_token`（仅服务端用）
- `auth_identities(provider='wechat', provider_user_id=openid, union_key=unionid)`
- `register_source = 'wechat'`

### 3.3 游客升级流程

见 `ownership-and-sync-v1.md` §2。

### 3.4 Token 刷新

```text
POST /v1/auth/refresh
  { refresh_token }
    ↓
后端
  ├─ hash 查 auth_sessions
  ├─ 校验 status=active, expires_at > now
  ├─ 签发新 access_token（短期，2h）
  ├─ 滚动 refresh_token（可选，提高安全）
  └─ 返回新 tokens
```

### 3.5 登出

```text
POST /v1/auth/logout
  Header: Authorization: Bearer <access_token>
    ↓
后端
  ├─ 当前 session status = revoked
  └─ 204
```

### 3.6 被动撤销

支持场景：用户在另一设备修改密码（未来）/ 账号被风控 / 注销请求。

```text
后台触发
  ├─ 按 user_id 查 auth_sessions.active
  ├─ 全部 status = revoked
  └─ 写 audit_logs
```

## 4. 权益与订单

### 4.1 `user_entitlements`（权益表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → users.id |
| `entitlement_type` | varchar(32) | `membership / quota / feature` |
| `entitlement_key` | varchar(64) | `pro_membership / ai_review_quota / cloud_storage_100gb / premium_template_pack` |
| `status` | varchar(32) | `inactive / active / expired / consumed_out / revoked` |
| `start_at` | timestamptz | |
| `end_at` | timestamptz | |
| `quota_total` | int | 仅 quota 类 |
| `quota_used` | int | 仅 quota 类 |
| `source_order_id` | UUID | 溯源 |
| `metadata` | jsonb | |

### 4.2 `skus / orders / payment_transactions`

参考《BlinkLife iOS 账号体系实施方案》§6.7 - §6.9，DDL 按本规范术语（UUID v7 / Postgres）调整。首发仅 iOS IAP + 微信支付预埋。

### 4.3 状态机

**订单**：`created → pending_verification → paid / failed / closed / refunded`

**权益**：`inactive → active → expired / consumed_out / revoked`

### 4.4 业务读取规则

```text
# ❌ 禁止
if (user.isVip) { ... }

# ✅ 推荐
if (entitlement.check(user_id, "pro_membership")) { ... }
if (entitlement.consume(user_id, "ai_review_quota", 1)) { ... }
```

## 5. 客户端状态机

```text
┌─────────┐    首次启动    ┌──────────┐
│ initial │ ──────────────>│  guest   │
└─────────┘                │ guest_id │
                           └────┬─────┘
                                │ 登录成功
                                ↓
        ┌────── token 过期 ─────┤
        ↓                       ↓
 ┌─────────────┐          ┌─────────┐
 │ refreshing  │ <────────│ logged  │
 └──────┬──────┘  refresh │   in    │
        │                  └────┬────┘
        │ 刷新失败              │ 注销请求
        ↓                       ↓
 ┌─────────────┐          ┌──────────┐
 │ force_guest │          │ deleting │
 └─────────────┘          └────┬─────┘
                                │ 15 天宽限期内 cancel
                                ↓
                          回到 logged in
                                │ 宽限期后
                                ↓
                          ┌──────────┐
                          │  deleted │（不可回）
                          └──────────┘
```

### 5.1 跨端持久化对比

| 端 | guest_id | access_token | refresh_token | user cache |
|---|---|---|---|---|
| Android | SharedPreferences | flutter_secure_storage | flutter_secure_storage | SharedPreferences (JSON) |
| iOS | Keychain | Keychain | Keychain | UserDefaults |
| WatchOS | Keychain | Keychain | Keychain（主机同步） | - |
| Wear OS | EncryptedSharedPreferences | EncryptedSharedPreferences | EncryptedSharedPreferences | - |
| Web | IndexedDB（加密） | sessionStorage | HTTPOnly cookie | localStorage |
| Studio (Tauri) | OS Keychain | OS Keychain | OS Keychain | local JSON |

## 6. API 合约

### 6.1 认证

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/auth/apple` | POST | Apple 登录（首次注册 / 老用户回流） |
| `/v1/auth/wechat` | POST | 微信登录 |
| `/v1/auth/phone/sms` | POST | 手机号短信验证码（P2） |
| `/v1/auth/phone/verify` | POST | 手机号登录（P2） |
| `/v1/auth/refresh` | POST | Token 刷新 |
| `/v1/auth/logout` | POST | 当前设备登出 |
| `/v1/auth/revoke_all` | POST | 撤销所有设备 session |
| `/v1/auth/bind` | POST | 已登录用户绑定新身份 |
| `/v1/auth/unbind` | POST | 解绑身份（仅剩一个时拒绝） |

### 6.2 用户与设备

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/me` | GET | 获取主账号资料 + entitlement snapshot |
| `/v1/me` | PATCH | 更新资料 |
| `/v1/me/identities` | GET | 列出已绑定身份 |
| `/v1/me/devices` | GET | 列出登录设备 |
| `/v1/me/devices/:id` | DELETE | 移除某设备 session |

### 6.3 资产（与 Timeline 衔接，详见 `ownership-and-sync-v1.md`）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/account/claim` | POST | 游客升级：批量过户资产 |
| `/v1/recordings/sync` | POST | 上传录制（Timeline v2 文件） |
| `/v1/recordings` | GET | 列出云端录制 |

### 6.4 权益与支付

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/entitlements` | GET | 当前权益快照 |
| `/v1/orders` | POST | 创建订单 |
| `/v1/payments/verify` | POST | 校验 IAP 票据 |
| `/v1/payments/restore` | POST | 恢复购买 |

### 6.5 账号删除

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/account/delete/request` | POST | 发起删除（进入 15 天宽限期） |
| `/v1/account/delete/cancel` | POST | 宽限期内撤销 |
| `/v1/account/delete/status` | GET | 查看删除进度 |

### 6.6 统一响应格式

```json
{
  "code": 0,
  "message": "ok",
  "data": { /* 业务数据 */ },
  "trace_id": "..."
}
```

错误响应：`code != 0`，`data = null`。错误码规约另行维护。

## 7. 合规硬约束

### 7.1 Apple App Store（提审必过项）

| 条款 | 要求 | 本规范对应 |
|---|---|---|
| 4.8 Sign in with Apple | 若支持第三方登录，**必须同时**提供 Apple 登录 | §3.1 + 客户端登录页 |
| 5.1.1(v) 账号删除 | 必须提供 App 内删除入口 | §6.5 + §3.6 |
| 3.1.1 数字内容支付 | 订阅 / 解锁 / 虚拟货币**必须** IAP | §4 + `/v1/payments/*` |
| 5.1.1 数据收集透明 | App Privacy 申报与实际一致 | §8 审计字段清单 |

### 7.2 中国大陆合规

- 信息安全自评估：身份认证方式、会话管理、权限控制、审计日志、数据加密 → 本规范全覆盖
- 个人信息保护法：账号删除 / 数据导出 / 未成年人保护 → §5.5（账号删除）+ 未来补充

### 7.3 注销宽限期

- 用户发起删除 → `status=deleting`
- 15 天内可通过 `/v1/account/delete/cancel` 撤销
- 15 天后异步清理：资产删除（见 `ownership-and-sync-v1.md` §5）、匿名化 profile、撤销所有 session、`status=deleted`

## 8. 审计与风控

### 8.1 `audit_logs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | NULL（未登录事件） |
| `action` | varchar(64) | 动作代码 |
| `resource_type` | varchar(64) | 关联资源类型 |
| `resource_id` | varchar(64) | 关联资源 ID |
| `actor_device_id` | UUID | 设备 |
| `actor_ip` | varchar(64) | |
| `metadata` | jsonb | 动作相关元数据 |
| `created_at` | timestamptz | |

### 8.2 必记事件白名单

- `login_success` / `login_failed`
- `bind_identity` / `unbind_identity`
- `delete_account_request` / `delete_account_cancel` / `delete_account_completed`
- `purchase_verify_success` / `purchase_verify_failed`
- `restore_purchase`
- `logout` / `revoke_session`
- `session_anomaly`（多设备异常登录）
- `risk_flag`（风控标记）

### 8.3 保留期

- 登录 / 会话 / 设备事件：**180 天**
- 支付 / 订单 / 权益事件：**3 年**（对账 + 合规）
- 删除请求 / 风控事件：**永久**（匿名化后）

## 9. 迁移规划（从现状到目标）

### 9.1 现状

`blinklife-api/prisma/schema.prisma` 当前：

```prisma
model User {
  id          BigInt   @id @default(autoincrement())
  wxOpenid    String   @unique @map("wx_openid") ...
  wxUnionid   String?  ...
  nickname    String   @default("运动达人") ...
  ...
}
model RefreshToken { ... }
model CloudClip { userId BigInt ... }
model CloudRecording { userId BigInt ... }
```

**问题**：
1. `wxOpenid @unique` 直接挂在 User 表 → 第三方身份即账号主键
2. `id BigInt autoincrement` → 客户端不能预生成 ID
3. 无 `auth_identities / auth_sessions / user_devices / audit_logs`
4. `userId BigInt` 散落在各业务表

### 9.2 迁移目标

全部改为 UUID v7 + 多身份表分离，业务表挂 `owner_user_id UUID`。

### 9.3 六阶段迁移

**阶段 1：新增表结构（周 1）**
- 新建 `users_v2 / auth_identities / auth_sessions / user_devices / audit_logs / user_profiles / user_entitlements / orders / payment_transactions / skus`
- 老表（`users / refresh_tokens / cloud_clips / cloud_recordings`）不动
- 新表 `users_v2.id` UUID v7，`users_v2.legacy_id` = 老 `users.id`

**阶段 2：登录链路双写（周 2-3）**
- `/auth/wechat` 改造：老逻辑保留（写老 `users` + `refresh_tokens`）；同时写新表（`users_v2` + `auth_identities` + `auth_sessions` + `user_devices`）
- 保证回填：每个老 `users` 对应一个 `users_v2.id`（UUID v7），通过 `legacy_id` 关联

**阶段 3：回填脚本（周 3-4）**
- 扫描所有老 `users` 记录
- 为每条生成 `users_v2(id=uuid7(), legacy_id=old.id, status='active', register_source='wechat')`
- 生成 `user_profiles(user_id=new.id, nickname=old.nickname, avatar_url=old.avatar_url)`
- 生成 `auth_identities(user_id=new.id, provider='wechat', provider_user_id=old.wx_openid, union_key=old.wx_unionid)`
- 业务表 `cloud_clips / cloud_recordings` 加 `owner_user_id UUID` 字段，回填 = `users_v2.id WHERE legacy_id = cloud_clip.userId`
- 回填过程中写验证 SQL：`SELECT count(*) FROM users u LEFT JOIN users_v2 v2 ON v2.legacy_id = u.id WHERE v2.id IS NULL` 应 = 0

**阶段 4：切读（周 5-6）**
- 读路径切换：所有 API 基于 UUID `user_id`
- 资产查询 `WHERE owner_user_id = ?`，不再用 `WHERE user_id = ?`（老 BigInt）
- 期间老 BigInt `user_id` 字段保留（备查）

**阶段 5：关闭旧写（周 7）**
- 登录链路只写新表
- 老 `users / refresh_tokens` 停止写入（但不删除）
- 验证指标：老表 `updated_at` 无新增

**阶段 6：清理（周 8+）**
- 确认稳定运行 1 个月无问题
- 老 `users / refresh_tokens` 表改名 `_archived`，保留数据库中 3 个月
- 业务表删除 BigInt `user_id` 字段
- `users_v2` 改名 `users`

### 9.4 回滚判据

| 阶段 | 回滚触发条件 | 回滚动作 |
|---|---|---|
| 2 | 双写失败率 > 1% | 关双写，老逻辑继续 |
| 3 | 回填一致性校验 < 99.99% | 暂停切读，修脚本重跑 |
| 4 | 切读后 P0 接口错误率 > 0.5% | 读路径切回老表 |
| 5 | 关闭旧写后有异常数据 | 重开双写 |

### 9.5 客户端配合

- 客户端升级到支持 UUID `user_id` 字符串类型（v2 及以后）
- v1 客户端（BigInt 时代）通过 `legacy_id` 兼容查询一段时间
- 客户端本地缓存的 `user_info.id` 从 BigInt → UUID 字符串，需一次性数据迁移（app 启动时检测并刷新）

## 附录 A：参考资料

- 参考文档：`/Users/yangbo/Downloads/BlinkLife_iOS_账号体系实施方案_完整版.md`（原始输入）
- 现状 schema：`blinklife-api/prisma/schema.prisma`
- 现状认证：`blinklife-android/lib/services/auth_service.dart`
- 衔接协议：本目录 `ownership-and-sync-v1.md`
- 落地路线：本目录 `roadmap.md`
