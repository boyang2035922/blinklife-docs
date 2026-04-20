---
title: 数据模型字典
sidebar_position: 1
description: "BlinkLife 核心数据模型（RecordingRecord/ClipRecord/FavoriteRecord/PlaybackSession/UserModel/Session/SensorSample）全字段说明"
---

# 数据模型字典

> BlinkLife 的 6 个核心数据模型及其完整字段说明。

## RecordingRecord（录制记录）

源文件：`lib/models/recording_record.dart`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | int? | null | DB 自增主键 |
| videoPath | String | - | 视频文件路径 |
| jsonPath | String | - | .blink 打点文件路径 |
| thumbnailPath | String | - | 缩略图路径 |
| sportType | String | - | 运动类型 |
| createdAt | DateTime | - | 创建时间 |
| recordingStartTime | DateTime | - | 录制开始时间 |
| totalDots | int | - | 打点总数 |
| duration | Duration | - | 录制时长 |
| name | String | '' | 录制名称 |
| recordType | int | 1 | 1=录制+打点, 2=仅打点, 3=外部导入 |
| tempVideoPath | String? | null | 相机临时路径 |
| copyComplete | bool | true | 后台拷贝完成标志 |
| inputSources | `List<String>?` | null | 输入源 JSON 数组 |
| cloudId | String? | null | 云端 UUID |
| syncStatus | int | 0 | 0=未同步, 1=已同步, 2=待更新 |
| isPortrait | bool | false | 竖版视频标志 |
| fileUuid | String? | null | `.blink` 文件 UUID v7（Timeline v2 身份），由 `RecordingIdentity.forNew()` 生成 |
| specVersion | int | 2 | `.blink` 内容版本（2=v2, 3=v3/Tracks+Events） |

### DotRecord（打点事件）

嵌套在 recording_record.dart 中。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 默认=recordingTime.inMilliseconds |
| action | String | 动作类型（语义化 `markerType`，可修改） |
| timestamp | DateTime | 绝对 UTC 时间 |
| recordingTime | Duration | 相对录制时间 |
| inputSource | String | `ble_ring` / `screen_tap` / `screen_double_tap` / `crown_cw` / `crown_ccw` / `action_button` / `double_tap` / `gesture` / `manual`（事实不可改） |
| markerNameSnapshot | String? | 打点时的动作名称快照（映射版本绑定） |
| mappingVersion | int | 0 | 映射规则版本号 |
| heartRateSnapshot | int? | 打点瞬间心率快照（来自 Watch） |
| speedSnapshot | double? | 打点瞬间速度快照（来自 Watch） |

### RecordingData（JSON 持久化）

| 字段 | 类型 | 说明 |
|------|------|------|
| sportType | String | 运动类型 |
| startTime / endTime | DateTime | 录制起止时间 |
| duration | Duration | 总时长 |
| dotRecords | `List<DotRecord>` | 打点列表 |
| dotCounts | `Map<String,int>` | 按动作统计 |
| totalDots | int | 总数 |
| recordType | int | 录制类型 |
| alignOffsetMs | int? | 对齐偏移 (ms) |
| inputSources | `List<String>?` | 输入源列表 |
| fileUuid | String | UUID v7 身份标识（新建必须） |
| ownerUserId | String? | 归属用户 UUID v7（登录态） |
| ownerGuestId | String? | 归属游客 UUID v7（未登录态，登录后 `claimGuestData` 过户） |
| specVersion | int | 2/3 — Timeline 内容规范版本 |
| tracks | `List<Track>?` | v3 Tracks 轨道（心率/步数/速度…） |
| events | `List<Event>?` | v3 Events 列表（打点），与 `legacy.dotRecords` 镜像 |

## Session（Watch 会话）

源文件：`lib/models/session.dart`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | UUID（Watch/手机侧生成，两端一致） |
| startTime / endTime | DateTime | 会话起止 |
| sportType | String | 运动类型 |
| deviceSources | `List<String>` | `['watch']` / `['phone']` / 混合 |
| status | SessionStatus | active / completed / aborted |
| recordingId | int? | 关联 `RecordingRecord.id`（独立打点结束时回填） |
| vo2max | double? | Session 摘要：最大摄氧量（watch 端计算） |
| lactateThresholdHr | int? | Session 摘要：乳酸阈心率 |

## SensorSample（传感器采样）

源文件：`lib/models/sensor_sample.dart`

| 字段 | 类型 | 说明 |
|------|------|------|
| sessionId | String | 归属 Session |
| timestamp | DateTime | 采样时刻（Watch 本地时钟） |
| heartRate | int? | bpm |
| stepCountIncrement | int? | 增量步数 |
| distanceIncrement | double? | 增量距离（m） |
| speed | double? | 瞬时速度（m/s） |
| caloriesIncrement | double? | 增量卡路里（kcal） |
| latitude / longitude / altitude | double? | GPS（可缺） |

`WatchCommunicationService._autoStoreSensorBatch` 是持久监听，收到 `sensor_batch` 即写 DB，不依赖 recording_page 在前台。

## ClipRecord（剪辑记录）

源文件：`lib/models/clip_record.dart`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | int? | null | DB 自增主键 |
| recordingId | int | - | 关联录制 ID |
| actionType | String | - | 动作类型 |
| actionCount | int | - | 合并的动作数 |
| videoPath | String | - | 剪辑视频路径 |
| thumbnailPath | String | - | 缩略图路径 |
| startTime | Duration | - | 原视频中的开始时刻 |
| endTime | Duration | - | 原视频中的结束时刻 |
| duration | Duration | - | 片段时长 |
| createdAt | DateTime | - | 创建时间 |
| taskId | String? | null | 批次任务 ID |
| status | int | 2 | 0=pending,1=processing,2=completed,3=failed |
| isPortrait | bool | false | 竖版标志 |

## FavoriteRecord（收藏记录）

源文件：`lib/models/favorite_record.dart`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int? | DB 主键 |
| targetType | String | 'clip' |
| clipId | int? | 关联剪辑 ID |
| recordingId | int? | 关联录制 ID |
| category | String | 分类（默认 'later'） |
| note | String? | 备注 |
| weight | int | 权重 |
| createdAt | DateTime | 创建时间 |

## PlaybackSession（播放会话状态）

源文件：`lib/models/playback_session.dart`

| 字段 | 类型 | 通知方式 | 说明 |
|------|------|---------|------|
| position | `ValueNotifier<Duration>` | ~10Hz | 播放位置 |
| totalDuration | Duration | ChangeNotifier | 总时长 |
| isPlaying | bool | ChangeNotifier | 播放中 |
| isScrubbing | bool | ChangeNotifier | 拖拽中 |
| driveSource | PlaybackDriveSource | ChangeNotifier | 驱动源 |
| selectedDotId | int? | ChangeNotifier | 选中打点 |
| selectedClipId | int? | ChangeNotifier | 选中片段 |
| mode | TimelineMode | ChangeNotifier | 全部/仅高光 |

## UserModel（用户）

源文件：`lib/models/user_model.dart`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 用户 ID |
| nickname | String? | 昵称 |
| avatarUrl | String? | 头像 URL |
| phone | String? | 手机号 |
| createdAt | DateTime | 注册时间 |

## 相关文档

- [数据库 Schema](../engineering/database-schema) — SQL 表结构
- [事件模型](../engineering/event-model) — DotRecord 业务逻辑
- [RecordingData 格式](recording-data-format) — JSON 示例
