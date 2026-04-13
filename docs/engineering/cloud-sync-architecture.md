---
title: 云同步架构
sidebar_position: 9
description: "微信登录 + JWT 认证 + 单向打点数据同步 + 游客数据 claim"
---

# 云同步架构

> BlinkLife 采用可选登录策略：数据默认本地存储，用户通过微信登录后可将打点数据同步到云端。同步为单向（客户端→服务端），服务端存储 JSON 原文。

## 认证流程

```
Flutter (fluwx)
  → 拉起微信授权 → 获取 code
  → POST /api/v1/auth/wechat {code}
  → 后端：code → 微信 OAuth → upsert 用户 → 签发 JWT
  → 返回 access_token (15min) + refresh_token (30d)
  → flutter_secure_storage 加密存储
```

### Token 刷新

API 请求 401 → `POST /api/v1/auth/refresh` → 新 token → 重试原请求。

### 游客数据 Claim

```sql
-- 登录成功后
UPDATE recording_records SET user_id = ? WHERE user_id IS NULL;
UPDATE clip_records SET user_id = ? WHERE user_id IS NULL;
```

## 同步触发时机

| 时机 | 方法 |
|------|------|
| 录制结束 | RecordingSyncService.syncRecording() |
| 登录成功 | 批量同步所有未同步记录 |
| 打点编辑/删除 | markNeedsSync() → 下次触发时同步 |

## 同步流程

```
syncRecording(record)
  │
  ├── 读取 .blink → 解密 → JSON
  ├── 构造 payload
  ├── 已有 cloud_id? → PUT (update) / POST (create)
  │    ├── 成功 → markSynced(cloud_id)
  │    └── 失败 → 保持 syncStatus=0
  └── 并发保护: 同一 recordingId 同时只有一个同步任务
```

## 后端 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/v1/auth/wechat | POST | 微信登录 |
| /api/v1/auth/refresh | POST | 刷新 token |
| /api/v1/user/profile | GET/PUT | 用户资料 |
| /api/v1/recordings/sync | POST | 批量同步 (upsert) |
| /api/v1/recordings | GET | 云端列表 (分页) |
| /api/v1/recordings/:id | GET/DELETE | 单条操作 |

## 已知事实 / 合理假设 / 待确认项

| 类型 | 内容 |
|------|------|
| ✅ 已知 | 同步为单向客户端→服务端 |
| ✅ 已知 | readFileSync 解密失败不中断整个同步批次 |
| 💡 假设 | 未来可能需要双向同步（多设备场景） |
| ❓ 待确认 | 视频文件是否需要上传到云存储 |

## 相关文档

- [API 端点](../data/api-endpoints) — 完整端点文档
- [数据库 Schema](database-schema) — cloud_id 和 sync_status 字段
