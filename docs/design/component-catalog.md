---
title: 组件目录
sidebar_position: 3
description: "BlinkLife 通用 UI 组件清单：GlassCard、CenterToast、GlassConfirmDialog、GlassPopupMenu 等"
---

# 组件目录

> BlinkLife 的通用 UI 组件，遵循 iOS 26 Liquid Glass 设计语言。

## 容器组件

### GlassCard

毛玻璃卡片容器。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| child | Widget | 必填 | 内容 |
| padding | EdgeInsets? | 16.0 | 内边距 |
| borderRadius | double | 28 | 圆角 |

文件：`lib/widgets/glass_card.dart`

### GlassAppBarButton

36x36 圆形半透明按钮，用于 AppBar 返回和操作。

| 快捷构造 | 说明 |
|---------|------|
| `.back(onTap)` | 返回按钮（chevron_left） |
| `.more(onTap)` | 更多按钮（more_horiz） |

文件：`lib/widgets/glass_app_bar_button.dart`

## 反馈组件

### CenterToast

屏幕居中毛玻璃提示，自动消失。

```dart
// 纯文字
CenterToast.showText(context, '操作成功');
CenterToast.showText(context, '操作失败', isError: true);

// 带操作按钮
CenterToast.show(context,
  message: '剪辑完成',
  actions: [
    CenterToastAction(label: '查看', onTap: ..., isPrimary: true),
    CenterToastAction(label: '收藏', onTap: ...),
  ],
);
```

文件：`lib/widgets/center_toast.dart`

### GlassConfirmDialog

iOS 26 风格确认弹窗（深色毛玻璃 + Scale/Fade 动画）。

```dart
final confirmed = await showGlassConfirmDialog(
  context: context,
  title: '删除记录',
  subtitle: '打点记录和剪辑片段将一并删除',
  confirmText: '删除',
  confirmColor: Colors.red,
);
```

文件：`lib/widgets/glass_confirm_dialog.dart`

## 菜单组件

### GlassPopupMenu

从按钮位置展开的下拉菜单（Scale+Fade 动画，纯色背景 0.92）。

```dart
showGlassPopupMenu(
  context: context,
  buttonKey: _moreButtonKey,
  items: [
    GlassMenuItem(icon: Icons.content_cut, label: '一键剪辑', onTap: ...),
    GlassMenuItem(icon: Icons.delete, label: '删除', onTap: ..., isDestructive: true),
  ],
);
```

### showGlassContextMenu

长按上下文菜单（全屏遮罩 + 缩略图预览浮起 + 菜单列表）。用于剪辑详情页和收藏页的网格 tile。

## 通用小组件 (common_widgets.dart)

| 组件 | 说明 |
|------|------|
| SquareIcon | 32x32 方形图标容器 |
| ChipTag | 圆角背景文字标签 |
| DragHandle | BottomSheet 顶部拖动指示器 |
| ActionButton | 带图标+标题+副标题的操作按钮 |

## 其他

| 组件 | 文件 | 说明 |
|------|------|------|
| FavoriteButton | favorite_button.dart | 收藏弹跳动画按钮 |
| TapScale | tap_scale.dart | 点击缩放动效包装器 |
| VideoProgressBar | video_progress_bar.dart | 线性视频进度条 |

## 相关文档

- [Liquid Glass 规范](liquid-glass-spec) — 设计参数标准
