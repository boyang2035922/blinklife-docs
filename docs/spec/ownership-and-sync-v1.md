---
title: 账号 ↔ Timeline 衔接协议 v1
sidebar_position: 4
description: "主账号与 Timeline 数据的归属模型、游客升级协议、云端同步、冲突解决、删号清理"
---

# 账号 ↔ Timeline 衔接协议 v1

> 本文档解决两个规范的边界问题：`.blink` 文件的归属字段如何填、游客数据如何升级为主账号资产、多设备如何同步、冲突如何解决、删号时 Timeline 数据如何处置。
>
> 本规范同时约束 `account-system-v1.md`（Identity / Asset 层）与 `timeline-v2.md`（文件格式 / Event 幂等）。

## 0. 目的与边界

**本规范**：
- 定义 `.blink` 文件 `owner` 字段的写入规则
- 定义游客 → 登录的资产 claim 协议
- 定义云端增量同步协议
- 定义多设备冲突解决策略
- 定义删号时 Timeline 数据的处置顺序

**不在本规范**：
- .blink 文件内部 schema（见 `timeline-v2.md`）
- users / auth_identities 等账号表（见 `account-system-v1.md`）
- 视频文件 OSS 存储结构（另行维护）

## 1. 所有权模型

### 1.1 `.blink v3` 的 `owner` 字段

```json
"owner": {
  "user_id": "01926f09-...",       // 已登录状态下填，UUID v7
  "guest_id": "01926f08-..."       // 游客状态下填，UUID v7
}
```

**规则**：
- 二选一，**禁止同时非空**
- 已登录用户创建的文件：`user_id` 非空，`guest_id = null`
- 游客创建的文件：`guest_id` 非空，`user_id = null`
- 游客升级登录后：文件被重写为 `user_id` 非空 + `guest_id = null`（见 §2）

### 1.2 云端 `cloud_recording` 表

| 字段 | 说明 |
|---|---|
| `id` | UUID，服务端生成 |
| `file_uuid` | 对应 `.blink` 文件的 `file_uuid`（用于跨端去重） |
| `owner_user_id` | UUID，FK → users.id；云端**不存游客数据** |
| `created_at` / `updated_at` | |
| `is_deleted` / `deleted_at` | 软删除 |
| `spec_version` | Timeline spec 版本 |
| `blob_storage_key` | OSS / COS 对象键 |

**约束**：云端**不保存游客数据**。游客 `.blink` 仅存在于本地设备。

### 1.3 多设备所有权扩展（P3 预埋）

```json
"owner": {
  "user_id": "...",
  "contributors": [
    { "user_id": "...", "role": "videographer", "joined_at": "..." },
    { "user_id": "...", "role": "coach",        "joined_at": "..." }
  ]
}
```

首发**不启用** `contributors`，字段仅预埋，客户端读到时忽略。协作采集语义待 P3 规范冻结。

## 2. 游客升级资产迁移

### 2.1 协议时序

```text
游客 App
  ├─ 本地已有 N 个 .blink 文件，每个 owner.guest_id = G
  ├─ 用户点击登录（Apple / WeChat）
  ├─ /v1/auth/* 返回 user_id = U
  ├─ 客户端扫描本地所有 guest_id = G 的文件，生成清单
  │   claim_manifest = [
  │     { file_uuid, sport_type, created_at, size_bytes }, ...
  │   ]
  └─ POST /v1/account/claim
         { guest_id: G, claim_manifest }
           ↓
服务端
  ├─ 验证 auth（user_id = U）
  ├─ 对每个 file_uuid：
  │    ├─ 若云端已存在（跨设备）→ 对比 updated_at，newer wins
  │    ├─ 若不存在 → 创建 cloud_recording(owner_user_id=U, file_uuid=...)
  │    └─ 记 audit_logs(action='claim_asset', resource_id=file_uuid)
  ├─ 返回 claim_result = [{ file_uuid, status: 'claimed'/'skipped'/'conflict' }]
           ↓
客户端
  ├─ 对每个 'claimed' 文件：
  │    ├─ 重写 .blink（owner.guest_id=null, owner.user_id=U）
  │    ├─ 保持 file_uuid 不变（幂等）
  │    └─ 本地 SQLite recording_records.user_id = U
  ├─ 对每个 'conflict' 文件：
  │    └─ UI 提示用户选择保留本地还是云端
  └─ 触发一轮 /v1/recordings/sync 上传新 claimed 文件
```

### 2.2 幂等性保证

- `claim` 操作以 `file_uuid` 为键，重复调用返回相同结果
- 客户端失败重试安全（网络中断后可再发一次）
- 服务端通过 `audit_logs(action='claim_asset', resource_id=file_uuid)` 防重

### 2.3 部分失败处理

- 客户端本地必须实现"单文件级"迁移事务
- 某文件 claim 失败 → 本地保留 `guest_id`，下次同步再试
- 全部失败 → 登录状态仍成立，数据保持游客态，不阻塞登录

### 2.4 guest_id 管理

- 客户端首次启动生成一个 `guest_id`（UUID v7），本地持久化
- 同一设备的所有游客数据共享一个 `guest_id`
- 清除数据 → 生成新 `guest_id`（视为不同游客）
- 服务端**不存** `guest_id` 表；仅在 audit_logs 留痕（可追溯但不索引）

## 3. 云端同步协议

### 3.1 增量同步请求

```text
POST /v1/recordings/sync
  {
    since_cursor: "2026-04-17T10:00:00.000Z",   // 上次同步时间戳
    updated_files: [                              // 本地新增/修改
      {
        file_uuid: "...",
        spec_version: "timeline/v2.0",
        updated_at: "...",
        blob: <base64 encoded .blink>
      }
    ],
    tombstones: [                                 // 本地已删除
      { file_uuid: "...", deleted_at: "..." }
    ]
  }
```

### 3.2 增量同步响应

```text
{
  new_cursor: "2026-04-17T11:00:00.000Z",
  server_updates: [                               // 服务端新增/修改（其他设备产生）
    { file_uuid: "...", blob: <base64>, updated_at: "..." }
  ],
  server_tombstones: [
    { file_uuid: "...", deleted_at: "..." }
  ],
  conflicts: [                                    // 需客户端决策
    { file_uuid: "...", local_updated_at: "...", server_updated_at: "..." }
  ]
}
```

### 3.3 冲突解决策略

**文件级冲突**（两端同时修改同一 `file_uuid`）：
1. 默认 **last-writer-wins by `updated_at`**
2. 但在同 file 内部，**Event 级**冲突按 §3.4 解决（不是整文件覆盖）

**Event 级冲突**（同一 `event_uuid` 在两端不同）：
1. 先按 `t_rel_ms` + `source_priority` 判断
2. `source_priority`：`manual / screen_tap / ble_ring > sensor / ai_derived`
3. 同级别 last-writer-wins（按 Event 级 `updated_at`，需 SDK 在每条 Event 加 `updated_at` 隐式字段）

**删除冲突**：
- 一端删除、另一端修改 → 按操作时间戳：删晚了 = 保留修改
- 需 SDK 在 tombstone 中带 `deleted_at`

### 3.4 Event 级合并

当两份 `.blink v3` 文件需合并（协作采集 P3 / 同一文件被两端同时编辑）：

```text
merge(file_a, file_b) → file_merged:
  1. 所有 Track 并集（按 track.id，冲突时 schema_version 高者胜）
  2. 所有 Event 按 event_uuid 去重
  3. 同 event_uuid 冲突 → 按 §3.3 Event 级规则
  4. events[] 重新按 t_rel_ms 排序
  5. legacy.* 镜像基于合并后 action 轨道重新计算
  6. file_uuid 保持不变
  7. meta.merged_from = [file_a.meta.created_by, file_b.meta.created_by]
```

### 3.5 软删除保留期

- 云端 `cloud_recording.is_deleted = true, deleted_at = now` → 保留 **30 天**
- 30 天后 cron 物理删除（含 OSS 对象）
- 宽限期内用户可 `/v1/recordings/:id/restore` 恢复

## 4. 加密权衡

### 4.1 四象限选型

|  | 本地加密 | 本地明文 |
|---|---|---|
| **云端服务端可读** | 当前推荐（本地 BlinkCrypto + HTTPS + 服务端解密存 OSS） | 不推荐（本地反而暴露） |
| **云端端到端加密** | Pro 付费特性（P2 再议） | 不可能 |

### 4.2 现状分析

当前 `BlinkCrypto` 是 **对称密钥硬编码在客户端**，语义是"非 BlinkLife 客户端不可读"，**不是真正的端到端加密**。

### 4.3 首发策略

- 本地：维持 `BlinkCrypto` 加密（避免同屏软件直读）
- 传输：HTTPS + JWT 鉴权
- 云端：**服务端可读**，便于 AI 复盘 / 搜索 / 聚合
- OSS 对象：服务端侧再做一层 Server-Side Encryption（SSE）

### 4.4 Pro 端到端加密（P2）

未来 Pro 会员可选"端到端加密"：
- 密钥由用户密码派生，服务端不持有
- 代价：服务端无法做 AI 复盘 / 搜索 / 聚合
- 触发权益：`entitlement.e2e_encryption`

## 5. 删号时 Timeline 处理

### 5.1 宽限期内（`status=deleting`）

- Timeline 数据**标记为 pending_delete**，不物理删除
- 用户可 `/v1/account/delete/cancel` 撤销，数据完全恢复
- 云端聚合查询过滤 `pending_delete`
- 客户端同步不拉取 pending_delete 数据

### 5.2 宽限期后（`status=deleted`）

物理删除**按以下顺序**执行（依赖关系倒序）：

```text
1. 停止接受该用户的新 API 请求
2. 撤销所有 auth_sessions
3. 删除 cloud_clips（含 OSS 对象）
4. 删除 cloud_recordings（含 OSS 的 .blink + 视频对象）
5. 删除 user_entitlements（未到期订阅按 Apple 规则单独取消）
6. 匿名化 user_profiles（保留 user_id，清除 nickname / avatar_url）
7. 删除 user_devices
8. 保留 audit_logs（合规要求，3 年）
9. users.status = 'deleted', deleted_at = now
```

### 5.3 本地数据清理

- 客户端收到 `delete_account_completed` 事件 → 主动擦除本地 SQLite 记录 + `.blink` 文件 + secure storage token
- 客户端升级为游客态（生成新 `guest_id`）

### 5.4 合规要求

- Apple 审核关注：App 内入口必须真实可达（见 `account-system-v1.md` §7.1）
- 信息安全：审计日志保留 3 年（匿名化后）
- PIPL：删除完成后 30 天内响应用户数据导出请求能力（未来补）

## 6. 协作采集所有权（P3 预埋）

### 6.1 场景

一场比赛，一名球员打点、家长拍视频、教练事后批注、队友补充。四份 Timeline 数据需融合为一份。

### 6.2 数据模型预埋

`.blink v3` 的 `owner.contributors[]` 字段预埋（见 §1.3），首发不启用。

### 6.3 首发限制

- 单个 `.blink` 文件只能有一个 `owner.user_id`
- 跨用户数据共享通过"分享链接"（只读）实现，不跨 owner
- 多用户协作融合 → P3 规范冻结

## 附录 A：协议速查

| 场景 | 端点 |
|---|---|
| 游客升级 | `POST /v1/account/claim` |
| 上传录制 | `POST /v1/recordings/sync` |
| 拉取云端 | `GET /v1/recordings?since_cursor=...` |
| 删除单条 | `DELETE /v1/recordings/:id` |
| 恢复单条 | `POST /v1/recordings/:id/restore` |
| 注销账号 | `POST /v1/account/delete/request` |

## 附录 B：参考实现路径

- 现状云同步：`blinklife-android/lib/services/recording_sync_service.dart`
- 现状本地删除：`blinklife-android/lib/services/database_service.dart`
- 现状加密：`blinklife-android/lib/utils/blink_crypto.dart`
