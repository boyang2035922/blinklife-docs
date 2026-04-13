---
title: 录制流程
sidebar_position: 1
description: "相机录制 + BLE/手表/手势三路打点 + rename 原子保存 + 后台 Isolate 拷贝"
---

# 录制流程

> 录制页同时管理相机录制和打点采集，支持 BLE 蓝牙指环、手表和屏幕手势三种打点输入方式，录制结束后优先使用 rename 原子保存（\<1ms），跨文件系统时退回 Isolate 后台拷贝。

## 用户旅程

```
首页 → 选择运动 → 录制页（预览）→ 开始录制 → 打点 → 停止录制 → 回放页
                                                              ↓
                                              保存失败 → 降级保存（仅打点）
```

## 页面状态

```
预览模式
  控制区: [方向] [翻转] [1080p] [30fps]
  ↓ 点击开始录制
录制模式
  控制区: [方向] [蓝牙状态] [● 时长]
  ↓ 点击停止 / App 切后台
保存中
  遮罩: "正在结束录制并保存..."
  PopScope 禁止返回
  ↓
跳转回放页
```

## 打点输入源

| 输入源 | 标识 | 触发方式 |
|--------|------|---------|
| BLE 蓝牙指环 | ble_ring | 原生层 MethodChannel 回调 |
| 手表 | watch | WatchCommunicationService |
| 屏幕手势 | gesture | 页面滑动/点击 |
| 手动添加 | manual | 回放页添加（非录制时） |

所有输入统一由 `DotInputManager` 管理。

## 录制保存流程

```
停止相机 → XFile(tempPath)
  │
  ├── 检测视频方向 (FFprobe isPortraitVideo)
  ├── 构造 RecordingData → 保存 .blink 文件 (AES 加密)
  │
  ├── File.rename (原子操作 <1ms)
  │    ├── 成功 → copyComplete=true → 立即导航
  │    └── 失败 → BackgroundCopyService (Isolate 拷贝)
  │
  ├── 插入 DB → 导航到回放页
  │
  └── 异步后台: 生成缩略图 + 通知媒体库 + 云同步
```

## 异常保护

| 场景 | 处理 |
|------|------|
| App 切后台 | _autoSaveRecordingData() |
| 蓝牙事件触发 lifecycle | 5 秒冷却期，跳过 autoSave |
| 相机不可用 | _saveDotRecordsOnly() 降级（recordType=2） |
| dispose 兜底 | _saveDotRecordsOnly() fire-and-forget |
| 停止按钮误打点 | _suppressNextDot 标志位屏蔽 |
| 保存中返回 | PopScope canPop 加 _isSaving 条件 |

## 分辨率和帧率

| 分辨率 | 说明 | 帧率 |
|--------|------|------|
| 720p | ResolutionPreset.high | 30/60/24 fps |
| 1080p (默认) | ResolutionPreset.veryHigh | 循环切换 |
| 4K | ResolutionPreset.ultraHigh | - |

## 相关文档

- [蓝牙通信](../engineering/ble-communication) — BLE 连接保活和按键监听
- [.blink 文件格式](../engineering/blink-file-format) — 打点文件加密存储
- [事件模型](../engineering/event-model) — DotRecord 结构
