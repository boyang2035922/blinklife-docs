---
title: 数据存储与云同步方案
sidebar_position: 12
description: "三层数据分级存储 + 软删除保护 + 传感器数据同步策略 + 数据恢复机制"
---

# 数据存储与云同步方案

> 定义 BlinkLife 的数据分级存储策略、云同步架构和删除保护机制。核心原则：**视频可丢（用户能重拍），打点和传感器数据不可丢（无法重现）**。

---

## 一、当前问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | 删除录制时本地硬删除，不可恢复 | 用户误删 = 打点数据永久丢失 |
| 2 | 删除时未调用 `deleteCloudRecording()`（代码已定义但未使用） | 云端残留孤立数据 |
| 3 | 收藏片段随剪辑文件级联删除 | 用户收藏的"代表作"可能被误删 |
| 4 | 传感器数据（心率/速度/距离）目前不存在，需规划存储和同步方案 | - |
| 5 | 云端只存 dotRecordsJson 原文，无结构化查询能力 | 无法做云端数据分析/跨设备恢复 |

---

## 二、数据分级

按**可替代性**和**体积**将数据分三级：

```
┌─────────────────────────────────────────────┐
│  Level 1: 不可替代数据（必须云备份）          │
│  打点事件 · 传感器采样 · Session 元数据       │
│  体积小（一场约 200KB）                      │
├─────────────────────────────────────────────┤
│  Level 2: 可重新生成数据（仅本地）           │
│  剪辑片段 · 缩略图 · 高光合集                │
│  体积中（一场约 50-200MB）· 可由 L1+视频重建 │
├─────────────────────────────────────────────┤
│  Level 3: 大体积原始素材（仅本地）           │
│  原始录制视频                                │
│  体积大（一场约 1-15GB）· 用户可自行管理     │
└─────────────────────────────────────────────┘
```

### 各级数据的存储策略

| 级别 | 内容 | 本地存储 | 云端存储 | 删除策略 |
|------|------|---------|---------|---------|
| L1 | 打点事件、传感器采样、Session、QualityState | SQLite + .blink 文件 | 云端数据库（必须同步） | 软删除（本地标记 deleted，云端归档 90 天） |
| L2 | 剪辑片段、缩略图、收藏记录 | 文件系统 + SQLite | 不同步（可由 L1+视频重建） | 硬删除（删文件+DB 记录） |
| L3 | 原始录制视频 | 文件系统（Movies/BlinkLife/） | 不同步 | 硬删除（用户主动管理） |

---

## 三、云同步架构

### 同步范围

```
同步到云端的数据（L1）:
  ├── Session 元数据（时长、运动类型、设备来源）
  ├── 打点事件全量 JSON（加密的 dotRecordsJson）
  ├── 传感器聚合数据（平均心率、峰值心率、总距离、心率区间分布）
  ├── QualityState（数据质量报告）
  └── 删除/归档状态

不同步的数据（L2+L3）:
  ├── 视频文件（体积过大）
  ├── 剪辑片段文件
  ├── 缩略图文件
  └── 收藏/高光合集（可由 L1 重建）
```

### 传感器数据的同步策略

**核心权衡**：原始 SensorSample 一场 5400 条（约 150KB JSON），同步全量还是聚合？

**推荐方案：同步聚合 + 原始数据可选**

| 数据 | 同步方式 | 理由 |
|------|---------|------|
| 心率聚合（avg/max/min/zone分布） | 必须同步 | 10 个数值，几百字节 |
| 速度聚合（avg/max/总距离） | 必须同步 | 同上 |
| 原始 SensorSample 序列 | 可选同步（WiFi 下后台） | 150KB/场，用于云端回看趋势 |
| QualityState | 必须同步 | 几百字节，控制云端展示降级 |

理由：
- 聚合数据足够支撑"跨设备查看历史训练概况"
- 原始序列仅在"云端重新绘制心率曲线"时需要，可延迟同步
- WiFi 下后台同步原始数据，不消耗移动流量

### 后端模型扩展

```prisma
model CloudRecording {
  // 现有字段保持不变
  id               String   @id @default(uuid())
  userId           BigInt   @map("user_id")
  sportType        String   @map("sport_type")
  startTime        DateTime @map("start_time")
  endTime          DateTime @map("end_time")
  durationMs       Int      @map("duration_ms")
  totalDots        Int      @map("total_dots")
  recordType       Int      @map("record_type")
  inputSources     String?  @map("input_sources")
  dotRecordsJson   String   @map("dot_records_json")
  localRecordingId Int?     @map("local_recording_id")

  // 新增：传感器聚合数据
  avgHeartRate     Int?     @map("avg_heart_rate")
  maxHeartRate     Int?     @map("max_heart_rate")
  minHeartRate     Int?     @map("min_heart_rate")
  hrZoneJson       String?  @map("hr_zone_json")        // {"light":1200,"moderate":1800,...}
  totalDistance     Float?   @map("total_distance")       // 米
  avgSpeed         Float?   @map("avg_speed")             // m/s
  maxSpeed         Float?   @map("max_speed")             // m/s
  sensorSamplesJson String? @map("sensor_samples_json")  // 可选：原始序列（压缩）
  qualityJson      String?  @map("quality_json")          // QualityState JSON

  // 新增：软删除
  isDeleted        Boolean  @default(false) @map("is_deleted")
  deletedAt        DateTime? @map("deleted_at")

  createdAt        DateTime @default(now())
  updatedAt        DateTime @default(now()) @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, localRecordingId])
  @@index([userId, isDeleted, createdAt(sort: Desc)])
}
```

### 同步 Payload 扩展

```json
{
  "localRecordingId": 42,
  "sportType": "足球",
  "startTime": "2026-04-13T10:00:00Z",
  "endTime": "2026-04-13T11:30:00Z",
  "durationMs": 5400000,
  "totalDots": 23,
  "recordType": 1,
  "inputSources": "[\"ble_ring\",\"watch\"]",
  "dotRecordsJson": "{...encrypted...}",

  "avgHeartRate": 142,
  "maxHeartRate": 185,
  "minHeartRate": 68,
  "hrZoneJson": "{\"light\":1200,\"moderate\":1800,\"vigorous\":1500,\"max\":900}",
  "totalDistance": 8520.5,
  "avgSpeed": 1.58,
  "maxSpeed": 7.2,
  "qualityJson": "{\"heart_rate\":{\"level\":\"good\",\"coverage\":0.92},\"speed\":{\"level\":\"degraded\",\"coverage\":0.65}}"
}
```

---

## 四、删除保护机制

### 当前问题

```
用户点删除 → 本地硬删除一切 → 不可恢复
              ↓
          云端残留（bug: deleteCloudRecording 未调用）
```

### 新方案：分级删除

```
用户点删除
  │
  ├── L3 视频文件 → 硬删除（释放存储空间）
  ├── L2 剪辑/缩略图 → 硬删除
  ├── L1 本地 DB → 标记 is_deleted=true（保留 30 天）
  └── L1 云端 → 标记 is_deleted=true（保留 90 天）
```

### 本地软删除实现

**recording_records 表新增字段**（DB v15）：

```sql
ALTER TABLE recording_records ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recording_records ADD COLUMN deleted_at INTEGER;
```

**查询时默认过滤**：

```dart
// 所有现有查询加 WHERE is_deleted = 0
Future<List<RecordingRecord>> getAllRecordingRecords() async {
  final List<Map<String, dynamic>> maps = await db.query(
    'recording_records',
    where: 'is_deleted = 0',  // 新增
    orderBy: 'created_at DESC',
  );
  ...
}
```

**删除改为软删除**：

```dart
Future<void> softDeleteRecordingRecord(int id) async {
  await db.update(
    'recording_records',
    {'is_deleted': 1, 'deleted_at': DateTime.now().millisecondsSinceEpoch},
    where: 'id = ?', whereArgs: [id],
  );
}
```

**定期清理（30 天后硬删除）**：

```dart
Future<void> purgeDeletedRecords() async {
  final threshold = DateTime.now()
    .subtract(Duration(days: 30))
    .millisecondsSinceEpoch;
  // 仅清理 L1 本地记录，L3 文件已在软删除时删掉
  await db.delete(
    'recording_records',
    where: 'is_deleted = 1 AND deleted_at < ?',
    whereArgs: [threshold],
  );
}
```

### 删除流程改造

```
用户确认删除
  │
  ├── Step 1: 删除 L3 文件（视频、打点文件）→ 释放存储
  │
  ├── Step 2: 删除 L2 数据
  │     ├── 查询所有 clip_records → 删除视频+缩略图文件
  │     ├── 硬删除 clip_records DB 记录
  │     ├── 级联删除 favorites + highlight_album_items
  │     └── 刷新 FavoriteService 缓存
  │
  ├── Step 3: 软删除 L1 本地数据
  │     └── softDeleteRecordingRecord(id)  // 标记 is_deleted=1
  │
  ├── Step 4: 同步云端软删除（新增）
  │     └── ApiService.archiveCloudRecording(cloudId)
  │         // PUT /api/v1/recordings/:id/archive
  │
  └── Step 5: 导航回首页 + 刷新
```

### 云端归档 API（新增）

```
PUT /api/v1/recordings/:id/archive
  → 设置 is_deleted=true, deleted_at=now()
  → 不物理删除数据
  → 90 天后定时任务清理

PUT /api/v1/recordings/:id/restore
  → 设置 is_deleted=false, deleted_at=null
  → 用于未来"回收站"功能
```

---

## 五、数据恢复机制

### 恢复场景

| 场景 | 可恢复内容 | 不可恢复内容 |
|------|-----------|-------------|
| 用户误删（30 天内） | 打点数据 + 传感器聚合 + Session | 视频文件 + 剪辑片段 |
| 换手机/重装 App | 打点数据 + 传感器聚合 | 视频 + 剪辑 + 缩略图 |
| 清除 App 数据 | 同上（需登录同一账号） | 同上 |

### 恢复流程（未来功能，当前仅预留接口）

```
用户登录 → 检测云端有本地不存在的记录
  → 提示"发现 N 条云端记录，是否恢复？"
  → 确认 → 从云端下载 dotRecordsJson + 传感器聚合
  → 创建本地 recording_record（无视频，recordType 标记为 "cloud_restored"）
  → 复盘页可正常查看（事件分布 + 心率聚合 + AI 摘要）
  → 回放页降级（无视频，仅显示事件列表和时间轴）
```

### 恢复后的体验

| 功能 | 有视频时 | 仅 L1 恢复时 |
|------|---------|-------------|
| 复盘页总览 | 正常 | 正常 |
| 复盘页事件分布 | 正常 | 正常 |
| 复盘页心率趋势 | 正常（原始序列） | 仅聚合数值（无曲线，除非同步了原始序列） |
| 复盘页 AI 摘要 | 正常 | 正常（基于聚合数据） |
| 回放页视频播放 | 正常 | 不可用，提示"视频不在本地" |
| 回放页事件列表 | 正常 | 正常（可浏览，不可跳转视频） |
| 剪辑 | 正常 | 不可用 |

---

## 六、传感器数据本地存储

### sensor_samples 表的存储预算

| 参数 | 值 |
|------|------|
| 采样率 | 1Hz |
| 一场时长 | 90 分钟 = 5400 秒 |
| 每条记录字段 | session_id(8B) + timestamp(8B) + hr(4B) + speed(8B) + distance(8B) + lat/lng(16B) + quality(4B) = 约 56 字节 |
| 一场数据量 | 5400 x 56B = 约 300KB |
| 100 场 | 约 30MB |

**结论**：SQLite 完全能承载，不需要时序数据库。100 场数据约 30MB，对手机存储无压力。

### 清理策略

| 策略 | 触发条件 | 操作 |
|------|---------|------|
| 随录制删除 | 用户删除录制记录 | sensor_samples 随 session 一起软删除/硬删除 |
| 定期压缩 | 超过 6 个月的数据 | 降采样：1Hz → 0.1Hz（保留每 10 秒一个点） |
| 存储不足 | 设备可用空间低于 500MB | 提示用户清理旧训练数据 |

### sessions 表与 recording_records 的关系

```
recording_records (现有表，保持不变)
    │  1:1
    └── sessions (新增表)
            │  1:N
            ├── sensor_samples (新增表)
            ├── segments (新增表)
            └── quality_states (新增表)
```

**为什么不把 Session 字段直接加到 recording_records？**

1. recording_records 已有 18 个字段，继续加会膨胀
2. Session 有独立的生命周期（可暂停/恢复），复杂度高于 recording_records
3. 传感器数据通过 session_id 关联，不经过 recording_records，查询路径更短
4. 未来"无视频纯手表训练"场景，有 Session 无 RecordingRecord

**关联方式**：

```sql
-- sessions 表包含 recording_id 外键（可空）
-- 有视频时：session.recording_id = recording_records.id
-- 纯手表训练时：session.recording_id = NULL
```

---

## 七、同步时机与冲突处理

### 同步时机

| 时机 | 同步内容 | 网络要求 |
|------|---------|---------|
| 录制结束 | 打点 JSON + 传感器聚合 | 任意网络 |
| 打点编辑/删除 | 更新后的 dotRecordsJson | 任意网络 |
| 登录成功 | 全量同步未同步记录 | 任意网络 |
| 删除记录 | 云端归档请求 | 任意网络 |
| 后台空闲 | 原始 SensorSample 序列 | 仅 WiFi |
| App 启动 | 检查云端新数据（恢复场景） | 任意网络 |

### 冲突处理

当前采用**客户端优先**策略（单设备场景，无冲突风险）：

| 冲突类型 | 策略 |
|---------|------|
| 本地编辑 vs 云端旧数据 | 本地覆盖云端（客户端是唯一编辑入口） |
| 本地删除 vs 云端存在 | 云端归档（不物理删除） |
| 多设备同时编辑 | 暂不支持，未来用 last_write_wins + updatedAt |

---

## 八、修复现有 Bug

### Bug: deleteCloudRecording 未被调用

**现状**：`api_service.dart` 第 159-167 行定义了 `deleteCloudRecording()`，但 `review_detail_page.dart` 和 `history_page.dart` 的删除流程中从未调用。

**修复方案**：将删除改为云端归档。

```dart
// review_detail_page.dart _confirmDelete 中新增：
if (widget.record.cloudId != null) {
  // 不物理删除云端数据，改为归档
  ApiService().archiveCloudRecording(widget.record.cloudId!);
}
```

```dart
// api_service.dart 新增方法：
Future<bool> archiveCloudRecording(String id) async {
  try {
    await _dio.put('/recordings/$id/archive');
    return true;
  } on DioException catch (e) {
    debugPrint('归档云端记录失败: ${e.message}');
    return false;  // 失败不阻塞本地删除
  }
}
```

**原则**：云端归档失败不阻塞本地删除。用户体验优先，数据一致性通过后台补偿。

---

## 九、实施优先级

| 阶段 | 内容 | 与复盘页的关系 |
|------|------|-------------|
| **立即修复** | 调用 deleteCloudRecording / 改为归档 | 无关，独立 bug 修复 |
| **Step 1** | recording_records 加 is_deleted 字段 + 软删除改造 | 无关，但保护用户数据 |
| **Step 2** | 同步 payload 扩展（传感器聚合字段） | 与复盘页 Step 2 并行 |
| **Step 3** | 后端 CloudRecording 模型扩展 + archive/restore API | 与复盘页 Step 2 并行 |
| **Step 4** | 原始 SensorSample WiFi 后台同步 | 复盘页 MVP 后 |
| **未来** | 数据恢复/回收站功能 | 独立功能 |

---

## 十、风险

| # | 风险 | 缓解 |
|---|------|------|
| 1 | 软删除导致查询变慢（需过滤 is_deleted） | 加索引 `(is_deleted, created_at DESC)`，WHERE 条件写入所有查询 |
| 2 | 传感器聚合数据在客户端计算可能与云端不一致 | 聚合公式统一放在 SensorDataService，只算一次 |
| 3 | 原始序列同步体积增长 | WiFi only + 超过 6 个月降采样 |
| 4 | 云端归档 90 天后清理导致"永久丢失" | 清理前发推送通知，给用户恢复窗口 |
| 5 | 恢复的数据无视频，用户体验降级 | 明确提示"仅恢复训练数据，视频需重新录制" |

## 相关文档

- [数据库 Schema](database-schema) — 现有 v13 表结构
- [云同步架构](cloud-sync-architecture) — 现有同步逻辑
- [复盘页研发拆解](review-dev-breakdown) — 传感器数据的消费方
- [.blink 文件格式](blink-file-format) — 打点数据加密存储
