---
title: 剪辑链路
sidebar_position: 3
description: "单事件/批量/合集三种剪辑模式 + 两层批次页面 + 后台 fire-and-forget 执行"
---

# 剪辑链路

> 剪辑链路从回放页触发，支持单事件剪辑、批量剪辑和高光合集三种模式，执行后台化（fire-and-forget），通过两层页面管理剪辑结果。

## 用户旅程

```
回放页
  ├── 更多菜单 → 一键剪辑（全部事件）
  ├── 多选模式 → 剪辑 N 个（选中事件）
  ├── 左滑事件 → 剪辑（单事件）
  │
  └── 后台执行 → AppBar 进度环
       │
       ├── 完成 → Toast（查看 + 收藏）
       │         → 剪辑列表页
       │              ├── 批次列表（按 task_id 分组）
       │              └── 批次详情
       │                   ├── 全屏播放
       │                   ├── 生成高光合集
       │                   └── 左滑：分享 / 删除
       │
       └── 失败 → 红色错误 Toast
```

## 三种剪辑模式

| 模式 | 触发方式 | 输入 |
|------|---------|------|
| 一键剪辑 | 更多菜单 | 全部可见事件（受筛选影响） |
| 批量剪辑 | 多选吸底栏 | 选中的事件 |
| 单事件剪辑 | 事件左滑 | 单个 DotRecord |

所有模式最终调用 `VideoClipTaskManager.submitTask()`。

## 剪辑参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| beforeSeconds | 10 | 事件前截取秒数 |
| afterSeconds | 2 | 事件后截取秒数 |

可通过"更多菜单 → 编辑剪辑参数"修改。

## 批次管理

### 一级页：批次列表 (ClipVideoListPage)

按 `task_id` 分组展示。历史数据（`task_id=null`）归入"历史剪辑"。

每个批次卡片：日期 + 片段数 + 动作类型 + 总时长

### 二级页：批次详情 (ClipBatchDetailPage)

iOS 相册 album 风格：
- 有高光合集时：顶部大封面（SliverAppBar 350px）
- 吸顶筛选标签
- 3 列网格缩略图（竖版 3:4，横版 1:1）
- 长按弹出操作菜单

### 高光合集生成

条件：普通片段 ≥ 2

```
选中片段 → VideoClipService.mergeClips()
  → FFmpeg concat demuxer → 合并视频
  → 入库 clip_records (actionType='高光合集')
```

## 相关文档

- [剪辑任务批次](../engineering/clip-task-batch) — task_id 机制和状态机
- [FFmpeg 管线](../engineering/ffmpeg-pipeline) — 底层剪辑命令
- [回放流程](playback-flow) — 剪辑的触发入口
