---
title: 蓝牙通信
sidebar_position: 7
description: "BLE 蓝牙外设通信：Flutter 扫描连接 + 原生 GATT 按键监听 + KeepAlive 保活策略"
---

# 蓝牙通信

> BlinkLife 通过 BLE 蓝牙与智能指环/按键外设通信，实现运动中的无感打点。通信分两层：Flutter 层（扫描/连接）+ 原生层（GATT 按键监听 + KeepAlive 保活）。

## 架构

```
Flutter 层                          原生层 (Kotlin)
┌──────────────────┐              ┌──────────────────┐
│ BluetoothService │              │ MainActivity.kt  │
│ (扫描/连接 UI)   │              │ (GATT/保活)      │
└────────┬─────────┘              └────────┬─────────┘
         │ flutter_blue_plus              │
         └────────────┬───────────────────┘
                      │ MethodChannel
              NativeBluetoothService
              (Flutter ↔ 原生桥接)
```

## MethodChannel 接口

通道名：`blinklife/bluetooth`

| 方向 | 方法 | 说明 |
|------|------|------|
| Flutter→原生 | startKeyListening(deviceId) | 启动 GATT 按键监听 |
| Flutter→原生 | stopKeyListening | 停止监听 |
| Flutter→原生 | setRecordingState(bool) | 通知录制状态 |
| Flutter→原生 | setGestureExclusionRects(bool) | 屏蔽左边缘返回手势 |
| 原生→Flutter | onBluetoothStatus(status) | 连接状态回调 |
| 原生→Flutter | onKeyPressed(keyCode) | 按键事件回调 |

## 保活策略

| 参数 | 录制中 | 非录制 |
|------|--------|--------|
| KeepAlive 间隔 | 3 秒 | 20 秒 |
| 重连上限 | 无限 | 10 次 |
| 退避策略 | 指数 1s→32s | 指数 1s→32s |
| KeepAlive 方式 | readBatteryLevel / readRemoteRssi | 同左 |

## 按键映射

| keyCode | 方向 | 默认动作(足球) |
|---------|------|---------------|
| 0x10 | up | 射门 |
| 0x11 | down | 传球 |
| 0x12 | left | 犯规 |
| 0x13 | right | 任意球 |
| 0x14 | center | 精彩 |
| unknown_* | center (兜底) | 精彩 |

## 蓝牙事件与生命周期冲突

蓝牙连接/断连事件会误触发 `AppLifecycleState.paused`。录制页使用 **5 秒冷却期**机制：

```dart
if (_bleEventCooldown) return;  // 跳过 lifecycle autoSave
_bleEventCooldown = true;
Timer(Duration(seconds: 5), () => _bleEventCooldown = false);
```

## 相关文档

- [录制流程](../product/recording-flow) — BLE 在录制中的角色
- [架构总览](architecture-overview) — MethodChannel 在整体架构中的位置
