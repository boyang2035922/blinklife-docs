---
title: Studio 桌面端架构
sidebar_position: 12
description: "BlinkLife Studio — Tauri v2 桌面视频剪辑工具的架构设计、模块划分和发布流程"
---

# Studio 桌面端架构

> BlinkLife Studio 是独立的桌面视频剪辑工具。用户导入视频 + 打点文件，自动计算片段并通过 FFmpeg CLI 串行剪辑输出。

## 技术选型

| 层 | 技术 | 理由 |
|---|------|------|
| 框架 | Tauri v2 | 轻量（DMG 4.5MB）、Rust 后端原生性能 |
| 前端 | React 19 + Vite 7 + Tailwind v4 | 快速开发、暗色主题 |
| 状态 | Zustand | 单 store，与 Flutter 端无关联 |
| 加密 | Rust (aes/cbc/hmac/sha2) | WebView 无 Node.js crypto，必须 Rust 侧解密 |
| 剪辑 | 系统 FFmpeg CLI | 禁止 ffmpeg.wasm，-c copy 零转码支持 5GB+ |

## 分层架构

```
┌──────────────────────────────────────────────┐
│              React UI (WebView)               │
│  App.tsx → 组件 → Zustand store              │
├──────────────────────────────────────────────┤
│            TypeScript 服务层                   │
│  marker_parser · clip_engine · ffmpeg_runner  │
│  file_service · blink_crypto                  │
├──────────────────────────────────────────────┤
│            Tauri IPC (invoke)                 │
├──────────────────────────────────────────────┤
│              Rust 后端                        │
│  crypto.rs     .blink 解密                    │
│  ffmpeg.rs     FFmpeg/FFprobe 进程管理        │
│  dialog.rs     原生文件对话框                  │
│  fs_ops.rs     文件系统操作                    │
│  shell.rs      打开文件管理器                  │
└──────────────────────────────────────────────┘
```

## 核心模块

### Rust 后端 (src-tauri/src/)

| 模块 | 命令 | 说明 |
|------|------|------|
| `crypto.rs` | `decrypt_blink_file` | AES-256-CBC + HMAC-SHA256 解密，兼容 v1/v2/明文 |
| `commands/ffmpeg.rs` | `check_ffmpeg` | 检测系统 FFmpeg |
| | `get_video_duration` | ffprobe 获取时长 |
| | `ffmpeg_clip` | 单片段剪辑（-ss input seeking + -c copy） |
| | `ffmpeg_merge` | concat demuxer 合并 |
| `commands/dialog.rs` | `pick_video_file` / `pick_marker_file` | 原生文件选择 |
| `commands/fs_ops.rs` | `create_output_dir` / `read_file_text` / `delete_file` | 文件操作 |
| `commands/shell.rs` | `open_in_file_manager` | 打开 Finder/Explorer |

### TypeScript 服务层 (src/services/)

| 模块 | 移植来源 | 说明 |
|------|---------|------|
| `marker_parser.ts` | `markers_import_service.dart` | 多格式解析（.blink/JSON/CSV/TXT/HH:MM:SS） |
| `clip_engine.ts` | `video_clip_service.dart:193-310` | 片段计算 + 重叠合并算法 |
| `ffmpeg_runner.ts` | `video_clip_task_manager.dart` | 串行剪辑编排 + 三种输出模式 |
| `blink_crypto.ts` | — | invoke 包装，委托 Rust 解密 |
| `file_service.ts` | `video_clip_service.dart:461-468` | 时间格式化、路径工具 |

### 与移动端共享的算法

这些算法从 Flutter/Dart 代码直接移植到 TypeScript/Rust，逻辑完全一致：

| 算法 | Flutter 源 | Studio 实现 |
|------|-----------|-------------|
| .blink 解密 | `blink_crypto.dart` | `crypto.rs` (Rust) |
| 打点文件解析 | `markers_import_service.dart` | `marker_parser.ts` |
| 片段计算 | `video_clip_service.dart:193-251` | `clip_engine.ts` |
| 重叠合并 | `video_clip_service.dart:254-310` | `clip_engine.ts` |
| FFmpeg 命令 | `video_clip_service.dart:354-360` | `ffmpeg.rs` |

## 数据流

```
1. 拖入/选择视频 → invoke get_video_duration → store.setVideo()
2. 拖入/选择打点 → invoke decrypt_blink_file / read_file_text
                  → marker_parser.parseMarkerFile() → store.setMarker()
3. 两者就绪 → clip_engine.calculateClipSegments()
              → store.segments 自动计算（含筛选过滤）
4. 用户选择动作筛选 → store.toggleAction() → 重新计算
5. 用户选择输出模式 → clips / merged / both
6. 点击"开始剪辑" → create_output_dir → 逐个 ffmpeg_clip
                    → merged 模式额外 ffmpeg_merge → 清理临时片段
7. 完成 → invoke open_in_file_manager 打开输出目录
```

## 输出模式

| 模式 | 行为 | 输出文件 |
|------|------|---------|
| 仅片段 | 每个片段独立输出 | `clip_0_xxx_射门.mp4` × N |
| 仅合集 | 先切片再 concat 合并，删除临时片段 | `highlight_merged_xxx.mp4` |
| 片段+合集 | 两者都保留 | 片段 × N + 合集 |

## 构建与发布

### 双架构构建

```bash
# Apple Silicon (M1/M2/M3)
npm run tauri build -- --target aarch64-apple-darwin

# Intel
npm run tauri build -- --target x86_64-apple-darwin
```

### 签名与公证

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: ..." \
APPLE_ID="admin@blink-life.com" \
APPLE_PASSWORD="<App专用密码>" \
APPLE_TEAM_ID="74RH8GS3KA" \
npm run tauri build
```

Tauri 自动 codesign + notarytool submit 公证。

### 发布渠道

| 渠道 | 用途 |
|------|------|
| CVM (blink-life.cn/downloads/) | 国内用户直连下载 |
| GitHub Releases | 海外用户 + 版本归档 |
| 官网 /studio 页面 | 下载入口（链接指向 CVM） |

### DMG 更新流程

```bash
# 1. 构建双架构
npm run tauri build -- --target aarch64-apple-darwin
npm run tauri build

# 2. 上传到 CVM（deploy.sh 排除 public/downloads，需单独 scp）
scp src-tauri/target/*/release/bundle/dmg/*.dmg \
  ubuntu@140.143.187.247:/home/ubuntu/blinklife-web/public/downloads/

# 3. 更新 GitHub Release
gh release upload v0.x.0 *.dmg --clobber

# 4. 重启 CVM Next.js
ssh ubuntu@140.143.187.247 "pm2 restart blinklife-web"
```

## 相关文档

- [.blink 文件格式](blink-file-format) — 加密协议规范（Studio Rust 端完全兼容）
- [FFmpeg 管线](ffmpeg-pipeline) — 移动端 FFmpeg 命令（Studio 复用相同模板）
- [剪辑任务批次](clip-task-batch) — 移动端任务管理（Studio 简化为串行队列）
