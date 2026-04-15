---
title: 数据库 Schema
sidebar_position: 8
description: "SQLite 本地数据库 v15：9 个核心表 + 15 个版本的增量迁移历史"
---

# 数据库 Schema

> 本地 SQLite 数据库当前版本 v15，包含 9 个核心表。通过 sqflite 的 onUpgrade 回调管理增量迁移。

## 表结构

### recording_records（录制记录）

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | - |
| video_path | TEXT | NOT NULL | 视频文件路径 |
| json_path | TEXT | NOT NULL | .blink 打点文件路径 |
| thumbnail_path | TEXT | NOT NULL | 缩略图路径 |
| sport_type | TEXT | NOT NULL | 运动类型 |
| created_at | INTEGER | NOT NULL | 创建时间戳 (ms) |
| recording_start_time | INTEGER | NOT NULL | 录制开始时间戳 (ms) |
| total_dots | INTEGER | NOT NULL | 打点总数 |
| duration | INTEGER | NOT NULL | 录制时长 (ms) |
| name | TEXT | DEFAULT '' | 录制名称 |
| record_type | INTEGER | DEFAULT 1 | 1=录制+打点, 2=仅打点, 3=外部导入 |
| temp_video_path | TEXT | - | 相机临时文件路径 |
| copy_complete | INTEGER | DEFAULT 1 | 后台拷贝完成标志 |
| user_id | TEXT | - | 用户 ID（可空=游客） |
| input_sources | TEXT | - | JSON 数组 |
| cloud_id | TEXT | - | 云端 UUID |
| sync_status | INTEGER | DEFAULT 0 | 0=未同步, 1=已同步, 2=待更新 |
| is_portrait | INTEGER | DEFAULT 0 | 0=横版, 1=竖版 |

### clip_records（剪辑记录）

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | - |
| recording_id | INTEGER | NOT NULL, FK | 关联录制记录 |
| action_type | TEXT | NOT NULL | 动作类型 |
| action_count | INTEGER | NOT NULL | 合并的动作数 |
| video_path | TEXT | NOT NULL | 剪辑视频路径 |
| thumbnail_path | TEXT | NOT NULL | 缩略图路径 |
| start_time | INTEGER | NOT NULL | 开始时间 (ms) |
| end_time | INTEGER | NOT NULL | 结束时间 (ms) |
| duration | INTEGER | NOT NULL | 时长 (ms) |
| created_at | INTEGER | NOT NULL | 创建时间戳 |
| user_id | TEXT | - | 用户 ID |
| task_id | TEXT | - | 批次任务 ID |
| status | INTEGER | DEFAULT 2 | 0=pending,1=processing,2=completed,3=failed |
| is_portrait | INTEGER | DEFAULT 0 | 0=横版, 1=竖版 |

### favorites（收藏）

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | - |
| target_type | TEXT | NOT NULL | 'clip' |
| clip_id | INTEGER | FK | 关联剪辑 |
| recording_id | INTEGER | FK | 关联录制 |
| dot_id | INTEGER | - | 关联打点 |
| category | TEXT | DEFAULT 'later' | 分类 |
| note | TEXT | - | 备注 |
| weight | INTEGER | DEFAULT 0 | 权重 |
| source | TEXT | - | 来源 |
| created_at | INTEGER | NOT NULL | - |
| user_id | TEXT | - | - |
| ai_recommended | INTEGER | DEFAULT 0 | AI 推荐标志 |

UNIQUE: `(target_type, clip_id)`

### highlight_albums + highlight_album_items

合集管理表，通过 `UNIQUE(album_id, clip_id)` 防重复。

## 迁移历史

| 版本 | 变更 |
|------|------|
| v1-v7 | 基础表结构 |
| v8 | +user_id（两表） |
| v9 | +input_sources |
| v10 | +task_id, +status |
| v11 | +cloud_id, +sync_status |
| v12 | 新建 favorites + albums 表 |
| v13 | +is_portrait（两表） |
| v14 | +is_deleted, +deleted_at（软删除） |
| v15 | 新建 sessions + sensor_samples + segments + quality_states |

## 关键查询

| 方法 | 说明 |
|------|------|
| getClipBatches(recordingId) | GROUP BY task_id 聚合批次 |
| getClipRecordsByTaskId(taskId) | 按批次查询片段 |
| claimGuestData(userId) | 登录后关联游客数据 |
| cascadeDeleteClipFavorites(clipId) | 级联删除收藏 |

## 相关文档

- [模型字典](../data/model-dictionary) — Dart 模型字段映射
- [剪辑任务批次](clip-task-batch) — task_id 的写入和查询
