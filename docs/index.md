---
title: BlinkLife Wiki
sidebar_position: 1
sidebar_label: 首页
slug: /
---

# BlinkLife Wiki

> BlinkLife 项目知识库 — 覆盖产品流程、工程架构、设计规范、数据定义和测试策略。

## 项目简介

BlinkLife 是一款运动视频打点剪辑应用。用户在运动中通过 BLE 蓝牙外设（智能指环/按键）或手表一键标记精彩瞬间，运动结束后自动生成高光集锦视频。

| 属性 | 值 |
|------|------|
| 移动客户端 | Flutter (Dart ^3.9.0)，iOS + Android 双平台 |
| 桌面工具 | Tauri v2 (Rust + React + FFmpeg CLI)，macOS 双架构 |
| 后端 API | NestJS + PostgreSQL (Prisma ORM) |
| 本地数据库 | SQLite (sqflite)，当前 v15 |
| 视频处理 | FFmpegKit (移动端) / FFmpeg CLI (桌面端) |
| 打点文件格式 | .blink (AES-256-CBC + HMAC-SHA256) |
| 设计语言 | iOS 26 Liquid Glass |
| 官网 | Next.js 16 + React 19，Vercel + CVM 双部署 |

## 文档导航

### 产品流程

| 文档 | 说明 |
|------|------|
| [录制流程](product/recording-flow) | 相机录制 + BLE/手表/手势打点 + 后台保存 |
| [回放流程](product/playback-flow) | 视频回放 + 三层时间轴 + 事件编辑 + 竖横版全屏 |
| [剪辑链路](product/clipping-flow) | 单事件/批量/合集剪辑 + 批次管理 |
| [复盘页](product/review-flow) | AI 复盘分析（规划中） |

### 工程架构

| 文档 | 说明 |
|------|------|
| [架构总览](engineering/architecture-overview) | 分层架构 + 模块关系 + 核心数据流 |
| [时间轴模型](engineering/timeline-model) | 三层 CustomPainter + 磁吸算法 + 双 Model 状态分层 |
| [事件模型](engineering/event-model) | DotRecord 结构 + 动作类型 + 时间对齐 + 筛选 |
| [.blink 文件格式](engineering/blink-file-format) | v1/v2 加密协议 + 明文兼容 + 安全设计 |
| [剪辑任务批次](engineering/clip-task-batch) | task_id 机制 + 后台任务管理器 + 状态机 |
| [FFmpeg 管线](engineering/ffmpeg-pipeline) | 剪辑/合集命令模板 + 约束 + 性能 |
| [蓝牙通信](engineering/ble-communication) | BLE + MethodChannel + 保活策略 |
| [数据库 Schema](engineering/database-schema) | v13 全表定义 + 迁移历史 |
| [云同步架构](engineering/cloud-sync-architecture) | JWT 认证 + API 同步 + 游客 claim |
| [状态管理](engineering/state-management) | PlaybackSession + ReviewDetailData + ChangeNotifier |
| [Studio 桌面端](engineering/studio-architecture) | Tauri v2 架构 + .blink 解密 + FFmpeg 管线 + 发布 |

### 设计规范

| 文档 | 说明 |
|------|------|
| [Liquid Glass 规范](design/liquid-glass-spec) | iOS 26 液态玻璃设计语言参数 |
| [沉浸式详情页](design/immersive-detail-spec) | SliverAppBar + 封面 + 吸顶标签 |
| [组件目录](design/component-catalog) | GlassCard / Toast / Dialog / PopupMenu |

### 数据定义

| 文档 | 说明 |
|------|------|
| [模型字典](data/model-dictionary) | 6 个 Model 全字段说明 |
| [RecordingData 格式](data/recording-data-format) | JSON 结构 + 示例 |
| [API 端点](data/api-endpoints) | 后端 REST API 一览 |

### 测试

| 文档 | 说明 |
|------|------|
| [测试关注点](testing/test-focus-areas) | 高风险模块 + 回归清单 |

## 与 CLAUDE.md 的关系

| 维度 | CLAUDE.md | docs/ Wiki |
|------|-----------|-----------|
| 定位 | AI 编码指令手册 | 知识沉淀与架构理解 |
| 内容 | 规则（禁止/必须/约束） | 解释（原理/权衡/为什么） |
| 粒度 | 代码级（文件名/方法/模板） | 概念级（模块/数据流/状态机） |
| 更新 | 每次迭代同步 | 架构变更时更新 |
