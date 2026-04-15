---
title: 右滑返回交互系统
sidebar_position: 14
sidebar_label: 右滑返回手势
description: 全屏右滑跟手返回的三层防御体系：方向感知 Recognizer + 排除区声明 + PopScope 状态阻止
---

# 右滑返回交互系统

> 全屏右滑跟手返回，内容感知、区域感知、状态清晰。非强交互区低摩擦返回，强交互区内容优先。

## 概述

所有页面通过 `smoothPageRoute()` 跳转，继承 `CupertinoPageRoute` 的 iOS 风格转场（视差 -1/3 偏移、阴影渐变、fastEaseInToSlowEaseOut 曲线）。自定义 `_WideBackGestureWrapper` 在全屏铺 `Listener` 检测右滑手势。

## 三层防御体系

```
Layer 1: _PopGestureRecognizer（方向感知）
  ┌─ pendingDirection  ── 累积 dx/dy，6px 后判方向
  ├─ acceptedDirection ── 右向主导（angle ≤ 35°），进入 pop 流程
  └─ rejectedDirection ── 左向/斜向，退出竞技场

Layer 2: BackGestureExclusion（排除区声明）
  └─ 指针落在排除区 → 不注册 recognizer → 内容手势零干扰

Layer 3: PopScope + SlidableOpenTracker（状态阻止）
  └─ Slidable 打开 / 录制中 / 全屏 → canPop=false → recognizer 不注册
```

### 何时用哪层

| 场景 | 机制 | 原因 |
|------|------|------|
| PageView / 时间轴 / 横向 chip 条 | BackGestureExclusion | 双向水平操作，右滑归内容 |
| Slidable（仅左滑打开） | 方向感知 recognizer + PopScope | 左滑被 recognizer 拒绝；打开时 PopScope 阻止返回 |
| 录制页 / 全屏播放 | PopScope 硬阻止 | popDisposition=doNotPop |
| 普通详情页 | 无需任何操作 | 全屏右滑自动生效 |

## 核心文件

| 文件 | 职责 |
|------|------|
| `lib/utils/page_transitions.dart` | 路由定义 + `_PopGestureRecognizer` + `_WideBackGestureWrapper` |
| `lib/widgets/back_gesture_scope.dart` | `BackGestureController` + `BackGestureScope` + `BackGestureExclusion` |
| `lib/widgets/slidable_open_tracker.dart` | 公共 `SlidableOpenTracker`（_wasOpen 去重） |

## _PopGestureRecognizer 状态机

### 设计原则

Recognizer 职责单一：**只做方向判断**。动画就绪检查由 `_handlePointerDown` 在注册前完成（与 Flutter 原生 `CupertinoPageRoute` 一致）。不持有 `route` 引用，不做运行时动画状态检查。

### 状态流转

```
PointerDown
  → _handlePointerDown 前置检查（PopScope / 动画 / 排除区）
  → addAllowedPointer → _reset() → pendingDirection

PointerMove (pendingDirection)
  → 累积 _rawDelta (dx, dy)
  → distance ≥ 6px 时判方向：
    → dx > 0 && angle ≤ 35° → acceptedDirection
    → 否则 → rejectedDirection → resolve(rejected) + stopTrackingPointer

PointerMove (acceptedDirection)
  → hasSufficientGlobalDistanceToAccept：
    → 委托 super 检查 touchSlop
    → globalDistanceMoved > 10 → 竞技场接受 → onStart → pop 手势开始
```

### 方向判断

```
angle = atan2(|dy|, dx)

dx ≤ 0 → angle > π/2 → rejected（左滑、纯垂直）
dx > 0, angle ≤ 35° → accepted（右向主导）
dx > 0, angle > 35° → rejected（斜度过大，判为滚动）
```

决策阈值 6px < touchSlop 10px → 确保在父类 auto-accept 之前完成方向判断。

### 多指守卫

`_handlePointerDown` 检查 `_gestureInProgress`，第二根手指直接忽略。

## BackGestureExclusion 排除区

### 原理

```
BackGestureExclusion 注册 GlobalKey → BackGestureController
                                           ↑
_handlePointerDown → isInExclusionZone(event.position) ?
  → true:  不注册 recognizer（指针不进竞技场）
  → false: 正常注册
```

### 与旧方案 _SwipeBackBlocker 的区别

| | _SwipeBackBlocker (已废弃) | BackGestureExclusion |
|---|---|---|
| 原理 | touchSlop=1 的 recognizer 抢赢竞技场 | 指针不进竞技场 |
| 副作用 | 消费所有水平拖拽（手势黑洞） | 无副作用 |
| 扩展方式 | 每页抄一份私有类 | 声明式包裹，一行代码 |

### 使用方式

```dart
BackGestureExclusion(
  child: PageView.builder(...), // 或时间轴、横向 chip 条
)
```

### 已应用位置

| 区域 | 文件 |
|------|------|
| 回放页时间轴+分类标签 | `review_detail_page.dart` |
| 时间轴容器 | `timeline_hub.dart` |
| 运动选择 PageView（2 处） | `sport_select_page.dart` |
| 收藏页封面轮播 + 吸顶 chip 条 | `favorites_page.dart` |
| 历史记录页吸顶筛选 chip 条 | `history_records_page.dart` |
| 剪辑详情页吸顶筛选 chip 条 | `clip_batch_detail_page.dart` |

## SlidableOpenTracker

### 问题

Slidable 打开时，右滑应先关闭 Slidable，不应触发页面返回。

### 方案

```dart
// 1. Slidable child 包裹 tracker
SlidableOpenTracker(
  onOpenChanged: (isOpen) => _count.value += isOpen ? 1 : -1,
  child: tileContent,
)

// 2. build 最外层 PopScope
PopScope(canPop: count == 0, ...)
```

### 去重机制

- `_wasOpen` 布尔值：actionPaneType 重复通知同一状态时静默丢弃
- `dispose` 时若仍 open 补发 `false`：防列表项回收时计数泄漏

### 已应用位置

| 页面 | 文件 |
|------|------|
| 回放页高光事件 | `events_card.dart` |
| 历史记录页 | `history_records_page.dart` |
| 剪辑批次列表 | `clip_video_list_page.dart` |

## _handlePointerDown 检查链路

```dart
void _handlePointerDown(PointerDownEvent event) {
  // 1. PopScope 硬阻止（录制中/全屏/Slidable 打开等）
  if (popDisposition == doNotPop) return;
  if (!canPop) return;

  // 2. 已有手势进行中 → 忽略第二根手指
  if (_gestureInProgress) return;

  // 3. 其他 route 的手势正在进行（安全 null 检查）
  final nav = widget.route.navigator;
  if (nav == null || nav.userGestureInProgress) return;

  // 4. 动画未就绪（页面入场动画还在进行）
  if (route.animation?.status != AnimationStatus.completed) return;

  // 5. 排除区检查
  if (controller.isInExclusionZone(event.position)) return;

  // 6. 注册 recognizer 进入竞技场
  recognizer.addPointer(event);
}
```

## Navigator 计数器保护

### 问题

`_handleDragEnd` 中 `navigator.pop()` 在动画值接近 0 时会同步触发路由 finalize → `route._navigator = null`。之后 `widget.route.navigator?.didStopUserGesture()` 变成空操作，`Navigator._userGesturesInProgress` 永久 +1，后续所有页面右滑手势被阻塞。

### 方案

在 `_handleDragStart` 时缓存 `NavigatorState` 引用到 `_nav` 字段，三条清理路径均使用缓存引用：

```dart
NavigatorState? _nav;

void _handleDragStart(DragStartDetails details) {
  ...
  _nav = widget.route.navigator;  // 缓存引用
  _nav?.didStartUserGesture();
}

void _handleDragEnd(DragEndDetails details) {
  ...
  _nav?.pop();                    // pop 可能同步销毁 route
  _nav?.didStopUserGesture();     // 使用缓存引用，确保计数器递减
  _nav = null;
}

void _handleDragCancel() {
  ...
  _nav?.didStopUserGesture();
  _nav = null;
}

void dispose() {
  // 兜底：dispose 时手势仍在进行中
  if (_gestureInProgress && _nav != null) {
    _nav!.didStopUserGesture();
  }
  ...
}
```

## 新增页面接入指南

| 场景 | 操作 |
|------|------|
| 普通详情页 | 无需任何操作，全屏右滑自动生效 |
| 有 PageView / 横向滚动 | 包 `BackGestureExclusion` |
| 有 Slidable 左滑 | 包 `SlidableOpenTracker` + PopScope |
| 需全局禁止返回 | `PopScope(canPop: false)` |

## 相关文档

- [时间轴模型](timeline-model) — 时间轴拖拽与右滑返回冲突
- [状态管理](state-management) — PlaybackSession / ReviewDetailData
- [架构概览](architecture-overview) — 整体项目结构
- [测试关注点](../testing/test-focus-areas) — 回归测试清单
