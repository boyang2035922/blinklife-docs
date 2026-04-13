---
title: 剪辑任务与批次机制
sidebar_position: 5
description: "fire-and-forget 后台任务模式 + task_id 批次分组 + VideoClipTaskManager 全局单例"
---

# 剪辑任务与批次机制

> 剪辑采用 fire-and-forget 后台任务模式：用户触发剪辑后立即返回 taskId，VideoClipTaskManager 在后台异步执行 FFmpeg 剪辑，页面离开后任务继续运行。通过 task_id 将同一次剪辑产生的多个片段分组为"批次"。

## 任务状态机

```
pending → processing → completed
                    ↘ failed
```

## TaskId 生成规则

```
taskId = "{recordingId}_{timestamp}"
// 示例: "42_1712956800000"
```

## VideoClipTaskManager 核心流程

### submitTask()

```
调用方 submitTask(record, dotRecords, ...)
  │
  ├── 生成 taskId
  ├── 创建 ValueNotifier<ClipTaskProgress>(pending)
  ├── fire-and-forget: _executeTask()  ← 不 await
  └── 返回 taskId                     ← 立即返回
```

### _executeTask()

```
标记 processing
  │
  ├── VideoClipService.clipVideo(taskId: taskId, ...)
  │     ├── 计算片段时间范围 + 合并重叠
  │     ├── 逐段 FFmpeg 异步剪辑
  │     │     └── 每完成一段 → onSegmentComplete → 更新进度
  │     └── 插入 DB (task_id = taskId)
  │
  ├── 成功 → 缓存 results + 标记 completed
  └── 失败 → 标记 failed + 记录 error
  │
  └── 延迟 30 秒清理 → 释放内存
```

### 进度监听

```dart
ClipTaskProgress {
  ClipTaskStatus status;      // pending/processing/completed/failed
  int totalSegments;
  int completedSegments;
  String? error;
  double get fraction => completedSegments / totalSegments;
}
```

UI 侧通过 `taskManager.getProgress(taskId)?.addListener(...)` 驱动 AppBar 进度环。

## 批次分组架构

### 数据库层

```sql
SELECT task_id, COUNT(*), SUM(duration), ...
FROM clip_records WHERE recording_id = ?
GROUP BY task_id
```

历史数据（`task_id=null`）归入"历史剪辑"虚拟批次。

### 两层页面结构

```
ClipVideoListPage (一级：批次列表)
  │  按 task_id 分组
  └── ClipBatchDetailPage (二级：批次详情)
       某 taskId 下的所有片段 + 筛选/播放/合集生成
```

## 防重复提交

```dart
if (_activeClipTaskId != null) {
  CenterToast.showText('正在剪辑中，请等待完成');
  return;
}
```

## 覆盖旧剪辑

确认对话框 → `_deleteExistingClips()` 删除旧文件+DB → 提交新任务。

## 相关文档

- [FFmpeg 管线](ffmpeg-pipeline) — 底层剪辑命令
- [回放流程](../product/playback-flow) — 剪辑的触发入口
