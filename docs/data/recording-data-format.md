---
title: RecordingData JSON 格式
sidebar_position: 2
description: "RecordingData 的 JSON 序列化结构，存储在 .blink 加密文件中"
---

# RecordingData JSON 格式

> RecordingData 是打点记录的完整数据包装，序列化为 JSON 后通过 BlinkCrypto 加密存储到 .blink 文件。

## JSON 结构

```json
{
  "sportType": "足球",
  "startTime": "2026-04-13T10:00:00.000Z",
  "endTime": "2026-04-13T11:30:00.000Z",
  "duration": 5400000,
  "dotRecords": [
    {
      "id": 900000,
      "action": "射门",
      "timestamp": "2026-04-13T10:15:00.000Z",
      "recordingTime": 900000,
      "inputSource": "ble_ring"
    },
    {
      "id": 1200000,
      "action": "犯规",
      "timestamp": "2026-04-13T10:20:00.000Z",
      "recordingTime": 1200000,
      "inputSource": "gesture"
    }
  ],
  "dotCounts": {
    "射门": 8,
    "犯规": 3,
    "精彩": 5
  },
  "totalDots": 16,
  "recordType": 1,
  "alignOffsetMs": null,
  "inputSources": ["ble_ring", "gesture"]
}
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sportType | string | 是 | 运动类型 |
| startTime | ISO8601 | 是 | 录制开始时间 (UTC) |
| endTime | ISO8601 | 是 | 录制结束时间 (UTC) |
| duration | int | 是 | 总时长 (毫秒) |
| dotRecords | array | 是 | 打点事件列表 |
| dotCounts | object | 是 | 按动作类型的计数 |
| totalDots | int | 是 | 打点总数 |
| recordType | int | 是 | 1=录制+打点, 2=仅打点, 3=外部导入 |
| alignOffsetMs | int? | 否 | 对齐偏移（仅 recordType=2/3） |
| inputSources | string[]? | 否 | 使用的输入源列表 |

### dotRecords 元素

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 稳定 ID（= recordingTime 毫秒值） |
| action | string | 动作类型名称 |
| timestamp | ISO8601 | 绝对 UTC 时间戳 |
| recordingTime | int | 相对录制开始的偏移（毫秒） |
| inputSource | string | ble_ring / gesture / watch / manual |

## 存储位置

```
/sdcard/Documents/BlinkLife/
  └── {date}_{timestamp}/
       └── recording_data.blink    ← AES-256-CBC 加密的此 JSON
```

## 读写方式

- 写入：`FileService.saveRecordingData()` → `BlinkCrypto.writeFile()`
- 读取：`FileService.loadRecordingData()` → `BlinkCrypto.readFile()`
- 禁止直接 `readAsString`/`writeAsString`

## 相关文档

- [.blink 文件格式](../engineering/blink-file-format) — 加密协议
- [事件模型](../engineering/event-model) — DotRecord 业务逻辑
- [模型字典](model-dictionary) — Dart 模型字段映射
