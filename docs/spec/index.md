---
title: BlinkLife 合约权威源（Spec）
sidebar_position: 0
sidebar_label: 概览
description: "跨端 + 后端共享的合约规范：账号体系、Timeline v2、衔接协议、落地路线图"
---

# BlinkLife 合约权威源（Spec）

> `spec/` 目录下的文档是 BlinkLife 跨端（Android / WatchOS / Wear / Web / Studio / iOS）与后端（NestJS + Postgres）**共享的合约权威源**。任何端的实现与本规范冲突时，**以本规范为准**。

## 为什么有 `spec/` 目录

- `engineering/` 下的文档描述**当前实现现状**（会随代码演进）
- `spec/` 下的文档描述**合约目标**（先于实现定义，各端按此对齐）
- 两者关系：`spec/` 是合约，`engineering/` 是实现描述；存在差异时以 `spec/` 为准

## 文档导航

| 文档 | 一句话 |
|---|---|
| [账号体系规范](./account-system-v1.md) | BlinkLife 主账号 + 多身份绑定 + 资产归属 + 权益 + 设备 + 审计 的平台底座 |
| [Timeline v2 规范](./timeline-v2.md) | Tracks + Events 双层模型 + .blink v3 文件格式 + v2 严格向下兼容 |
| [账号 ↔ Timeline 衔接协议](./ownership-and-sync-v1.md) | 归属模型、游客升级、云端同步、冲突解决、删号清理 |
| [落地路线图](./roadmap.md) | Phase 切分、跨端顺序、后端迁移六步、风险降级 |

## 阅读顺序建议

- **产品 / 项目负责人**：先读 `roadmap.md`，了解 Phase 切分与里程碑；再读 `account-system-v1.md` §1 分层架构了解整体
- **后端工程师**：`account-system-v1.md` §2 身份模型 + §9 迁移规划 → `ownership-and-sync-v1.md` §3 云端同步
- **客户端工程师（Android / iOS）**：`timeline-v2.md` §2 核心抽象 + §6 文件格式 → `account-system-v1.md` §5 客户端状态机 + §6 API 合约
- **WatchOS / Wear 工程师**：`timeline-v2.md` §4 时间对齐 + §5 输入源
- **合规 / 审核负责人**：`account-system-v1.md` §7 合规硬约束 + §8 审计与风控

## 三项核心决策摘要

1. **主账号主键 = UUID v7 字符串**：推翻现状 BigInt autoincrement + wxOpenid 主键，第三方身份下沉到 `auth_identities`
2. **Timeline 核心抽象 = Tracks + Events 双层**：Track 声明维度，Event 扁平按时间排序，跨设备合并高效
3. **`.blink v3` 是 v2 严格超集**：新增 `spec_version / file_uuid / owner / tracks / events` + `legacy.*` 镜像，保证 v1 客户端不升级也能用

## 版本与演进

- 本目录下文档一律带版本号（如 `-v1`, `v2`）
- 非破坏性迭代 → 次版本号递增（`v2.0 → v2.1`）
- 破坏性变更 → 主版本号递增，老版保留；实现方显式声明支持的主版本范围
- 所有变更通过 PR + 规范评审，不允许直接修改已发布版本

## 参考输入（历史材料，非权威源）

- `/Users/yangbo/Downloads/BlinkLife_iOS_账号体系实施方案_完整版.md`
- `/Users/yangbo/Downloads/blinklife_capture_system_v1.md`
- `engineering/event-model.md`（v1 事件模型实现描述）
- `engineering/timeline-model.md`（v1 时间轴 UI 渲染）
- `engineering/blink-file-format.md`（v2 文件格式实现描述）
