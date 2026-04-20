---
title: 复盘页
sidebar_position: 4
description: "复盘页 MVP：总览 + 事件分布 + 心率趋势 + 5 级心率区间 + 步数/卡路里/VO₂max"
---

# 复盘页

> 复盘页在回放页基础上融合 Watch 采集的运动数据，帮助用户从"记录精彩瞬间"升级到"理解运动表现"。MVP 已落地（2026-04-20），AI 摘要待接入。

## 入口与数据来源

| 入口 | 触发 |
|------|------|
| 回放页顶部入口 `review_detail_page.dart` | 记录详情卡片"查看复盘"按钮 |
| 录制记录列表右滑 | Slidable 快捷操作 |

数据来源（按优先级）：
1. `RecordingRecord`（基础信息：时长、运动类型、打点数）
2. `Session` + `SensorSample[]`（Watch 采集的传感器序列，`sensor_data_service.dart`）
3. `DotRecord[]`（打点序列，从 `.blink` 文件解密还原）
4. `ReviewDetailData`（复盘聚合模型，客户端合成）

## MVP 能力清单

| 模块 | 实装状态 | 说明 |
|------|---------|------|
| 总览卡片 | ✅ | 时长 / 运动 / 打点数 / 平均心率 / 最大心率 |
| 心率趋势图 | ✅ | 连续心率曲线 + 5 级负荷区间色带（`review_heart_rate_chart.dart` + `review_hr_zones.dart`） |
| 心率区间分布 | ✅ | 热身 / 有氧 / 无氧 / 极限 / 峰值 5 档时长统计 |
| 运动量展示 | ✅ | 累计步数 / 距离 / 卡路里 / VO₂max |
| 事件分布 | ✅ | 打点按 `markerType` 分类 + 时间分布（复用 `TimelineProgressTrack` 新增数据层） |
| 批量重命名 | ✅ | 按 `inputSource` 分组修改打点 `markerType` |
| AI 摘要 | ⏳ | `ai_review_service.dart` 已搭骨架，Claude API 接入待做 |
| 多场次趋势对比 | ⏳ | P2 |
| GPS 轨迹热图 | ⏳ | P2（GPS 数据已采集） |

## 与回放页的区别

| 维度 | 回放页 | 复盘页 |
|------|-------|-------|
| 核心 | 视频回放 + 事件浏览 + 剪辑 | 数据分析 + 事件理解 |
| 时间轴 | 打点 marker | 打点 marker + 心率曲线 + 负荷色带 |
| 输出 | 剪辑视频片段 | 复盘概览（AI 摘要待补） |
| 数据源 | `.blink` 打点 | 打点 + Watch 传感器 + 聚合指标 |

## 关键实现指向

| 层 | 代码位置 |
|----|----------|
| 页面 | `lib/screens/review_detail_page.dart` / `review_page.dart` |
| 数据聚合 | `lib/services/review_data_service.dart` |
| 传感器查询 | `lib/services/sensor_data_service.dart`（支持按时间窗聚合） |
| 心率图 | `lib/widgets/review_heart_rate_chart.dart` + `review_hr_zones.dart` |
| 总览 | `lib/widgets/review_overview_card.dart` |
| AI 骨架 | `lib/services/ai_review_service.dart`（待接入 Claude API） |

## 降级策略

| 缺失数据 | 页面行为 |
|----------|---------|
| 无 Watch Session | 隐藏心率图 / 心率区间 / 运动量模块，只显示打点分布 |
| Watch 数据断点 > 阈值 | 心率曲线显示"数据不完整"标签（`QualityState.degraded`） |
| 心率全为 0 | `QualityState.unavailable`，隐藏心率相关模块 |

## 相关文档

- [回放流程](playback-flow)
- [时间轴模型](../engineering/timeline-model)
- [手表采集 → 复盘页映射方案](watch-to-review-mapping) — 采集能力与字段映射
- [复盘页研发拆解](../engineering/review-dev-breakdown) — 模块分层与实现细节
