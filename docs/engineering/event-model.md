---
title: 事件模型
sidebar_position: 3
description: "DotRecord 是全系统核心数据单元，包含动作类型、时间戳、输入源和对齐逻辑"
---

# 事件模型

> DotRecord 是 BlinkLife 的核心数据单元，表示一个打点事件（运动中的精彩瞬间标记）。所有子系统（时间轴、事件列表、剪辑、收藏）都围绕 DotRecord 运转。

## DotRecord 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 稳定 ID，默认 = recordingTime.inMilliseconds |
| action | String | 动作类型（如"射门"、"犯规"、"精彩"） |
| timestamp | DateTime | 绝对 UTC 时间戳（打点时刻的墙钟时间） |
| recordingTime | Duration | 相对于录制开始的时间偏移 |
| inputSource | String | 输入来源：`ble_ring` / `gesture` / `watch` / `manual` |

### id 的稳定性约束

id 使用 `recordingTime.inMilliseconds` 作为默认值，确保同一打点在不同加载周期中保持相同 id。编辑打点时间时**保留原 id**，防止选中态错乱。

## 时间对齐机制

核心公式：

```
显示时间 = dot.timestamp - actualRecordingStartTime + alignOffsetMs
```

其中：
- `actualRecordingStartTime` = 视频 creation_time - 视频 duration（反推录制开始时间）
- `alignOffsetMs` = 仅打点模式导入视频后的手动偏移校正

### 不同 recordType 的对齐逻辑

| recordType | 有视频 | 对齐方式 |
|-----------|--------|---------|
| 1 (录制+打点) | 是 | 自动（creation_time 元数据） |
| 2 (仅打点) | 导入后有 | 手动（alignOffsetMs） |
| 3 (外部导入) | 可选 | 自动 + 可选手动微调 |

## 动作类型系统

由 `KeyMappingService` 管理，每种运动类型有 5 个按键映射：

```dart
// 足球示例
{'up': '射门', 'down': '传球', 'left': '犯规', 'right': '任意球', 'center': '精彩'}
```

用户可在运动选择页自定义，历史记录保存在 SharedPreferences。

### 动作视觉映射 (action_color.dart)

- `getActionColor(action)` → 不同动作对应的颜色
- `getActionShape(action)` → 时间轴上的形状（circle/diamond/triangle/square）

## 筛选系统

```dart
class TimelineFilter {
  final Set<String>? actions;    // 动作类型筛选
  final Set<String>? sources;    // 打点来源筛选（预留）
  final bool hasClipOnly;        // 仅已剪辑（预留）

  bool accepts(DotRecord dot) {
    if (actions != null && !actions!.contains(dot.action)) return false;
    return true;
  }
}
```

筛选联动：TimelineToolbar 点击 → `data.toggleActionFilter(action)` → 时间轴重算 marker + 事件列表重新过滤。

## RecordingData JSON 示例

```json
{
  "sportType": "足球",
  "startTime": "2026-04-13T10:00:00Z",
  "endTime": "2026-04-13T11:30:00Z",
  "duration": 5400000,
  "dotRecords": [
    {
      "id": 15000,
      "action": "射门",
      "timestamp": "2026-04-13T10:15:00Z",
      "recordingTime": 900000,
      "inputSource": "ble_ring"
    }
  ],
  "dotCounts": {"射门": 8, "犯规": 3},
  "totalDots": 11,
  "recordType": 1,
  "alignOffsetMs": null,
  "inputSources": ["ble_ring", "gesture"]
}
```

## 相关文档

- [时间轴模型](timeline-model) — DotRecord 在时间轴上的可视化
- [.blink 文件格式](blink-file-format) — DotRecord 的加密持久化
- [模型字典](../data/model-dictionary) — 完整字段定义
- [RecordingData 格式](../data/recording-data-format) — JSON 结构详解
