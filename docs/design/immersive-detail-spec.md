---
title: 沉浸式详情页规范
sidebar_position: 2
description: "带封面大图的详情页规范：SliverAppBar + 封面顶到状态栏 + 吸顶标签 + 纯色背景"
---

# 沉浸式详情页规范

> 所有带封面大图的详情页必须采用沉浸式布局：封面顶到状态栏、收起后纯色背景、返回按钮用普通容器（禁止 ClipOval+BackdropFilter）。

## 页面结构

```
Scaffold(backgroundColor: Colors.black)
└─ CustomScrollView
    ├─ SliverAppBar(pinned)
    │   ├─ FlexibleSpaceBar(background: 封面图)  ← 顶到状态栏
    │   └─ Stack:
    │       ├─ 底层: FlexibleSpaceBar 封面
    │       └─ 顶层: _isScrolled ? 纯色背景 : 透明
    ├─ SliverPersistentHeader(pinned) — 吸顶标签栏
    └─ SliverGrid / SliverList — 内容区
```

## SliverAppBar 配置

```dart
SliverAppBar(
  pinned: true,
  automaticallyImplyLeading: false,   // 禁止系统默认返回按钮
  backgroundColor: Colors.transparent,
  forceMaterialTransparency: true,     // 去掉 Material 背景层
  elevation: 0,
  scrolledUnderElevation: 0,
  expandedHeight: hasCover ? 350 : null,
)
```

## 返回按钮

```dart
// ✅ 正确：普通半透明圆形容器
Container(
  width: 36, height: 36,
  decoration: BoxDecoration(
    shape: BoxShape.circle,
    color: Colors.white.withValues(alpha: 0.15),
  ),
  child: Icon(Icons.chevron_left, color: Colors.white, size: 22),
)
```

:::danger 禁止
ClipOval + BackdropFilter 会产生**椭圆重影**，严禁在按钮上使用。
:::

## 磨砂触发时机

```dart
final collapseThreshold = expandedHeight - kToolbarHeight - statusBarHeight;
final scrolled = _scrollController.offset > collapseThreshold.clamp(0, double.infinity);
```

封面**完全收起后**才触发（分类标签吸顶时），不是一开始滚动就触发。

## 吸顶标签栏

```dart
Container(
  height: 52,
  decoration: BoxDecoration(
    color: Colors.black.withValues(alpha: 0.75),  // 纯色，不用 BackdropFilter
    border: Border(bottom: BorderSide(
      color: Colors.white.withValues(alpha: 0.1), width: 0.5,
    )),
  ),
)
```

## 已应用的页面

| 页面 | 文件 |
|------|------|
| 剪辑批次详情 | clip_batch_detail_page.dart |
| 我的收藏 | favorites_page.dart |
| 高光集锦 album | highlight_album_page.dart |

## 相关文档

- [Liquid Glass 规范](liquid-glass-spec) — 基础设计语言
