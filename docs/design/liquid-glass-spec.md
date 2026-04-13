---
title: Liquid Glass 设计语言
sidebar_position: 1
description: "iOS 26 液态玻璃设计语言：BackdropFilter + 半透明渐变 + 0.5px 描边"
---

# Liquid Glass 设计语言

> 所有新增 UI 组件必须遵循 iOS 26 液态玻璃设计语言。不再使用实心背景按钮、纯色卡片等旧风格。

## 核心参数

| 属性 | 值 | 说明 |
|------|------|------|
| 模糊 | `ImageFilter.blur(sigmaX: 40, sigmaY: 40)` | BackdropFilter |
| 背景 | `LinearGradient` 白色 12%→6% | 多层半透明 |
| 描边 | `Border.all(white 18%, width: 0.5)` | 极细玻璃高光 |
| 圆角 | 胶囊 22-28，卡片 16-20 | 统一圆润 |
| 文字 | 白色 90% | 保留玻璃透感 |
| 裁切 | ClipRRect 包裹 BackdropFilter | 必须裁切 |

## 代码模板

```dart
ClipRRect(
  borderRadius: BorderRadius.circular(20),
  child: BackdropFilter(
    filter: ImageFilter.blur(sigmaX: 40, sigmaY: 40),
    child: Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white.withValues(alpha: 0.12),
            Colors.white.withValues(alpha: 0.06),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.18),
          width: 0.5,
        ),
      ),
      child: /* 内容 */,
    ),
  ),
)
```

## 性能注意

:::warning 避免在高频更新场景使用 BackdropFilter
BackdropFilter 每帧都要对底层像素做高斯模糊，滚动列表中使用会严重影响帧率。
:::

| 场景 | 做法 |
|------|------|
| 静态浮层（FAB/Toast/Sheet） | BackdropFilter ✅ |
| 滚动列表中的卡片 | 纯色半透明 `alpha: 0.75` |
| 吸顶标签栏 | 纯色 `black.withValues(alpha: 0.75)` |
| AppBar 磨砂层 | 纯色 Container |
| 弹出菜单 | 纯色 `alpha: 0.92` |

## 组件清单

| 组件 | 文件 | BackdropFilter |
|------|------|----------------|
| GlassCard | glass_card.dart | ✅ |
| GlassConfirmDialog | glass_confirm_dialog.dart | ❌（纯色 0.92） |
| CenterToast | center_toast.dart | ❌（纯色 #222222） |
| GlassPopupMenu | glass_popup_menu.dart | ❌（纯色 0.92） |
| GlassAppBarButton | glass_app_bar_button.dart | ❌（white 15%） |
| 首页 FAB | main.dart | ❌（渐变+发光） |
| 多选吸底栏 | review_detail_page.dart | ✅ |

## 适用场景

| 适用 ✅ | 不适用 ❌ |
|--------|----------|
| 浮动按钮、工具栏 | 列表行背景 |
| Toast / 弹窗 / Sheet | 页面底色 |
| 卡片悬浮层 | 高频滚动元素 |

## 相关文档

- [沉浸式详情页](immersive-detail-spec) — 带封面大图的布局规范
- [组件目录](component-catalog) — Glass 组件使用指南
