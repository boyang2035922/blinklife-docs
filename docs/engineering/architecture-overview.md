---
title: 架构总览
sidebar_position: 1
description: "BlinkLife Flutter 客户端分层架构：screens → services/utils → models → SQLite/文件系统"
---

# 架构总览

> BlinkLife Flutter 客户端采用分层架构：screens（页面）→ services/utils（业务逻辑）→ models（数据）→ SQLite/文件系统（持久化），无第三方状态管理框架，核心使用 ChangeNotifier + ValueNotifier。

## 分层结构

```
┌─────────────────────────────────────────────────────┐
│                    screens/ (18个)                    │
│  页面层：持有状态、组合 widgets、调用 services        │
├─────────────────────────────────────────────────────┤
│                    widgets/ (29个)                    │
│  组件层：无业务逻辑的 UI 组件                        │
├──────────────────┬──────────────────────────────────┤
│  services/ (14个) │         utils/ (20个)            │
│  业务服务层       │         工具类                    │
│  DB/剪辑/同步     │         BLE/加密/格式化           │
├──────────────────┴──────────────────────────────────┤
│                    models/ (6个)                      │
│  数据模型：RecordingRecord / ClipRecord / ...         │
├─────────────────────────────────────────────────────┤
│          SQLite (sqflite)  +  文件系统 (.blink)       │
│          持久化层                                     │
└─────────────────────────────────────────────────────┘
```

## 核心模块关系

```
                    录制页 (recording_page)
                         │
                    ┌────┴────┐
                    │ 保存录制 │
                    └────┬────┘
                         │
                    ┌────▼────┐     ┌────────────────┐
                    │   DB    │────▶│  .blink 文件    │
                    │ SQLite  │     │ AES-256-CBC     │
                    └────┬────┘     └────────────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼────┐ ┌──▼───┐ ┌───▼────┐
         │ 回放页   │ │首页  │ │历史记录│
         │ review   │ │home  │ │history │
         └────┬────┘ └──────┘ └────────┘
              │
    ┌─────────┼─────────┐
    │         │         │
┌───▼───┐ ┌──▼───┐ ┌──▼──────┐
│时间轴 │ │事件  │ │剪辑任务 │
│3层绘制│ │列表  │ │TaskMgr  │
└───────┘ └──────┘ └────┬────┘
                        │
                   ┌────▼────┐
                   │ FFmpeg  │
                   │ 异步剪辑│
                   └────┬────┘
                        │
                   ┌────▼────┐
                   │剪辑列表 │
                   │批次详情 │
                   └─────────┘
```

## 状态管理策略

不使用 Provider/Riverpod/BLoC 等第三方方案。采用 Flutter 原生机制：

| 机制 | 用途 | 示例 |
|------|------|------|
| ChangeNotifier + addListener | 低频状态（页面数据、筛选） | PlaybackSession, ReviewDetailData |
| ValueNotifier + ValueListenableBuilder | 高频状态（播放位置 ~10Hz） | session.position |
| setState | 页面局部状态 | _isRecording, _isSaving |
| 全局单例 | 跨页面服务 | VideoClipTaskManager, FavoriteService |
| StreamSubscription | 系统事件（BLE、传感器） | BluetoothService, AccelerometerEvent |

详见 [状态管理](state-management)。

## 关键设计决策

### 为什么不用状态管理框架？

回放页通过双 Model 分层（PlaybackSession + ReviewDetailData）已解决最复杂页面的状态问题。引入 Provider/Riverpod 的 boilerplate 与当前项目规模不匹配。

### 为什么 FFmpeg 使用 executeAsync？

`execute` 是同步调用，会阻塞 UI 线程导致 ANR。`executeAsync` 通过 Completer 桥接为 Future，配合 VideoClipTaskManager 的 fire-and-forget 模式实现后台剪辑。

### 为什么视频保存优先用 rename？

File.rename 是原子操作（\<1ms），而后台 Isolate 拷贝可能需要数分钟。rename 仅在同一文件系统内有效，跨文件系统时回退到 Isolate 拷贝。

## 已知事实 / 合理假设 / 待确认项

| 类型 | 内容 |
|------|------|
| ✅ 已知 | 当前无第三方状态管理框架，使用 ChangeNotifier + ValueNotifier |
| ✅ 已知 | 数据库版本 v15，包含 9 个核心表 |
| 💡 假设 | 未来接入 AI 复盘时可能需要独立的 AI Service 层 |
| ❓ 待确认 | 是否计划引入 Provider 或 Riverpod 统一状态管理 |

## 相关文档

- [状态管理](state-management) — PlaybackSession/ReviewDetailData 双 Model 详解
- [数据库 Schema](database-schema) — v13 全表定义
- [时间轴模型](timeline-model) — 最复杂的组件子系统
- [Studio 桌面端](studio-architecture) — Tauri v2 桌面工具（共享 .blink 解密和 FFmpeg 管线）
- [右滑返回手势](swipe-back-gesture) — 全屏右滑跟手返回的三层防御体系
