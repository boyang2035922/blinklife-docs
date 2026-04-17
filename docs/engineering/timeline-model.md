---
title: 时间轴模型
sidebar_position: 2
description: "三层 CustomPainter 绘制（片段/进度打点/Thumb）+ 磁吸算法 + 双 Model 状态分层"
---

# 时间轴模型

:::info 本文档描述 UI 渲染实现（v1）
Timeline 的**数据合约**定义在 [`spec/timeline-v2.md`](../spec/timeline-v2.md)（Tracks + Events 双层模型）。本文档描述的是回放页上游的**渲染层**——三层 CustomPainter 架构在 v2 下继续生效，仅上游数据源从 v1 `DotRecord[]` 切换为 v2 `Event[]`（兼容映射见 v2 §6.3）。
:::

> 时间轴是 BlinkLife 回放页的核心可视化组件，采用三层 CustomPainter 架构绘制剪辑片段、进度打点和拖拽手柄，支持磁吸吸附和触觉反馈。

## 组件树

```
TimelineHub (容器)
  ├── 模式切换 Chip (全部 ↔ 仅高光) + 打点数
  └── TimelineProgressTrack (三层绘制)
       ├── Layer 1: _ClipSegmentsPainter    ← 剪辑片段区间色块
       ├── Layer 2: _ProgressMarkerPainter  ← 进度条 + 打点 marker
       └── Layer 3: Thumb + 拖拽浮层        ← 白色圆形手柄

TimelineToolbar (筛选栏，独立组件)
  └── 动作类型 FilterChip 列表 (仅 actionTypes > 1 时显示)
```

## 三层绘制架构

### Layer 1: 剪辑片段层 (_ClipSegmentsPainter)

| 参数 | 类型 | 说明 |
|------|------|------|
| clips | `List<ClipRecord>` | 剪辑片段列表 |
| totalDurationMs | int | 视频总时长（毫秒） |
| currentPositionMs | int | 当前播放位置 |
| selectedClipId | int? | 选中的片段 ID |

绘制逻辑：将 clip 的 startTime/endTime 映射到轨道宽度，圆角矩形填充半透明色，选中片段加 1.5px 描边。

### Layer 2: 进度打点层 (_ProgressMarkerPainter)

| 参数 | 类型 | 说明 |
|------|------|------|
| progress | double | 0.0-1.0 播放进度 |
| markerTimesMs | `List<int>` | 预计算的 marker 时间列表 |
| markerDotIds | `List<int>` | 对应的 DotRecord id |
| selectedDotId | int? | 选中的打点 ID |
| barHeight | double | 轨道高度（默认 6.0） |

绘制顺序：
1. 背景轨道：RRect + 灰色填充
2. 已播放区域：LinearGradient (蓝→紫→粉) + clipRRect
3. 打点 marker：按动作类型绘制不同形状（已通过 alpha 0.6 衰减，已选中白色描边）

### Layer 3: Thumb

白色圆形（拖拽时 9px，普通 7px）+ 拖拽浮层显示"当前/总时长"。

### Marker 形状映射

| 动作类型 | 形状 |
|---------|------|
| 射门/投篮/扣杀 | 菱形 (diamond) |
| 犯规/违例 | 三角形 (triangle) |
| 其他 | 圆形 (circle) |

## 磁吸算法

源文件：`lib/utils/timeline_utils.dart`

### applySnap()

```dart
({int positionMs, int? snappedIndex}) applySnap({
  required int rawMs,              // 拖拽原始位置（毫秒）
  required List<int> markerTimesMs,
  int snapThresholdMs = 300,       // 轻吸附阈值
  bool strongSnap = false,         // 强吸附（仅高光模式）
})
```

- `strongSnap=true`（仅高光模式）→ 直接跳到最近 marker
- `strongSnap=false`（全部模式）→ 距离 \< 300ms 才吸附

### findNearestMarkerByTap()

点击检测：在 ±20px 范围内命中最近的 marker。

## 拖拽交互流程

```
PointerDown → setScrubbing(true) + setGestureExclusionRects(true)
  │
PointerMove (30ms 节流)
  → _seekToPosition()
    → applySnap() → 计算磁吸位置
    → 新 marker 命中 → HapticFeedback.selectionClick()
    → session.seek(source: scrubbing)
  │
PointerUp → seek(source: seekExternal) + setScrubbing(false)
```

## 性能优化

| 优化项 | 手段 | 效果 |
|--------|------|------|
| 高频 position 独立 | ValueNotifier + ValueListenableBuilder | 避免重绘整个时间轴 |
| Marker 时间预计算 | _computeMarkerTimes() 缓存 | 避免每帧重算 |
| 拖拽节流 | 30ms 间隔限制 | 减少不必要的 seek |
| 竖版轨道瘦身 | height: 36px (vs 横版 48px) | 节省竖版空间 |

## 右滑返回冲突

时间轴的水平拖拽与页面右滑返回手势冲突。解决方案：`BackGestureExclusion` 排除区声明（`lib/widgets/back_gesture_scope.dart`）。

```dart
BackGestureExclusion(
  child: TimelineHub(...), // 或其他需要双向水平拖拽的区域
)
```

**原理**：向 `BackGestureController` 注册 GlobalKey，路由层 `_handlePointerDown` 检测到指针落在排除区时不注册 recognizer → 指针不进竞技场 → 时间轴拖拽零干扰。

旧方案（`_SwipeBackBlocker` — touchSlop=1 抢竞技场）已废弃，它是"手势黑洞"会消费所有水平拖拽。

## 相关文档

- [事件模型](event-model) — DotRecord 和动作类型
- [状态管理](state-management) — PlaybackSession 高频/低频分离
- [回放流程](../product/playback-flow) — 时间轴在页面中的位置和交互
