---
title: .blink 打点文件格式
sidebar_position: 4
description: "自定义二进制格式：AES-256-CBC 加密 JSON + HMAC-SHA256 完整性校验，v1/v2 版本兼容"
---

# .blink 打点文件格式

:::info 本文档描述 v2 文件格式（现状）
v3 文件格式规范见 [`spec/timeline-v2.md`](../spec/timeline-v2.md) §6。v3 头部与 v2 **完全同形**（仅版本号 `0x02 → 0x03`），明文 JSON 顶层新增 `spec_version / file_uuid / owner / tracks / events / legacy` 字段，其中 `legacy.*` 镜像 v2 全部字段以保证 v1 客户端兼容读取。`BlinkCrypto` 接口不变。
:::

> BlinkLife 使用自定义 .blink 二进制格式存储和分享打点数据，内容为 AES-256-CBC 加密的 JSON，v2 版本增加 HMAC-SHA256 完整性校验。

## 格式定义

### v2 格式（当前版本，写入时使用）

| 偏移 | 长度 (字节) | 内容 | 说明 |
|------|------------|------|------|
| 0 | 4 | `BLNK` | 魔数 (0x42 0x4C 0x4E 0x4B) |
| 4 | 1 | `0x02` | 版本号 |
| 5 | 16 | IV | AES-CBC 初始化向量（随机生成） |
| 21 | 32 | HMAC | SHA-256 HMAC（对密文计算） |
| 53 | 可变 | 密文 | AES-256-CBC 加密的 JSON |

### v1 格式（已废弃，仅兼容读取）

| 偏移 | 长度 (字节) | 内容 | 说明 |
|------|------------|------|------|
| 0 | 4 | `BLNK` | 魔数 |
| 4 | 1 | `0x01` | 版本号 |
| 5 | 16 | IV | AES-CBC 初始化向量 |
| 21 | 可变 | 密文 | AES-256-CBC 加密的 JSON |

### 明文格式（兼容旧 .txt/.json）

无 `BLNK` 魔数头，直接是 UTF-8 编码的 JSON 文本。

## 加密算法

| 参数 | 值 |
|------|------|
| 算法 | AES-256-CBC |
| 密钥长度 | 32 字节 |
| IV | 16 字节随机生成 |
| Padding | PKCS7 |
| 完整性 | HMAC-SHA256 (v2 only) |
| 方案 | Encrypt-then-MAC |

### Encrypt-then-MAC 流程

```
写入:
  plaintext → AES-CBC 加密 → ciphertext
  ciphertext → HMAC-SHA256 → hmac
  输出: BLNK + 0x02 + IV + hmac + ciphertext

读取:
  输入 → 解析 header → 提取 hmac 和 ciphertext
  ciphertext → HMAC-SHA256 → computed_hmac
  常量时间比较(hmac, computed_hmac) → 通过则解密
  ciphertext → AES-CBC 解密 → plaintext
```

## 自动格式检测

```
读取文件字节
  │
  ├── 前 4 字节 == "BLNK"?
  │    ├── 第 5 字节 == 0x02 → v2 解密（HMAC 校验 + AES）
  │    ├── 第 5 字节 == 0x01 → v1 解密（仅 AES）
  │    └── 其他 → BlinkFileException(unsupportedVersion)
  │
  └── 前 4 字节 != "BLNK"
       └── 作为 UTF-8 明文返回
```

## 异常类型

| 错误类型 | 触发条件 | 用户提示 |
|---------|---------|---------|
| emptyFile | 文件 0 字节 | 打点文件为空 |
| invalidFormat | 文件太短或头部无效 | 文件格式无效 |
| unsupportedVersion | 版本号不支持 | 不支持的文件版本 |
| integrityFailed | HMAC 校验不通过 | 文件已损坏或被篡改 |
| decryptionFailed | AES 解密异常 | 解密失败 |

## 版本演进

| 版本 | 日期 | 变更 | 向后兼容 |
|------|------|------|---------|
| 明文 | 初始 | .txt/.json 纯文本 | 读取兼容 |
| v1 | 2026-04-04 | AES-256-CBC 加密 | 读取兼容 |
| v2 | 2026-04-04 | +HMAC-SHA256 完整性校验 | 读取兼容 v1 和明文 |

## 读写方一览

### 写入方

| 位置 | 方法 | 场景 |
|------|------|------|
| FileService | saveRecordingData() | 录制结束保存 |
| review_detail_page | BlinkCrypto.writeFile() | 打点编辑/删除 |
| dot_align_page | BlinkCrypto.writeFile() | 对齐偏移写入 |

### 读取方

| 位置 | 方法 | 场景 |
|------|------|------|
| FileService | loadRecordingData() | 回放页加载 |
| markers_import_service | BlinkCrypto.readFile() | 导入打点文件 |
| external_clip_page | BlinkCrypto.readFile() | 外部导入 |
| recording_sync_service | BlinkCrypto.readFileSync() | 云同步 |

## 安全考量

1. **密钥管理**：密钥硬编码在 blink_crypto.dart，主要防止非 BlinkLife 应用读取，不是高安全级别加密
2. **常量时间比较**：HMAC 校验使用 `_constantTimeEquals()` 防计时攻击
3. **随机 IV**：每次写入生成新的 16 字节随机 IV

## 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| 密钥泄露 | 所有 .blink 文件可被解密 | 密钥不在日志/错误信息中出现 |
| v1 无完整性校验 | 被篡改后无法检测 | v1 仅兼容读取，新写入一律 v2 |
| 空文件/截断文件 | 解密崩溃 | BlinkFileException 捕获 + 字节长度校验 |

## 相关文档

- [事件模型](event-model) — 加密内容的 JSON 结构
- [RecordingData 格式](../data/recording-data-format) — JSON 字段详解
