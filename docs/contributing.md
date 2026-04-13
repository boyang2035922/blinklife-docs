---
title: 文档规范与模板
sidebar_position: 2
sidebar_label: 文档规范
---

# 文档规范与模板

> 定义 docs/ 目录下所有文档的编写规范、frontmatter 格式和模板。

## Frontmatter 规范

每个文档必须以 YAML frontmatter 开头：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 文档标题 |
| sidebar_position | number | 是 | 侧边栏排序 |
| sidebar_label | string | 否 | 侧边栏显示名（默认用 title） |
| description | string | 否 | 一句话摘要，用于搜索和 SEO |

## AI 可读性要求

1. **一句话摘要**：标题下方用 `>` 引用语写摘要，便于 AI 检索判断相关性
2. **结构化优先**：使用表格、列表、代码块，避免大段叙述
3. **明确标注不确定性**：使用"已知事实 / 合理假设 / 待确认项"三分法
4. **链接而非重复**：跨文档信息通过相对链接引用，不复制粘贴

## 命名规范

| 类别 | 规则 | 示例 |
|------|------|------|
| 目录名 | 英文小写 | product/, engineering/ |
| 文件名 | kebab-case | blink-file-format.md |
| 内部标题 | 中文 | ## 格式定义 |

## 通用文档结构

```
# 标题
> 一句话摘要

## 概述
## 核心内容（文档主体）
## 已知事实 / 合理假设 / 待确认项
## 相关文档
```

## 专项模板

### 页面/流程文档 (product/)

必须包含：
- **用户旅程**（从哪来→做什么→去哪）
- **页面入口表**（来源页面 + 携带参数）
- **核心交互列表**（触发/行为/异常）
- **状态流转图**
- **技术实现指向**（链接 engineering/）

### 数据结构/协议文档 (engineering/)

必须包含：
- **格式定义表**（偏移/长度/内容/说明）
- **版本演进表**
- **代码示例**
- **安全考量**
- **风险点**

### 链路/流程文档 (engineering/)

必须包含：
- **流程图**（ASCII）
- **分步骤详解**（输入/处理/输出/约束）
- **异常处理**
- **性能考量**

## 目录职责边界

| 目录 | 放什么 | 不放什么 |
|------|--------|---------|
| product/ | 用户旅程、页面交互、状态流转 | 代码实现细节 |
| engineering/ | 架构原理、协议格式、数据流 | UI 布局参数 |
| design/ | 视觉规范、组件参数、布局模板 | 业务逻辑 |
| data/ | 模型字段、JSON 格式、API 接口 | 流程描述 |
| testing/ | 测试策略、验证步骤、回归清单 | 实现细节 |

## 维护规则

| 场景 | 必须更新的文档 |
|------|-------------|
| 新增页面 | 对应的 product/ 流程文档 |
| 修改数据模型字段 | data/model-dictionary |
| 修改 .blink 文件格式 | engineering/blink-file-format |
| 修改 FFmpeg 命令 | engineering/ffmpeg-pipeline |
| 修改时间轴交互 | engineering/timeline-model |
| 新增 UI 组件 | design/component-catalog |
| 修改 DB Schema | engineering/database-schema |
| 修改 API 端点 | data/api-endpoints |
