---
title: API 端点
sidebar_position: 3
description: "BlinkLife 后端 NestJS REST API 端点一览：认证、用户、录制同步"
---

# API 端点

> BlinkLife 后端 (NestJS) 部署在 `api.blink-life.cn`，通过 nginx 反代 + HTTPS。

## 基础信息

| 属性 | 值 |
|------|------|
| 基础 URL | `https://api.blink-life.cn/api/v1` |
| 认证方式 | Bearer JWT (access_token) |
| 服务器 | 腾讯云 CVM 140.143.187.247:3000 |
| 进程管理 | PM2 |

## 认证

### POST /auth/wechat

微信登录。

**请求体：**
```json
{ "code": "微信授权码" }
```

**响应：**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "...", "nickname": "...", "avatarUrl": "..." }
}
```

### POST /auth/refresh

刷新 token。

**请求体：**
```json
{ "refresh_token": "eyJ..." }
```

**响应：** 同 /auth/wechat

## 用户

### GET /user/profile

获取当前用户信息。需认证。

### PUT /user/profile

更新用户资料。需认证。

**请求体：**
```json
{ "nickname": "新昵称", "avatarUrl": "https://..." }
```

## 录制同步

### POST /recordings/sync

批量同步打点记录（upsert）。需认证。

**请求体：**
```json
{
  "recordings": [
    {
      "localId": 42,
      "sportType": "足球",
      "duration": 5400000,
      "totalDots": 16,
      "dots": "{...json...}",
      "recordingStartTime": "2026-04-13T10:00:00Z"
    }
  ]
}
```

### GET /recordings

获取云端录制列表（分页）。需认证。

**查询参数：** `page`, `limit`

### GET /recordings/:id

获取单条记录详情（含打点 JSON）。需认证。

### DELETE /recordings/:id

删除云端记录。需认证。

## 已知事实 / 待确认项

| 类型 | 内容 |
|------|------|
| ✅ 已知 | access_token 有效期 15min，refresh_token 30d |
| ✅ 已知 | 当前只同步打点 JSON，不上传视频文件 |
| ❓ 待确认 | 是否需要视频文件上传到云存储（COS） |

## 相关文档

- [云同步架构](../engineering/cloud-sync-architecture) — 客户端同步逻辑
