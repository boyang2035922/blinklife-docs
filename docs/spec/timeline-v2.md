---
title: Timeline v2 规范
sidebar_position: 3
description: "多轨道时间数据标准：Tracks + Events 双层模型 + .blink v3 文件格式 + v2 严格向下兼容"
---

# Timeline v2 规范

> 本文档是 BlinkLife「结构化时间数据」的合约权威源。实现者（Android / WatchOS / Wear / Web / Studio / iOS / 后端）必须遵守本规范的字段命名、类型、可选性和兼容协议。
>
> 本规范**严格向下兼容** Timeline v1（即现有 `dot_records[]` 扁平结构）。任何一端升级到 v2 都不得让现有 v1 客户端失去读写能力。

## 0. 术语与前提

| 术语 | 含义 |
|---|---|
| **Track** | 一类时间流的**声明**：记录这一维度（打点 / 心率 / 传感器 / AI / 同步标记 / 批注）的元数据 |
| **Event** | 时间流上的一条**数据**：扁平存储，每条带 `track_id` 指向所属 Track |
| **Source** | 事件的产生源：`screen_tap / crown_cw / crown_ccw / action_button / ble_ring / gesture / manual / ai_derived / sensor / remote_contributor` |
| **wall_utc** | UTC 墙钟时间（ISO8601 字符串），跨设备对齐的绝对基准 |
| **rec_rel_ms** | 相对录制开始的毫秒偏移（整数），用于时间轴渲染 |
| **device_monotonic_ns** | 设备单调时钟纳秒（整数），仅本地用于去抖 / 跨时钟校准 |
| **spec_version** | Timeline 规范版本号，形如 `"timeline/v2.0"`，SemVer 语义 |
| **file_uuid** | .blink 文件的 UUID v7，全局唯一，不随重写改变 |

**前提冻结**：
- 时间一律 UTC，ISO8601 字符串或毫秒整数
- 字段命名一律 `snake_case`
- 枚举值一律小写，连字符用 `_`（如 `ble_ring` 不是 `bleRing`）
- 数值一律整数（毫秒 / 计数），避免浮点精度问题
- JSON 空值语义：字段缺省 = 未知；`null` = 明确的空；区别见各字段说明

## 1. 设计原则（ADR）

### ADR-001：选择 Tracks + Events 双层模型

**背景**：v1 是扁平 `dot_records[]`，所有事件在同一数组。当要加心率（50Hz 连续采样）、传感器流、AI 候选事件时，扁平结构会把离散打点事件淹没，消费端每次都要按 action 过滤一轮。

**候选方案**：
1. **纯扁平 + tag**：所有事件在一个数组，每条带 `tag`。缺点：没有"这个文件有哪些维度"的声明，新维度发现只能靠扫全表。
2. **纯嵌套** `tracks[].events[]`：声明与数据耦合。缺点：跨设备增量合并要遍历所有 track 才能做一次 merge，协作采集时性能不可接受。
3. **Tracks + Events 双层**：Track 是声明（元数据 / schema 版本 / 采样率），Event 扁平数组按时间排序，每条带 `track_id`。**推荐**。

**决策**：采用方案 3。Track 解决"这个文件有什么维度"的声明问题；扁平 Event 数组解决"跨设备按时间合并"的性能问题。这也是 FIT、HealthKit Workout、Strava Stream 的共同事实形态。

**后果**：
- 消费端渲染时需 group by `track_id` 一次（代价 O(n)，可接受）
- 跨设备合并时可直接按 `wall_utc` 归并 Event 数组，不跨 track
- 未来加新 Track 类型（如 `golf.swing`）不需要改 schema 根

### ADR-002：向后严格兼容 v1

**背景**：用户明确要求"不能因升级导致现有功能不可用"。

**决策**：v3 文件必须同时维护 `legacy.*` 镜像（v1 的 `dot_records[]` 等字段）与 `tracks / events`。v1 客户端读 v3 时走 `legacy.*`；v2 客户端读 v1 时在内存态合成 `action` 轨道的 Events。

**后果**：v3 写入成本略增（要维护两份），但换来任一端不同步升级时系统不崩。见 §6。

### ADR-003：文件自证归属

**背景**：v1 `.blink` 文件头没有 owner 字段，所有权靠本地 SQLite `recording_records.user_id` 外挂。一旦文件脱离 SQLite 流转（导出 / 分享 / 备份恢复），归属信息丢失。

**决策**：v3 在明文 JSON 顶层加 `owner: { guest_id? / user_id? }` + `file_uuid`，文件自证归属。

**后果**：归属变更（如游客升级登录）需重写文件；幂等性由 `file_uuid` 保证，见 `ownership-and-sync-v1.md` §2。

## 2. 核心抽象

### 2.1 Track

```json
{
  "id": "track_action_default",
  "kind": "action",
  "schema_version": "1.0",
  "display_name": "打点",
  "input_sources": ["screen_tap", "ble_ring", "crown_cw", "gesture"],
  "sampling": { "mode": "discrete" },
  "metadata": {
    "mapping_version": 2,
    "marker_name_snapshot_refs": ["marker_射门", "marker_精彩"]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | Track 的唯一 ID，`track_<kind>_<slug>` 命名 |
| `kind` | string | 是 | 轨道类型，见 §3 内置目录；自定义类型用 reverse-DNS（如 `com.ext.golf.swing`） |
| `schema_version` | string | 是 | 该 kind 的 schema 版本，SemVer |
| `display_name` | string | 否 | 人类可读名称 |
| `input_sources` | string[] | 否 | 该 Track 允许的输入源白名单 |
| `sampling` | object | 否 | `{ mode: "discrete" \| "continuous", rate_hz?: number }` |
| `metadata` | object | 否 | 轨道级元数据，kind 相关 |

**约束**：
- 一个文件内 `track.id` 唯一
- 未知 `kind` 消费端**必须保留**（不可丢弃），渲染时可降级为不显示
- `sampling.mode=continuous` 的 Track 渲染时聚合为采样流而非离散 marker

### 2.2 Event

```json
{
  "track_id": "track_action_default",
  "type": "action.marker",
  "t_rel_ms": 12340,
  "t_abs_utc": "2026-04-17T10:23:45.340Z",
  "source": "ble_ring",
  "confidence": 0.95,
  "event_uuid": "01926f0a-3c4e-7b11-a123-abcdef012345",
  "payload": {
    "action": "射门",
    "marker_name_snapshot": "射门",
    "mapping_version": 2,
    "hr_snapshot_bpm": 152
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `track_id` | string | 是 | 所属 Track ID |
| `type` | string | 是 | 事件类型，格式 `<kind>.<subtype>`，见 §3 |
| `t_rel_ms` | int | 是 | 相对录制开始的毫秒偏移 |
| `t_abs_utc` | string | 是 | UTC ISO8601 墙钟时间 |
| `source` | string | 是 | 输入源，见 §5 枚举 |
| `confidence` | float | 否 | 置信度 0.0-1.0，人工事件默认 1.0；AI / 传感器事件必填 |
| `event_uuid` | string | 是 | UUID v7，跨端去重 / 同步幂等的唯一键 |
| `payload` | object | 是 | 类型特化数据，schema 见 §3 |

**约束**：
- `events[]` 按 `t_rel_ms` 升序；相同时刻按 `event_uuid` 字典序
- `confidence` 缺省等价于 1.0（历史打点默认置信）
- `event_uuid` 跨端幂等：同一事件多设备上报，后端按 uuid 去重

### 2.3 Source（输入源）

见 §5。一等公民但不作为独立对象——每 Event 通过 `source` 字段声明。

### 2.4 Clock（时钟）

见 §4。跨设备对齐的一等公民——文件层面通过 `meta.clock_offsets[]` 声明跨设备时钟偏移。

### 2.5 顶层文件结构

```json
{
  "spec_version": "timeline/v2.0",
  "file_uuid": "01926f0a-xxxx-7xxx-yxxx-xxxxxxxxxxxx",
  "owner": { "user_id": "01926f09-..." },
  "recording": {
    "sport_type": "football",
    "start_time": "2026-04-17T10:20:00.000Z",
    "end_time": "2026-04-17T11:15:00.000Z",
    "duration_ms": 3300000,
    "record_type": 1,
    "align_offset_ms": 0
  },
  "meta": {
    "created_by": { "device_id": "...", "app_version": "..." },
    "clock_offsets": [
      { "device_id": "watch_1", "offset_ms": -150 }
    ]
  },
  "tracks": [ /* Track[] */ ],
  "events": [ /* Event[] */ ],
  "attachments": [ /* optional: 视频 / 照片索引 */ ],
  "legacy": { /* v1 兼容镜像，见 §6 */ }
}
```

## 3. 内置轨道目录

首发必备（P0 / P1），其余 P2：

### 3.1 `action`（P0）

离散人工打点，兼容 v1 `DotRecord`。

- `type` 枚举：`action.marker`（通用）
- `payload` schema：
  ```json
  {
    "action": "射门",
    "marker_name_snapshot": "射门",
    "mapping_version": 2,
    "hr_snapshot_bpm": 152,
    "speed_snapshot_kmh": 18.5
  }
  ```
- `payload.action` 必填，其余可选
- `sampling.mode = "discrete"`

### 3.2 `biometric.heart_rate`（P1）

连续心率采样流。

- `type` 枚举：`biometric.hr.sample`
- `payload`: `{ "bpm": 152 }`
- `sampling.mode = "continuous"`, `rate_hz` 必填（典型 1）
- `source` 典型：`sensor`（手表 / 胸带）

### 3.3 `biometric.speed`（P1）

连续速度采样流。

- `type` 枚举：`biometric.speed.sample`
- `payload`: `{ "kmh": 18.5, "accuracy": 0.9 }`
- `sampling.mode = "continuous"`

### 3.4 `sync.marker`（P1）

跨设备时间校准信标。用于多设备协同场景下对齐时钟。

- `type` 枚举：`sync.beacon`
- `payload`: `{ "beacon_id": "uuid", "source_device_id": "watch_1" }`
- 消费端读取后计算 `clock_offsets[]`

### 3.5 `game.score`（P0：足球；P1+：篮/羽/乒/网扩展）

离散比分事件。手表或手机录制页记分面板触发。

- `type` 枚举：`game.score.update`
- `payload` schema：
  ```json
  {
    "side": "home",
    "score_delta": 1,
    "score_home_after": 1,
    "score_away_after": 0,
    "period_index": 0,
    "sport_type": "足球"
  }
  ```
- `payload.side` ∈ `"home" | "away"` 必填
- `payload.score_delta` ∈ `+1 | -1`（-1 = 撤销）必填
- `payload.score_{home,away}_after` 必填：事件发生后的比分，便于前向扫描无状态
- `payload.period_index` 上半场=0 / 下半场=1（其他运动按自己的分段意义）
- `payload.sport_type` 必填：跨运动分析锚点
- `sampling.mode = "discrete"`
- `source` 典型：`watch`（P0）/ `phone`（P1+ 手机记分面板）
- 一条 `delta=-1` 之前最近的同 `side` `+1` 视为被撤销，不参与候选高光

### 3.6 `highlight.candidate`（P0）

候选高光（由 ScoreMarkerLinker 基于 `action` + `game.score` 联动生成）。

- `type` 枚举：`highlight.candidate`
- `payload` schema：
  ```json
  {
    "anchor_event_uuid": "01926f0a-...",
    "linked_score_event_uuid": "01926f0a-...",
    "linked_marker_event_uuid": null,
    "clip_start_offset_ms": -15000,
    "clip_end_offset_ms": 8000,
    "status": "candidate",
    "priority": "normal",
    "ignored_reason": null,
    "confirmed_at": null
  }
  ```
- `payload.status` ∈ `"candidate" | "confirmed" | "ignored"`，语义：
  - `candidate`：记分自动生成，待用户确认
  - `confirmed`：用户点击"补为高光"后升级；或联动窗口命中打点时直接进入
  - `ignored`：用户主动忽略 / 被 `score_undo` 自动降级
- `payload.priority` ∈ `"critical" | "normal"`（P0 固定 `normal`；P1 羽/乒/网的局点/赛点 → `critical`）
- `payload.clip_*_offset_ms` 由运动类型决定默认值（足球 `-15s/+8s`）
- `payload.ignored_reason` 可选：`user_ignored` / `score_undo`
- `source` ∈ `"score_only" | "marker_only" | "linked"`
- `sampling.mode = "discrete"`
- **反向回写约束**：当 Candidate 命中 `linked_marker_event_uuid` 时，对应 MarkerEvent 的 `payload.linked_score_event_uuid` **必须**冗余写入同一 UUID，便于单条 Dot 快速查询"对应哪次记分"

### 3.7 `ai.moment`（P2 占位）

AI 复盘候选事件。首发仅预埋结构，模型上线后细化。

- `type` 枚举：`ai.moment.candidate`
- `payload`: `{ "suggested_type": "action.marker", "suggested_action": "射门", "raw_features": {} }`
- `confidence` 必填

### 3.8 `sensor.imu`（P2 占位）

IMU 传感器流。

- `type` 枚举：`sensor.imu.sample`
- `payload`: `{ "ax": 0.1, "ay": 0.2, "az": 9.8, "gx": 0.01, "gy": 0, "gz": 0 }`
- `sampling.rate_hz` 典型 50-100

### 3.9 `annotation`（P2 占位）

事后修正 / 批注。

- `type` 枚举：`annotation.correction` / `annotation.note`
- `payload`: `{ "target_event_uuid": "...", "correction": {} }` 或 `{ "text": "..." }`

### 3.10 轨道扩展

第三方 / 私有轨道使用 **reverse-DNS** 命名（如 `com.ext.golf.swing`）。未知 `kind` 消费端必须保留，渲染时降级为"未知轨道"占位或隐藏。

v1 / v2 客户端读取 v3 文件时会自动 fallback 到 `legacy.*` 扁平镜像（只含 action 轨道），未知 Track 对其不可见，不会导致崩溃。

## 4. 时间对齐模型

### 4.1 三时钟体系

| 时钟 | 用途 | 谁写 |
|---|---|---|
| `wall_utc` | 跨设备 / 跨文件对齐基准 | 采集设备根据系统时间 |
| `rec_rel_ms` | 时间轴渲染 | 事件组装层，= `wall_utc - recording.start_time` |
| `device_monotonic_ns` | 本地去抖 / 跨进程协调 | 仅事件产生瞬间捕获，**不进 .blink 文件** |

### 4.2 对齐公式

**渲染时显示时间**：
```
display_ms = event.t_rel_ms
           + recording.align_offset_ms         // 仅打点模式导入视频后的偏移
           + source_device_clock_offset_ms     // 跨设备偏移，从 meta.clock_offsets 查
```

- `align_offset_ms`：v1 已有字段，仅 `record_type=2`（仅打点后导入视频）场景生效
- `source_device_clock_offset_ms`：多设备场景（手机 + 手表 + BLE 戒指）每个设备 vs 主时钟的偏移

### 4.3 跨设备偏移计算

`meta.clock_offsets[]` 写入规则：
1. 每次跨设备数据汇入时，采集一轮 `sync.beacon` 交换
2. 主设备计算 `offset_ms = peer_wall_utc - main_wall_utc`（ping-pong RTT 减半）
3. 写入 `meta.clock_offsets`，精度 ±10ms 即可

### 4.4 recordType 对齐逻辑（兼容 v1）

| recordType | 含义 | 对齐方式 |
|---|---|---|
| 1 | 录制 + 打点（同端） | `wall_utc` 自动对齐 |
| 2 | 仅打点后导入视频 | 手动 `align_offset_ms` |
| 3 | 外部导入 | 自动 + 可选手动微调 |

## 5. 输入源归一

所有 Event 的 `source` 字段**必须**取自以下枚举：

| source | 说明 | 典型 track |
|---|---|---|
| `screen_tap` | 屏幕单击 | `action` |
| `screen_double_tap` | 屏幕双击 | `action` |
| `crown_cw` | 数码表冠顺时针 | `action` |
| `crown_ccw` | 数码表冠逆时针 | `action` |
| `action_button` | 实体侧键 | `action` |
| `ble_ring` | BLE 智能戒指 | `action` |
| `gesture` | 手势识别 | `action` |
| `manual` | 事后手动添加 | `action` / `annotation` |
| `ai_derived` | AI 推导 | `ai.moment` |
| `sensor` | 传感器采样 | `biometric.*` / `sensor.*` |
| `remote_contributor` | 协作采集（P3 预埋） | 任意 |

**兼容映射**（v1 `inputSource` → v2 `source`）：

| v1 值 | v2 值 |
|---|---|
| `watch` | `crown_cw`（默认）或根据 `payload.watch_gesture` 细化 |
| `ble_ring` | `ble_ring` |
| `gesture` | `gesture` |
| `manual` | `manual` |
| `screen` | `screen_tap` |

**合法 source → track 矩阵**：见附表 A（随规范迭代补齐，首发只需 `action` 轨道的合法性）。

## 6. .blink v3 文件格式

### 6.1 头部（与 v2 同形）

| 偏移 | 长度 | 内容 | 说明 |
|---|---|---|---|
| 0 | 4 | `0x42 0x4C 0x4E 0x4B` (`BLNK`) | Magic |
| 4 | 1 | `0x03` | 版本号（v2 为 `0x02`） |
| 5 | 16 | IV | AES-CBC 初始向量 |
| 21 | 32 | HMAC-SHA256 | 基于 **密文** 的 MAC（Encrypt-then-MAC） |
| 53 | N | Ciphertext | AES-256-CBC(明文 JSON) |

**关键**：头部结构与 v2 **完全同形**，仅版本号变。`BlinkCrypto.encrypt/decrypt` 接口无需改动，内部根据版本号分派。

### 6.2 明文 JSON 完整示例

```json
{
  "spec_version": "timeline/v2.0",
  "file_uuid": "01926f0a-8c4e-7b11-a123-abcdef012345",
  "owner": { "user_id": "01926f09-..." },
  "recording": {
    "sport_type": "football",
    "start_time": "2026-04-17T10:20:00.000Z",
    "end_time": "2026-04-17T11:15:00.000Z",
    "duration_ms": 3300000,
    "record_type": 1,
    "align_offset_ms": 0,
    "is_portrait": false
  },
  "meta": {
    "created_by": {
      "device_id": "ios_phone_abc",
      "app_version": "1.3.0",
      "platform": "ios",
      "os_version": "iOS 18.2"
    },
    "clock_offsets": []
  },
  "tracks": [
    {
      "id": "track_action_default",
      "kind": "action",
      "schema_version": "1.0",
      "display_name": "打点",
      "input_sources": ["ble_ring", "screen_tap"],
      "sampling": { "mode": "discrete" },
      "metadata": { "mapping_version": 2 }
    }
  ],
  "events": [
    {
      "track_id": "track_action_default",
      "type": "action.marker",
      "t_rel_ms": 12340,
      "t_abs_utc": "2026-04-17T10:20:12.340Z",
      "source": "ble_ring",
      "confidence": 1.0,
      "event_uuid": "01926f0a-3c4e-7b11-a123-aaaaaaaaaaaa",
      "payload": {
        "action": "射门",
        "marker_name_snapshot": "射门",
        "mapping_version": 2,
        "hr_snapshot_bpm": 152
      }
    }
  ],
  "legacy": {
    "sport_type": "football",
    "start_time": "2026-04-17T10:20:00.000Z",
    "end_time": "2026-04-17T11:15:00.000Z",
    "duration": 3300000,
    "record_type": 1,
    "align_offset_ms": 0,
    "input_sources": ["ble_ring"],
    "total_dots": 1,
    "dot_counts": { "射门": 1 },
    "dot_records": [
      {
        "id": 12340,
        "action": "射门",
        "timestamp": "2026-04-17T10:20:12.340Z",
        "recording_time": 12340,
        "input_source": "ble_ring",
        "marker_name_snapshot": "射门",
        "mapping_version": 2,
        "hr_snapshot_bpm": 152
      }
    ]
  }
}
```

### 6.3 v2 ⇄ v3 兼容协议

**v1 客户端读 v3**（不升级也能用）：
1. 解密得明文 JSON
2. 检测 `spec_version` 字段存在 → 走 `legacy.*` 读取路径
3. `legacy.dot_records[]` 即 v1 的原始结构，功能无损
4. 未知字段（`tracks / events / meta`）忽略

**v2 客户端读 v1**（兼容老文件）：
1. 解密得明文 JSON
2. 检测无 `spec_version` 字段 → 识别为 v1
3. 在内存态合成：
   - 一个 `track_action_default` Track
   - `v1.dot_records[]` 逐条转 Event：
     - `track_id = "track_action_default"`
     - `type = "action.marker"`
     - `t_rel_ms = dot.recording_time`（转毫秒）
     - `t_abs_utc = dot.timestamp`
     - `source = mapInputSource(dot.input_source)`（见 §5 兼容映射）
     - `event_uuid = uuid7()` 新生成（不持久化，仅内存态）
     - `confidence = 1.0`
     - `payload = { action, marker_name_snapshot, mapping_version, hr_snapshot_bpm? }`
4. 首次写回磁盘时升级为 v3

**v3 写入双写规则**：
1. **必须**同时维护 `legacy.*` 镜像与 `tracks/events`
2. `legacy.dot_records[]` 仅包含 `kind=action` 轨道的 Events（心率等新轨道不回灌，旧客户端感知不到新轨道 = 符合预期）
3. `legacy.total_dots` / `dot_counts` 基于 `action` 轨道重新聚合
4. 其余 `legacy.*` 字段从 `recording` 根镜像复制

**兼容矩阵**：

| 写入端 \ 读取端 | v1 读 | v2 读 |
|---|---|---|
| v1 写 | ✅ 原生 | ✅ 内存升级 |
| v2 写 | ✅ 走 legacy 路径 | ✅ 原生 |

### 6.4 BlinkCrypto 接口约束

- `BlinkCrypto.encrypt(jsonString, version=3)` —— 接口新增可选版本参数，默认写 `0x03`
- `BlinkCrypto.decrypt(bytes)` —— 自动识别 `0x02 / 0x03`，接口不变
- 加密算法（AES-256-CBC + HMAC-SHA256）不变
- 对称密钥派生策略不变

## 7. 扩展机制

### 7.1 Track kind 扩展

- 内置 kind（`action / biometric.* / sensor.* / ai.* / sync.* / annotation`）由本规范维护
- 第三方 kind 必须使用 reverse-DNS 命名（如 `com.ext.golf.swing`）
- 未知 kind 消费端**必须保留**（持久化时原样回写，不可丢弃）

### 7.2 schema_version 演进

- 每个 Track kind 独立维护 schema_version
- 增量非破坏变更（加可选字段）：次版本号递增，`1.0 → 1.1`
- 破坏性变更：主版本号递增，`1.x → 2.0`，必须同时升级 `spec_version`

### 7.3 未知字段处理

- **未知顶层字段**：保留原样回写
- **未知 Track `metadata` 字段**：保留
- **未知 Event `payload` 字段**：保留
- **未知 `type` 枚举**：保留 Event，渲染时降级为"未知事件"占位

## 8. 跨端序列化规范

### 8.1 类型映射

| JSON 类型 | Dart | Swift | Kotlin | TS |
|---|---|---|---|---|
| `string` | `String` | `String` | `String` | `string` |
| `int`（≤ 2^53） | `int` | `Int64` | `Long` | `number` |
| `float` | `double` | `Double` | `Double` | `number` |
| `bool` | `bool` | `Bool` | `Boolean` | `boolean` |
| ISO8601 时间字符串 | `DateTime`（parse） | `Date` | `Instant` | `Date` |
| 毫秒整数时间 | `int` | `Int64` | `Long` | `number` |
| `null` | 明确的空 | 明确的空 | 明确的空 | 明确的空 |
| 字段缺省 | 视同 null | 视同 nil | 视同 null | 视同 undefined |

### 8.2 命名与大小写

- 所有字段 `snake_case`
- 所有枚举值全小写 + `_` 分隔
- UUID 一律小写 + 连字符

### 8.3 可选性原则

- Track 的 `id / kind / schema_version` 必填，其余可选
- Event 的 `track_id / type / t_rel_ms / t_abs_utc / source / event_uuid / payload` 必填，`confidence` 可选（缺省=1.0）
- `payload` 内字段由各 kind schema 单独定义

## 9. 查询与消费 API（SDK 协议语义）

客户端 SDK 层应实现以下方法（不指定具体实现，只定协议）：

### 9.1 `query(filter): Event[]`

```
filter {
  track_ids?: string[]
  types?: string[]
  sources?: string[]
  t_rel_range_ms?: [int, int]
  confidence_min?: float
}
```

返回按 `t_rel_ms` 升序的 Events。复杂度 O(n)，无需索引。

### 9.2 `aggregate(track_id, window_ms): Aggregation[]`

连续轨道（`sampling.mode=continuous`）的窗口聚合（均值 / 最大 / 最小）。

### 9.3 `zip_by_time(track_ids, window_ms): ZippedFrame[]`

多轨道按时间对齐，用于"打点时刻的心率/速度"这类查询。返回每一 Event 为主点、各连续轨道最近邻插值的 ZippedFrame。

### 9.4 `upsert_event(event): void` / `delete_event(event_uuid): void`

按 `event_uuid` 幂等写入 / 删除。

## 10. 版本演进规则

| spec_version 变更 | 触发条件 | 兼容要求 |
|---|---|---|
| `2.0 → 2.1` | 加新 Track kind / 加可选字段 | 完全向后兼容 |
| `2.1 → 2.2` | 新增可选 Event 字段 | 完全向后兼容 |
| `2.x → 3.0` | 破坏性变更（改字段类型 / 删字段） | 必须重发 `file_uuid` + 新建文件 |

**破坏性变更**要求：
- 客户端必须能读旧版
- 新写入用新版
- 新老版文件互不覆盖

## 11. 采集系统对齐

本规范承接《BlinkLife 打点采集系统 v1.0》北极星与核心指标：

### 11.1 北极星指标映射

**单场有效事件数** = `events[]` 中满足以下条件的条目数：
- 有 `t_abs_utc`（非空）
- 有 `type`（非空）
- 有 `source`（枚举合法）
- `confidence >= 0.5`（或缺省视同 1.0）

SDK 提供 `countValidEvents(file): int` 便捷方法。

### 11.2 Fogg 模型（B = MAT）对规范的约束

| Fogg 维度 | 规范支持 |
|---|---|
| Ability（单击打点） | `action.marker` Event 产生只需 1 个字段（`action`），其余由 SDK 默认填充 |
| Ability（撤销） | `delete_event(event_uuid)` 幂等删除；或 `annotation.correction` 软撤销 |
| Ability（离线可用） | 规范不依赖网络；file_uuid 本地生成 |
| Trigger（自动检测） | `ai.moment` 轨道预埋（P2）|
| Motivation（即时回放） | `query(track_ids=['track_action_default'])` + UI 即可 |

### 11.3 confidence 语义

| confidence 范围 | 含义 | 典型来源 |
|---|---|---|
| 1.0 | 确定事件 | 人工打点（screen_tap / ble_ring / crown_* / gesture） |
| 0.5 - 1.0 | 高置信候选 | AI 推导、传感器检测 |
| 0.0 - 0.5 | 低置信候选 | AI 粗召回，需人工确认 |

消费端默认过滤 `confidence >= 0.5`；UI 提供"显示低置信候选"开关。

---

## 附录 A：v1 → v2 字段映射参考

| v1（`dot_records[]`） | v2（Event） |
|---|---|
| `id` | 不直接映射；`event_uuid` 由 SDK 生成 |
| `action` | `payload.action` |
| `timestamp` | `t_abs_utc` |
| `recording_time` | `t_rel_ms` |
| `input_source` | `source`（经 §5 兼容映射） |
| `marker_name_snapshot` | `payload.marker_name_snapshot` |
| `mapping_version` | `payload.mapping_version` |
| `hr_snapshot` | `payload.hr_snapshot_bpm` |
| `speed_snapshot` | `payload.speed_snapshot_kmh` |

## 附录 B：实现参考路径

- 加密头实现参考 `blinklife-android/lib/utils/blink_crypto.dart`
- v1 事件模型参考 `blinklife-android/lib/models/dot_record.dart`
- v1 文件读写参考 `blinklife-android/lib/services/file_service.dart:175-209`
- v1 输入源聚合参考 `blinklife-android/lib/utils/dot_input_manager.dart`
