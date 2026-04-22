---
title: 身份 / 设备 / 外设底座规范 v2
sidebar_position: 2
description: "User / Installation / Device / Session / Peripheral / Push 六层 ID 拆分 + 对外 UUIDv7 + user_no 短码 + API 合约"
---

# 身份 / 设备 / 外设底座规范 v2

> 本文档是 BlinkLife 身份体系 v2 的合约权威源。**覆盖并修订** `account-system-v1.md` 中关于主账号、设备、会话、JWT 的约定，并新增安装实例 / 外设 / 推送 / 审计归因底座。
>
> 其他既存权威源（`timeline-v2.md` / `ownership-and-sync-v1.md`）保持不变，仅在字段层面复用本文约定的公共 ID（`user_id` / `installation_id` / `device_id` / `hardware_id`）。

:::info 实施状态（2026-04-22）

- **Phase 1（用户公共 ID 与短码）**：后端 migration / schema / API 切换已落地；`users.user_no` 由服务端生成，对外只返回 `user_id`+`user_no`，不再返回内部 BigInt `user.id`。
- **Phase 2-6**：按 roadmap 推进，详见 §8。

:::

## 0. 为什么需要 v2

v1 的账号体系为首发跑通了"人"这一层，但仍有三个断点：

1. 对外仍暴露数字型用户 ID（登录响应 / 本地缓存 / 日志里都是 BigInt 字符串），违反客服安全与跨端一致性目标。
2. 没有安装实例概念，反馈、崩溃、归因、匿名同步这些"未登录也要能做事"的链路无法被稳定标识。
3. 没有外设实体，BLE 指环 / 遥控器 / Apple Watch / Wear 手表只能依赖本地弱标识，售后排查、跨设备迁移、固件统计无地基。

v2 不再试图让一个 ID 承担全部语义。它把身份边界拆成六层，每层各自有对外公共 UUID 或短码；并保留内部 BigInt 主键不变，只在外部守住"公共 ID 只能是 UUIDv7 或 `user_no`"。

## 1. ID 分层与契约

| 层 | 对外字段 | 内部字段 | 生成方 | 生命周期 |
|----|----------|----------|--------|----------|
| 用户 | `user_id`（UUIDv7） | `users.uuid_id` | 服务端 | 与账号共存亡 |
| 用户短码 | `user_no`（`BLU-XXXXXX`） | `users.user_no` | 服务端 | 与账号共存亡 |
| 安装实例 | `installation_id`（UUIDv7） | `app_installations.installation_uuid` | 客户端 | 卸载重装会变 |
| 登录设备 | `device_id`（UUIDv7） | `user_devices.device_uuid` | 服务端 | 账号登出后可复用 |
| 会话 | `session_id`（UUIDv7） | `auth_sessions.session_uuid` | 服务端 | 登出 / refresh 后撤销 |
| 外设 | `hardware_id`（UUIDv7） | `hardware_peripherals.hardware_uuid` | 服务端 | 可跨账号转移 |
| 外设绑定 | `binding_id`（UUIDv7） | `hardware_bindings.binding_uuid` | 服务端 | 解绑后保留历史 |
| 推送 | `push_token_id`（UUIDv7） | `device_push_tokens.push_token_uuid` | 服务端 | 与 token 生命周期一致 |

### 1.1 JWT payload

```json
{
  "sub": "<internal BigInt 字符串>",
  "uid": "<users.uuid_id>",
  "sid": "<auth_sessions.session_uuid, Phase 3 起>",
  "openid": "<微信 openid 或 apple_{sub}>",
  "aud": "blinklife"
}
```

- `sub` 内部用，保持与 v1 兼容以减少服务层改动。
- `uid` 自 Phase 1 起注入；业务接口逐步改用 `uid` 定位用户。
- `sid` Phase 3 起注入；`JwtStrategy` 校验 session active。

### 1.2 HTTP header 约定

| Header | 说明 |
|--------|------|
| `X-Blink-Installation-Id` | 客户端 `InstallationIdService` 生成的 UUIDv7（Phase 2+ 必带） |
| `X-Blink-App-Code` | `blinklife_ios` / `blinklife_android` / `blinklife_studio` / `blinklife_web` |
| `X-Blink-Platform` | `ios` / `android` / `macos` / `windows` / `web` |
| `X-Request-Id` | 可选；服务端缺失时生成并写入 `audit_logs.request_id` |

### 1.3 领域边界不重叠

| ID | 语义 | 允许替代 |
|----|------|----------|
| `guest_id` | Timeline 本地游客所有权 | 否 |
| `feedback_install_id`（=`anonymous_install_id`） | 反馈匿名身份与同设备历史追溯 | 否 |
| `installation_id` | App 安装实例 | 否 |
| `device_id` | 用户可管理的登录终端 | 否 |
| `hardware_id` | 外设实体 | 否 |

## 2. 数据模型

### 2.1 `users`

在 v1 基础上新增 `user_no`：

```prisma
model User {
  id     BigInt  @id @default(autoincrement())
  uuidId String  @unique @map("uuid_id") @db.Uuid         // Phase 1b 后 NOT NULL
  userNo String  @unique @map("user_no") @db.VarChar(16)  // Phase 1b 后 NOT NULL
  // ... 其余字段见 account-system-v1.md
}
```

`user_no` 格式：`BLU-` + 6 位 Crockford Base32（去 `0 1 I L O U`）。服务端 `UserNoService.generate()` 唯一冲突重试 10 次；partial unique index 兜底。

### 2.2 `app_installations`（Phase 2 新增）

详见 [2.1 节第二张表]。略。

### 2.3 `user_devices` 扩展（Phase 3）

新增 `device_uuid / installation_id / platform / build_number / install_channel / locale / timezone`，`(user_id, installation_id)` 作为 upsert 键。

### 2.4 `auth_sessions` 扩展（Phase 3）

新增 `session_uuid / installation_id`。`JwtStrategy` 校验 `status='active'` + `expires_at > now`。

### 2.5 `hardware_peripherals` / `hardware_bindings`（Phase 5）

外设本体与绑定关系分离：
- 外设识别码（BLE MAC / HID VID+PID / Watch nodeId）经服务端 HMAC-SHA256 存 `identifier_hash`，原始值不落库。
- `hardware_bindings` 保证"同一硬件同时只能一条 `status='bound'`"（partial unique index 兜底）；转让走显式 unbound → bound。
- `hardware_bindings.owner_user_id + status` 上建普通 index 供列表接口。
- `HMAC` 密钥来自 `PERIPHERAL_HASH_KEY` env，要求 **base64 编码、解码后 ≥ 32 字节**；非法值时服务启动 warn、外设/推送接口调用抛 500（其他业务不受影响）。推荐 `openssl rand -base64 48` 生成。
- 打点路径：`DotRecord.hardwareId` 随 `.blink v3 event.payload.hardware_id` 落盘；云同步时由 `RecordingSyncService.mergeSourceHardwareIds` 去重聚合为 `cloud_recordings.source_hardware_ids[]`。
- `AuthService.upsertUserDevice` 登录成功时会把"本 installation 下匿名注册的 push token"归属刷给当前 user + device（`userId=null → userId=uid`），保证 `AccountService.requestDelete` 按 userId 级联能覆盖匿名先注册、登录后未重调 register 的 token。

### 2.6 `device_push_tokens`（Phase 6）

Push token 独立于 `user_devices`：

- `(provider, token_hash)` 全局唯一，token 原文仅内存短暂存在；`token_hash = HMAC('push:<provider>', raw)`，落库只存 hash + 可选 `token_ciphertext`。
- `installation_id` NOT NULL（CASCADE），允许 `user_id` 为 null（未登录也可注册）。
- 登出设备 / 用户注销 / 账号切换时置 `status='revoked'`，保留审计。
- `AccountCleanupTask` cron 物理清理 user 前先 revoke 所有 `userId` 名下 token，避免 FK SetNull 产生 user_id=null 的僵尸 token 继续收推送。

## 3. API 合约（摘要）

### 3.1 登录响应（Phase 1 已落地）

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "user": {
    "user_id": "0196f6ea-3c2f-7c6f-8f1a-9d4c1f18b001",
    "user_no": "BLU-7F4K9P",
    "nickname": "运动达人",
    "avatar_url": null,
    "created_at": "2026-04-22T00:00:00.000Z"
  }
}
```

- `user.id`（内部 BigInt 字符串）**已移除**。客户端只读 `user_id` / `user_no`。
- Phase 3 起响应新增 `session_id` 与 `current_device.device_id / installation_id`。

### 3.2 `/user/profile`

```json
{
  "user_id": "...",
  "user_no": "BLU-7F4K9P",
  "nickname": "...",
  "avatar_url": null,
  "phone": null,
  "created_at": "..."
}
```

### 3.3 Phase 2+ 新增接口

- `POST /api/v1/installations/bootstrap`
- Phase 3：`DELETE /api/v1/user/devices/:device_id`（公共 UUID 参数）
- Phase 5：`POST /api/v1/peripherals/bind` / `GET /peripherals` / `POST /peripherals/:hardware_id/unbind` / `POST /peripherals/:hardware_id/heartbeat`
- Phase 6：`POST /api/v1/push-tokens/register|unregister`

### 3.4 外设绑定接口（Phase 5）

#### `POST /api/v1/peripherals/bind`

请求体（`identifier_raw` 仅本次请求内存中存在，不落库）：

```json
{
  "hardware_type": "ble_ring",
  "identifier_kind": "ble_mac",
  "identifier_raw": "AA:BB:CC:DD:EE:FF",
  "brand": "BlinkRing",
  "model": "R1",
  "firmware_version": "1.2.3",
  "confidence_level": "medium",
  "mapping_profile_id": "default"
}
```

响应：

```json
{
  "binding_id": "0196f6ea-3c2f-7c6f-8f1a-9d4c1f18b200",
  "hardware_id": "0196f6ea-3c2f-7c6f-8f1a-9d4c1f18b100",
  "hardware_type": "ble_ring",
  "brand": "BlinkRing",
  "model": "R1",
  "firmware_version": "1.2.3",
  "confidence_level": "medium",
  "mapping_profile_id": "default",
  "status": "bound",
  "bound_at": "2026-04-22T10:00:00.000Z",
  "last_seen_at": "2026-04-22T10:00:00.000Z",
  "mode": "created"
}
```

幂等：同一 identifier_hash 的硬件被当前账号重复绑定返回 `mode: "existing"`；被他人占用返回 `409 { code: "peripheral_bound_to_other_user" }`。

#### `POST /api/v1/peripherals/:hardware_id/unbind`

语义幂等：

- 外设不存在 → `404`（输入错误）；
- 外设存在但无 active binding → `200 { success: true, binding_id: null, already_unbound: true }`；
- 正常解绑 → `200 { success: true, binding_id: "...", already_unbound: false }`。

### 3.5 推送接口（Phase 6）

#### `POST /api/v1/push-tokens/register`

- Guard：`OptionalJwtAuthGuard`。未带 token 允许匿名注册；带了但非法（过期/签名错/aud 不符/session 撤销/用户被封禁）照常 401。
- 请求体：`{ provider: "apns|fcm|jpush|umeng|huawei|xiaomi|oppo|vivo", token_raw: "..." }`
- 响应：`{ push_token_id, status, created_at, mode: "created"|"existing" }`
- 写审计：当 `mode=existing` 且发生"换账号"或"从 revoked reactivate"时，写 `audit_logs.action='push_token_reactivated'` + `metadata.previous_user_id / next_user_id / previous_status`。

#### `POST /api/v1/push-tokens/unregister`

- Guard：`OptionalJwtAuthGuard`。未登录也能按 `push_token_id` 或 `(provider, token_raw)` 注销（两个定位键只有本人持有）。
- 请求体（二选一）：
  - `{ push_token_id: "uuid" }`
  - `{ provider: "...", token_raw: "..." }`
- 响应：`{ success: true, push_token_id, already_revoked }`，不存在 / 已 revoked 均返回 200。

## 4. 客户端约定

- `lib/models/user_model.dart`：对外字段 `userId` / `userNo`；解析失败时清理本地 token 要求重新登录。
- `lib/utils/recording_identity.dart::forNew/forUpdate`：`ownerUserId` 写 `user.userId`（UUID），与服务端 `cloud_recordings.owner_user_uuid` 对齐。
- Phase 2 新增 `lib/services/installation_id_service.dart` 与 `device_context_service.dart`；`api_service.dart` dio 拦截器统一注入 v2 header。
- 本地 SQLite v22（Phase 4）新增 `recording_records.owner_user_uuid / installation_id / device_id / source_hardware_ids` 字段。

## 5. 安全与隐私

- 禁止采集 IMEI / IMSI / SSAID / IDFA / IDFV 作为身份。
- push token / openid / Apple sub / BLE MAC / HID identifier 仅允许以 hash 形式落库；日志禁打印原文。
- `user_no` 不具备鉴权语义，只做客服检索。

## 6. 审计

所有关键动作写 `audit_logs`，`resource_id` 使用公共 UUID：

- `login_success` / `login_failed` / `refresh_token`
- `logout_current_session` / `logout_device`
- `bind_identity` / `unbind_identity`
- `bind_hardware` / `unbind_hardware` / `transfer_hardware`
- `delete_account_request` / `cancel` / `completed`
- `claim_asset`

Phase 6 起 `audit_logs` 增 `actor_installation_id` 与 `request_id`。

## 7. 迁移与回填

### Phase 1（已落地）

| 步骤 | 文件 |
|------|------|
| 加字段 | `prisma/migrations/identity_foundation_v2_001_user_public_ids.sql` |
| 回填 | `scripts/backfill-identity-public-ids.mjs` |
| 加 NOT NULL | `prisma/migrations/identity_foundation_v2_001b_user_public_ids_notnull.sql` |

### Phase 2-6

| Phase | migration 文件前缀 |
|-------|-------------------|
| 2 | `identity_foundation_v2_002_app_installations.sql` |
| 3 | `identity_foundation_v2_003_devices_sessions.sql` + `_003b_uuid_notnull.sql` |
| 4 | `identity_foundation_v2_006_recording_source.sql` |
| 5 | `identity_foundation_v2_005_hardware.sql` |
| 6 | `identity_foundation_v2_004_device_push_tokens.sql` + `_007_feedback_installation.sql` + `_008_audit_installation.sql` |

所有 migration 使用 `ADD COLUMN IF NOT EXISTS` + `DO $$` 外键守卫，保证幂等。

## 8. Roadmap 锚点

与 `roadmap.md` 的对齐：

- Phase 1：对外字段无 BigInt。
- Phase 2：所有请求带 `installation_id`。
- Phase 3：`user_devices` upsert + JWT `sid` 校验。
- Phase 4：云同步按 `file_uuid` 幂等。
- Phase 5：外设绑定闭环。
- Phase 6：推送 token + 审计归因 + 后台检索。

## 9. 风险与取舍

- 内部 BigInt 主键短中期不换。Prisma relation、JWT、业务代码对 BigInt 的依赖量过大；边界只管对外。
- `installation_id` 表示安装实例，不表示物理设备。卸载重装、换机、系统清数据都会变化，这是设计意图。
- 外设弱指纹（HID vid+pid+name）置 `confidence_level='medium'`；自研硬件后续在固件层提供序列号 / 证书后升级为 `high`。
- `anonymous_install_id`（反馈领域）保留，不合并到 `installation_id`。
