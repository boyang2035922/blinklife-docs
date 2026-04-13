---
title: 复盘页研发拆解
sidebar_position: 11
description: "按 6 个模块拆解复盘页研发任务：数据模型、手表采集、同步落库、时间轴对齐、复盘页消费、AI 约束"
---

# 复盘页研发拆解

> 基于 [完整方案](../product/watch-to-review-mapping) 和 [评审简版](../product/review-briefing)，按 6 个模块拆解研发任务。每个模块包含目标、输入输出、依赖、风险、是否必须实现、验收点。

---

## 模块 1：统一数据模型

### 目标

定义 6 个核心数据模型的 Dart class + SQLite 建表 SQL，作为手表采集和复盘页消费的统一数据契约。

### 输入输出

| 输入 | 输出 |
|------|------|
| 完整方案 Section D 的 6 个模型定义 | `lib/models/` 下 6 个 Dart 文件 |
| 现有 DotRecord/RecordingData 结构 | `database_service.dart` DB v14 迁移 |
| - | toMap/fromMap 序列化方法 |

### 新增文件

| 文件 | 内容 |
|------|------|
| `lib/models/session.dart` | Session 模型（id, start_time, end_time, pauses, sport_type, device_sources, status, clock_offset_ms） |
| `lib/models/event_marker.dart` | EventMarker 模型（在 DotRecord 基础上增加 confidence, weight, is_revoked, tags） |
| `lib/models/sensor_sample.dart` | SensorSample 模型（timestamp, heart_rate, speed, distance_increment, lat/lng, quality_flag） |
| `lib/models/segment.dart` | Segment 模型（start/end_time, segment_type, intensity_level, avg_heart_rate, linked_events） |
| `lib/models/replay_anchor.dart` | ReplayAnchor 模型（source_type, anchor_time, display_time, linked_video_path, linked_event_ids） |
| `lib/models/quality_state.dart` | QualityState 模型（data_type, quality_level, reason, missing_ranges, confidence_score） |

### DB v14 新增表

```sql
-- 训练会话
CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  pauses TEXT,                    -- JSON: [[pause_ms, resume_ms], ...]
  sport_type TEXT NOT NULL,
  device_sources TEXT NOT NULL,   -- JSON: ["phone","watch"]
  status INTEGER NOT NULL DEFAULT 0,  -- 0=active, 1=paused, 2=completed, 3=interrupted
  clock_offset_ms INTEGER,
  recording_id INTEGER,
  video_path TEXT,
  FOREIGN KEY (recording_id) REFERENCES recording_records(id)
);

-- 传感器采样（核心大表）
CREATE TABLE sensor_samples(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  heart_rate INTEGER,
  speed REAL,
  distance_increment REAL,
  latitude REAL,
  longitude REAL,
  altitude REAL,
  quality_flag INTEGER NOT NULL DEFAULT 0,  -- 0=good, 1=degraded, 2=interpolated, 3=unavailable
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX idx_sensor_session_time ON sensor_samples(session_id, timestamp);

-- 语义区段（客户端计算生成）
CREATE TABLE segments(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  segment_type INTEGER NOT NULL,  -- 0=intensity, 1=sprint, 2=rest, 3=warmup
  intensity_level INTEGER,        -- 0=light, 1=moderate, 2=vigorous, 3=max
  avg_heart_rate INTEGER,
  peak_speed REAL,
  avg_speed REAL,
  distance REAL,
  linked_events TEXT,             -- JSON: [event_id, ...]
  source INTEGER NOT NULL DEFAULT 0,  -- 0=auto, 1=user, 2=ai
  confidence REAL NOT NULL DEFAULT 1.0,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 数据质量状态
CREATE TABLE quality_states(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  data_type INTEGER NOT NULL,     -- 0=heart_rate, 1=speed, 2=gps, 3=event, 4=session
  quality_level INTEGER NOT NULL, -- 0=good, 1=degraded, 2=unavailable
  reason TEXT,
  missing_ranges TEXT,            -- JSON: [[start_ms, end_ms], ...]
  confidence_score REAL NOT NULL DEFAULT 1.0,
  sample_count INTEGER,
  expected_count INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

### 依赖

无外部依赖。可独立开发。

### 风险

| 风险 | 缓解 |
|------|------|
| sensor_samples 数据量大（5400 条/场） | 添加复合索引 `(session_id, timestamp)`，查询 benchmark 目标 200ms 以内 |
| EventMarker 与 DotRecord 双模型共存 | EventMarker 继承 DotRecord 字段 + 增强字段，回放页继续用 DotRecord，复盘页用 EventMarker |

### 当前阶段是否必须实现

**是。阻塞所有后续模块。**

### 验收点

- [ ] 6 个 Dart 模型文件创建，toMap/fromMap 可用
- [ ] DB v14 迁移 SQL 执行成功，旧数据不受影响
- [ ] sensor_samples 写入 5400 条 + 按 session_id 查询耗时测试通过

---

## 模块 2：手表端传感器采集

### 目标

WearOS 和 watchOS 手表端新增心率连续采集能力，与现有打点功能并行运行。录制开始时自动启动心率采集，录制结束时停止并将数据传回手机。

### 输入输出

| 输入 | 输出 |
|------|------|
| 录制状态（state_update 消息） | 心率数据流（批量或逐条传回手机） |
| 手表内置心率传感器 API | Session 生命周期事件 |
| - | 时钟偏移量（首次同步时计算） |

### WearOS 实现 (blinklife-wear/)

| 新增类 | 职责 |
|--------|------|
| `HeartRateCollector.kt` | 使用 Health Services API 订阅心率，1Hz 采样，缓存到本地 List |
| `SessionManager.kt` | 管理 Session 生命周期，接收 state_update 触发 start/pause/stop |
| `SensorDataSender.kt` | 批量发送心率数据到手机（每 30 秒或录制结束时 flush） |

**通信协议扩展**：

```
// 新增消息路径
/sensor_data  → 手表→手机，批量心率数据
/time_sync    → 双向，时钟同步

// sensor_data 格式
{
  "type": "sensor_batch",
  "session_id": "uuid",
  "samples": [
    {"ts": 1712956800000, "hr": 145},
    {"ts": 1712956801000, "hr": 148},
    ...
  ]
}

// time_sync 格式（手机发起）
{
  "type": "time_sync_request",
  "phone_time": 1712956800000
}
// 手表回复
{
  "type": "time_sync_response",
  "phone_time": 1712956800000,
  "watch_time": 1712956800350   // 偏移 350ms
}
```

### watchOS 实现 (ios/BlinkLifeWatch/)

| 新增类 | 职责 |
|--------|------|
| `HeartRateCollector.swift` | 使用 HealthKit HKWorkoutSession 订阅心率 |
| `SessionManager.swift` | Session 生命周期 |
| `SensorDataSender.swift` | 通过 WCSession.transferUserInfo 批量传输 |

### Flutter 侧接收

| 修改文件 | 变更 |
|---------|------|
| `watch_communication_service.dart` | 新增 `onSensorBatch` Stream，处理 `/sensor_data` 消息 |
| `dot_input_manager.dart` | 新增 `_onSensorBatch()` 方法，写入 DB |

### 依赖

| 依赖 | 说明 |
|------|------|
| 模块 1（数据模型） | SensorSample 模型和 DB 表 |
| WearOS Health Services API | 需要 Wear OS 3.0+，需声明 BODY_SENSORS 权限 |
| watchOS HealthKit | 需要 HealthKit entitlement + 用户授权 |

### 风险

| 风险 | 缓解 |
|------|------|
| 心率传感器不同手表硬件差异大 | 只采集心率（最通用），不采集加速度计原始数据 |
| 批量传输数据量大（30 秒 = 30 条） | JSON 压缩，每条仅 ts+hr 两个字段，30 条约 1KB |
| HealthKit 用户拒绝授权 | 降级：QualityState.heart_rate = unavailable，复盘页隐藏心率模块 |
| 手表电量消耗增加 | 心率传感器本身功耗低（手表运动模式标配），主要注意传输频率 |

### 当前阶段是否必须实现

**是。心率是复盘页 MVP 的核心数据源。**

### 验收点

- [ ] WearOS：录制 30 分钟，心率数据完整传回手机（覆盖率大于 90%）
- [ ] watchOS：同上
- [ ] 时钟偏移计算结果在 ±2 秒以内
- [ ] 手表端功耗：30 分钟采集电量下降不超过 5%
- [ ] 用户拒绝 HealthKit 授权后不崩溃，优雅降级

---

## 模块 3：同步落库

### 目标

手表传回的心率数据和 Session 事件，经过清洗后写入本地 SQLite，同时计算并存储 QualityState。

### 输入输出

| 输入 | 输出 |
|------|------|
| WatchCommunicationService.onSensorBatch | sensor_samples 表中的数据行 |
| Session 生命周期事件 | sessions 表记录 |
| time_sync 偏移量 | sessions.clock_offset_ms |
| - | quality_states 表记录 |

### 新增 Service

| 文件 | 职责 |
|------|------|
| `lib/services/sensor_data_service.dart` | 统一管理传感器数据写入/查询/聚合 |

### 核心方法

```
SensorDataService (单例)
  │
  ├── writeBatch(sessionId, List of SensorSample)
  │     → 批量写入 sensor_samples 表
  │     → 异常值过滤（心率超过 0-220 范围标记 degraded）
  │
  ├── getHeartRateSeries(sessionId) → List of (timestamp, hr)
  │     → 查询 + 过滤 quality_flag != unavailable
  │
  ├── getAggregates(sessionId) → {avgHR, maxHR, minHR, totalDistance}
  │     → 聚合统计
  │
  ├── computeQualityState(sessionId, dataType) → QualityState
  │     → 计算覆盖率 = sample_count / expected_count
  │     → 检测缺失区间（连续 30 秒无数据 = missing_range）
  │     → 设置 quality_level: 覆盖率大于80%=good, 40-80%=degraded, 低于40%=unavailable
  │
  └── cleanup(sessionId)
        → 清除过期/临时数据
```

### 依赖

| 依赖 | 说明 |
|------|------|
| 模块 1（数据模型） | SensorSample, QualityState 模型 |
| 模块 2（手表采集） | 数据输入源 |
| database_service.dart | DB 读写 |

### 风险

| 风险 | 缓解 |
|------|------|
| 批量写入 I/O 阻塞 UI | 使用 sqflite 的 batch 事务 + compute isolate |
| 数据重复写入（手表重传） | sensor_samples 用 (session_id, timestamp) 做 UNIQUE 约束，INSERT OR IGNORE |
| QualityState 计算耗时 | 延迟到录制结束后一次性计算，不实时 |

### 当前阶段是否必须实现

**是。采集了不落库等于没采集。**

### 验收点

- [ ] 30 分钟录制的 1800 条心率数据全量写入，无丢失
- [ ] 重复数据不报错（INSERT OR IGNORE）
- [ ] QualityState 计算结果正确（手动制造断点验证覆盖率和 missing_ranges）
- [ ] 聚合查询（avgHR, maxHR）耗时低于 200ms

---

## 模块 4：时间轴对齐

### 目标

保证手表打点时间、手表心率时间、手机视频时间三条时间线可以精确对齐，使"点击第 12 分钟心率峰值"能准确跳转到视频第 12 分钟画面。

### 输入输出

| 输入 | 输出 |
|------|------|
| Session.clock_offset_ms（手表-手机偏移） | 对齐后的 display_time |
| RecordingRecord.recordingStartTime | ReplayAnchor.display_time |
| 视频 creation_time 元数据 | - |
| RecordingData.alignOffsetMs（手动对齐偏移） | - |

### 对齐公式

```
// 手表事件 → 视频时间
watch_event_time_in_video =
  (watch_event_timestamp - clock_offset_ms)   // 校正为手机时间
  - actualRecordingStartTime                   // 减去录制开始时间
  + alignOffsetMs                              // 加手动对齐偏移

// 其中
actualRecordingStartTime = video_creation_time - video_duration
```

### 实现位置

| 修改文件 | 变更 |
|---------|------|
| `lib/services/video_metadata_service.dart` | 新增 `alignWatchTime(watchTimestamp, clockOffset, startTime, alignOffset) → Duration` |
| `lib/models/replay_anchor.dart` | `ReplayAnchor.fromEvent()` / `ReplayAnchor.fromHeartRatePeak()` 工厂方法内置对齐计算 |

### 依赖

| 依赖 | 说明 |
|------|------|
| 模块 2 的 time_sync | clock_offset_ms 值 |
| 现有 VideoMetadataService | creation_time 获取 |
| 现有 alignOffsetMs 机制 | 手动对齐偏移 |

### 风险

| 风险 | 缓解 |
|------|------|
| 运动中手表时钟漂移 | 录制首尾各同步一次，取平均；漂移超过 3 秒标记 QualityState.session = degraded |
| 视频缺少 creation_time | 前置检查已有（VideoMetadataService.hasCreationTime），失败时禁止跳转 |
| 多路偏移叠加误差放大 | 单元测试覆盖：给定已知偏移，验证最终 display_time 精度在 ±1 秒 |

### 当前阶段是否必须实现

**是。对齐不准 = 跳转错位 = 体验崩溃。**

### 验收点

- [ ] 手表打点 + 手机录制，打点视频时间对齐误差在 ±2 秒以内
- [ ] 心率峰值跳转到视频对应时间，画面与峰值时刻匹配
- [ ] 无 creation_time 的视频，跳转按钮灰显 + 提示文案
- [ ] 单元测试：给定 clock_offset=500ms, alignOffset=2000ms，验证计算结果

---

## 模块 5：复盘页消费

### 目标

构建复盘页 UI（5 个模块）+ ReplayAnchor 联动回放页。

### 输入输出

| 输入 | 输出 |
|------|------|
| Session + EventMarker + SensorSample + QualityState | 复盘页 5 个模块 UI |
| ReplayAnchor | 跳转回放页的导航参数 |

### 新增文件

| 文件 | 职责 |
|------|------|
| `lib/screens/review_page.dart` | 复盘页主容器 |
| `lib/widgets/review_overview_card.dart` | 总览卡片 |
| `lib/widgets/review_event_distribution.dart` | 事件分布图 |
| `lib/widgets/review_heart_rate_chart.dart` | 心率趋势曲线 |
| `lib/widgets/review_ai_summary.dart` | AI 摘要卡片 |
| `lib/widgets/review_recommended_clips.dart` | 推荐片段列表 |
| `lib/services/review_data_service.dart` | 复盘页数据聚合 Service |

### ReviewDataService 核心方法

```
ReviewDataService
  │
  ├── loadReviewData(sessionId) → ReviewPageData
  │     → 聚合 Session + Events + Sensor + Quality
  │     → 一次性加载，避免多次 DB 查询
  │
  ├── getEventDistribution(sessionId) → List of (time, type, confidence)
  │
  ├── getHeartRateSeries(sessionId) → List of (time, hr, quality)
  │     → 断点标记（连续 unavailable 超过 30s 插入 null 值画虚线）
  │
  ├── getRecommendedClips(sessionId, limit: 5) → List of ReplayAnchor
  │     → 排序: confidence x weight，心率峰值关联加权
  │
  └── buildReplayAnchor(event/peak/segment) → ReplayAnchor
        → 内置时间对齐计算
```

### 回放页改动

| 修改文件 | 变更 |
|---------|------|
| `lib/screens/review_detail_page.dart` | 构造函数新增 `replayAnchor` 和 `replayAnchors` 可选参数 |
| `lib/screens/review_detail_page.dart` | initState 检测锚点 → 自动 seek + 高亮 |
| `lib/screens/review_detail_page.dart` | 集合浏览模式：上/下条在锚点列表内导航 |

### 降级渲染逻辑

```
渲染每个模块前:
  quality = QualityStateService.get(sessionId, dataType)
  
  if quality.level == unavailable:
    → 隐藏该模块（不显示占位符）
  elif quality.level == degraded:
    → 显示模块 + 标注"数据不完整"
    → 曲线断点用虚线
  else:
    → 正常渲染
```

### 依赖

| 依赖 | 说明 |
|------|------|
| 模块 1-4 全部 | 数据模型 + 采集 + 落库 + 对齐 |
| 现有回放页 | 跳转目标 |

### 风险

| 风险 | 缓解 |
|------|------|
| 复盘页做成回放页副本 | 复盘页禁止视频播放器，严格通过 ReplayAnchor 跳转 |
| 心率曲线渲染性能（5400 点） | 降采样到 100-200 个点做可视化，保留原始数据做聚合 |
| 集合浏览模式与现有回放页冲突 | 新增 _browseMode 状态变量，独立控制上/下条导航逻辑 |

### 当前阶段是否必须实现

**是。但仅实现 5 个 MVP 模块。**

### 验收点

- [ ] 复盘页入口：回放页更多菜单 + 首页卡片
- [ ] 总览卡片数据正确（时长/打点数/心率均值/峰值）
- [ ] 事件分布图点击 → 跳转回放页正确 seek
- [ ] 心率趋势：断点虚线显示，峰值可点击跳转
- [ ] AI 摘要生成完成，包含数据来源标注
- [ ] 推荐片段缩略图显示，点击跳转 + 一键剪辑
- [ ] 心率覆盖率低于 40% 时心率模块隐藏
- [ ] 无视频时跳转按钮灰显

---

## 模块 6：AI 约束层

### 目标

定义 AI 摘要的生成规则，确保输出不超出数据依据。第一版不做 ML 模型，使用规则模板 + LLM prompt 生成。

### 输入输出

| 输入 | 输出 |
|------|------|
| Session 元数据 | 2-4 句训练摘要 |
| EventMarker 统计 | 高光推荐排序 |
| 心率聚合 (avg/max/zone 分布) | 强度评价句 |
| QualityState | 输出约束 |

### 新增文件

| 文件 | 职责 |
|------|------|
| `lib/services/ai_review_service.dart` | AI 摘要生成 Service |

### 生成规则

```
AiReviewService.generateSummary(ReviewPageData data) → AiSummary

Step 1: 检查数据充分性
  if data.events.isEmpty → return "本场未记录到事件，建议下次录制时更频繁标记"
  if data.session.duration 低于 15分钟 → 简短版摘要（仅统计）

Step 2: 生成训练概况句
  模板: "本场{sportType}训练 {duration} 分钟，共标记 {totalEvents} 个事件"
  补充: 打点构成（"其中射门 8 次、犯规 3 次"）

Step 3: 生成强度评价句（依赖心率）
  前置: quality_states.heart_rate.level != unavailable
  模板: "整体强度{level}，{zone_pct}% 时间处于{zone_name}区"
  缺失: 跳过此句

Step 4: 生成高光推荐句
  前置: events.length 大于等于 3
  模板: "推荐查看第 {time} 分钟的{action}，当时心率达到 {hr} bpm"
  缺失: "事件较少，无法生成高光推荐"

Step 5: 生成节奏/建议句
  前置: session.duration 大于等于 30分钟 且 events.length 大于等于 5
  计算: 前半段 vs 后半段事件密度
  模板: "上半场事件密集，下半场节奏放缓" 或 "全场节奏均匀"
  缺失: 跳过此句

Step 6: 附加数据来源标注
  "基于 {eventCount} 个打点事件和 {hrCoverage}% 心率数据生成"
```

### AI 输出格式

```
AiSummary {
  paragraphs: List[string]       // 2-4 段文字
  data_source_note: string       // "基于 23 个打点事件和 87% 心率数据"
  confidence: double             // 综合可信度
  recommended_anchors: List[ReplayAnchor]  // 推荐的回看锚点
}
```

### 禁止规则（硬编码到 prompt/模板）

| 禁止模式 | 检测方式 |
|---------|---------|
| "因为...所以..." | 正则过滤因果连接词 |
| "你应该..." | 禁止指令性建议 |
| "质量下降/提升" | 无基线数据不做对比 |
| "比上次/上周..." | MVP 不做跨场次对比 |
| 精确数值（HR 覆盖率低于 80%） | 检查 QualityState，低覆盖率用"约" |

### 依赖

| 依赖 | 说明 |
|------|------|
| 模块 3（落库） | 聚合数据输入 |
| 模块 5（复盘页） | 展示 AI 摘要的 Widget |
| QualityState | 控制哪些句子可以生成 |

### 风险

| 风险 | 缓解 |
|------|------|
| 模板化文案用户感觉"不够智能" | 预留 LLM 接口，第一版用模板，后续接 Claude API |
| 生成内容超出数据依据 | 每步生成前 check QualityState，缺数据则 skip |

### 当前阶段是否必须实现

**部分必须。** 模板化摘要 + QualityState 约束必须实现。LLM 接口预留但不实现。

### 验收点

- [ ] 有打点+有心率：生成 4 句摘要，包含概况/强度/高光/节奏
- [ ] 有打点+无心率：生成 2 句摘要，跳过强度评价
- [ ] 打点少于 3 个：不推荐高光，显示引导文案
- [ ] 训练短于 15 分钟：仅统计，不分析节奏
- [ ] 摘要末尾包含数据来源标注
- [ ] 无因果连接词、无指令性建议、无跨场次对比

---

## 模块依赖关系

```
模块 1 (数据模型)
  │
  ├──→ 模块 2 (手表采集)
  │       │
  │       └──→ 模块 3 (同步落库)
  │               │
  │               ├──→ 模块 4 (时间轴对齐)
  │               │       │
  │               │       └──→ 模块 5 (复盘页消费)
  │               │               │
  │               │               └──→ 模块 6 (AI 约束)
  │               │
  │               └──→ 模块 6 (AI 约束 - QualityState 输入)
  │
  └──→ 模块 4 (ReplayAnchor 模型)
```

**可并行的组合**：
- 模块 1 + 模块 2 的 WearOS/watchOS 原生开发可并行
- 模块 4 + 模块 6 的规则定义可并行
- 模块 5 的 UI 骨架可在模块 3 完成前用 mock 数据先搭

---

## 总验收清单

| # | 验收项 | 模块 |
|---|--------|------|
| 1 | DB v14 迁移成功，旧数据兼容 | 1 |
| 2 | WearOS 心率采集 30 分钟覆盖率大于 90% | 2 |
| 3 | watchOS 心率采集 30 分钟覆盖率大于 90% | 2 |
| 4 | 时钟偏移在 ±2 秒以内 | 2, 4 |
| 5 | 传感器数据批量写入无丢失 | 3 |
| 6 | QualityState 覆盖率计算正确 | 3 |
| 7 | 手表打点→视频跳转对齐误差在 ±2 秒 | 4 |
| 8 | 复盘页 5 个模块渲染正确 | 5 |
| 9 | 点击事件/心率峰值→回放页跳转精确 | 5 |
| 10 | 心率覆盖率低于 40% 时心率模块隐藏 | 5 |
| 11 | AI 摘要包含数据来源标注 | 6 |
| 12 | AI 摘要无因果推断和指令性建议 | 6 |
