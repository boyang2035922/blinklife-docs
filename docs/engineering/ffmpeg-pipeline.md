---
title: FFmpeg 剪辑管线
sidebar_position: 6
description: "FFmpegKit 视频剪辑：input seeking + copy codec + concat demuxer 合集生成"
---

# FFmpeg 剪辑管线

> BlinkLife 使用 FFmpegKit 进行视频剪辑和合集生成，所有 FFmpeg 调用必须使用 executeAsync（异步），通过 Completer 桥接为 Future。

## 剪辑流程概览

```
DotRecord[] + 剪辑参数 (beforeSeconds, afterSeconds)
  │
  ├── _calculateClipSegments()  → ClipSegment[]
  │     为每个打点计算 [dotTime - before, dotTime + after]
  │
  ├── _mergeOverlappingSegments()  → 合并重叠区间
  │     相邻片段间隔 < 1s → 合并
  │
  ├── 逐段执行 _clipSegment()
  │     ├── FFmpeg 命令 → executeAsync + Completer
  │     ├── 检查 ReturnCode.isSuccess
  │     └── 生成缩略图
  │
  └── 批量插入 DB (clip_records)
```

## FFmpeg 命令模板

### 单片段剪辑（-c copy，无转码）

```bash
ffmpeg -ss {startTime} -i "{inputPath}" -t {duration} -c copy -y "{outputPath}"
```

:::danger 关键约束
- `-ss` **必须放在 `-i` 前面**（input seeking），否则慢 10-100 倍
- 禁止使用 `FFmpegKit.execute`（同步），会阻塞 UI 线程导致 ANR
:::

### 合集生成（concat demuxer）

```bash
# 生成 concat 列表文件
echo "file '/path/to/clip1.mp4'" > concat_list.txt
echo "file '/path/to/clip2.mp4'" >> concat_list.txt

# 合并
ffmpeg -f concat -safe 0 -i concat_list.txt -c copy -y "{outputPath}"
```

- 使用 concat demuxer（`-f concat`），不用 concat protocol
- `-safe 0` 允许绝对路径
- 临时列表文件在成功/失败/异常路径均清理

## 片段计算逻辑

```dart
ClipSegment = {
  startTime: max(0, dotTime - beforeSeconds),
  endTime: min(videoDuration, dotTime + afterSeconds),
  actionType: dot.action,
  actionCount: 1,  // 合并后可能 > 1
}
```

### 重叠合并

```
片段A: [5s, 15s]    片段B: [14s, 24s]
间隔 < 1s → 合并为: [5s, 24s], actionCount = 2
```

## executeAsync 桥接

```dart
final completer = Completer<ReturnCode?>();
await FFmpegKit.executeAsync(command, (session) async {
  final returnCode = await session.getReturnCode();
  completer.complete(returnCode);
});
final rc = await completer.future;
if (!ReturnCode.isSuccess(rc)) {
  // 记录完整命令到日志
}
```

## 输出文件命名

```
clip_{actionType}_{index}_{timestamp}.mp4    // 剪辑片段
merged_{timestamp}.mp4                       // 合集视频
```

带时间戳避免与旧批次文件冲突（MediaScanner 锁定旧文件导致 FFmpeg `-y` 覆盖失败）。

## 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| -ss 放在 -i 后面 | 剪辑极慢 | 编码约束写入 CLAUDE.md |
| 使用 execute 同步 | UI 线程阻塞 ANR | 禁止使用 |
| concat 列表文件未清理 | 磁盘泄露 | try-finally 清理 |
| FFmpeg 返回非 0 | 输出损坏 | ReturnCode.isSuccess 检查 |

## 相关文档

- [剪辑任务批次](clip-task-batch) — 任务调度和进度管理
