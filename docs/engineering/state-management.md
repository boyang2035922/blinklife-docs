---
title: 状态管理
sidebar_position: 10
description: "PlaybackSession（高频播放状态）+ ReviewDetailData（低频页面数据）双 Model 分层"
---

# 状态管理

> 回放页的状态通过双 Model 分层：PlaybackSession 管理高频播放器状态，ReviewDetailData 管理低频页面数据。两者均继承 ChangeNotifier，position 额外使用 ValueNotifier 独立高频通知。

## 双 Model 分层

```
PlaybackSession (高频交互状态)
  ├── position: ValueNotifier<Duration>  ← ~10Hz，独立通知
  ├── isPlaying, isScrubbing            ← ChangeNotifier
  ├── driveSource                       ← 识别 seek 来源
  ├── selectedDotId / selectedClipId    ← 选中态
  └── mode: all / highlight             ← 时间轴模式

ReviewDetailData (低频数据状态)
  ├── dotRecords / dotCounts            ← 打点列表和统计
  ├── clipRecords                       ← 剪辑片段
  ├── videoDuration / startTime         ← 视频元数据
  ├── alignOffsetMs / recordType        ← 对齐信息
  └── filter: TimelineFilter            ← 筛选条件
```

### 为什么分两个 Model？

| 维度 | PlaybackSession | ReviewDetailData |
|------|----------------|-----------------|
| 更新频率 | ~10Hz（播放中） | 用户操作时（编辑/删除/筛选） |
| 驱动源 | 播放器回调/用户拖拽 | DB 加载/用户编辑 |
| 监听方 | TimelineProgressTrack, VideoPreviewCard | EventsCard, TimelineToolbar, StatsCard |
| 独立性 | 不依赖 Data | 不依赖 Session |

如果合并为一个 Model，position ~10Hz 更新会触发所有监听方重建（包括事件列表），造成严重性能问题。

## PlaybackDriveSource

```dart
enum PlaybackDriveSource {
  player,       // 播放器自然推进（不触发 UI 联动）
  scrubbing,    // 用户拖拽进度条
  eventTap,     // 点击事件卡片（前移 5s + 自动播放）
  markerTap,    // 点击时间轴 marker（前移 5s + 自动播放）
  clipTap,      // 点击片段区间
  seekExternal, // 外部 seek（上/下一条按钮）
}
```

作用：不同 source 有不同的 UI 联动规则，例如 eventTap 会自动播放，player 不会更新选中态。

## 监听模式

```dart
// 高频：ValueListenableBuilder（仅重绘 Painter）
ValueListenableBuilder<Duration>(
  valueListenable: session.position,
  builder: (_, pos, __) => CustomPaint(painter: _ProgressMarkerPainter(pos)),
)

// 低频：addListener（setState 或局部更新）
session.addListener(_onSessionChanged);
data.addListener(_onDataChanged);
```

## 全局单例服务

| 服务 | 模式 | 用途 |
|------|------|------|
| VideoClipTaskManager | 静态单例 | 跨页面剪辑任务管理 |
| FavoriteService | 静态单例 + ValueNotifier | 收藏缓存 + 变更通知 |
| BackgroundCopyService | 静态单例 | 后台视频拷贝 |
| AuthService | 静态单例 + Stream | 登录状态广播 |

## 相关文档

- [时间轴模型](timeline-model) — 高频 position 的消费方
- [架构总览](architecture-overview) — 整体状态管理策略
