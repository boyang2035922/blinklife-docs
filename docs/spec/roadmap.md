---
title: 账号 + Timeline 规范落地路线图
sidebar_position: 4
description: "Phase 切分 / 跨端落地顺序 / 后端迁移步骤 / 风险降级"
---

# 账号 + Timeline 规范落地路线图

> 本文档把 `account-system-v1.md`、`timeline-v2.md`、`ownership-and-sync-v1.md` 三份规范拆成可交付的阶段性工作包，给出跨端落地顺序、后端迁移步骤和风险降级预案。
>
> 核心原则：**先过审，再商业化；先兼容，再扩展；先单端，再跨端同步。**

## 实施状态（2026-04-20 更新）

| Phase | 组件 | 状态 |
|---|---|---|
| Phase 1 后端 | users/auth_identities/auth_sessions/user_devices/audit_logs/user_profiles 六表 | ✅ 已落地（`account_system_v1_up.sql`） |
| Phase 1 后端 | `/auth/apple`（JWKS 完整验签）/ `/auth/refresh` / `/account/delete/request\|cancel\|status` | ✅ 已落地 |
| Phase 1 客户端 | 登录页 Apple 按钮 + 微信 + 游客入口 | ✅ 已落地 |
| Phase 1 客户端 | `AccountSecurityPage` + 身份绑定/解绑 + 多设备管理 UI | ✅ 已落地 |
| Phase 1 客户端 | `.blink v3` 文件格式（tracks / events / legacy 镜像） | ✅ 已落地（`FeatureFlags.kBlinkFileV3Enabled=true`） |
| Phase 1 客户端 | `biometric.heart_rate` 心率轨道接入 | ✅ 已落地 |
| Phase 2 账号迁移 | 阶段 1 新表 + 阶段 2 双写 + 阶段 3 wx_openid nullable + 阶段 4 refreshToken 切读 + 阶段 5 下线老 refresh_tokens | ✅ 全部完成 |
| Phase 2 前瞻预埋 | JWT `aud='blinklife'` + `audit_logs.product` 字段 | ✅ 已预埋 |
| Phase 2 账号注销物理清理 | `AccountCleanupTask @Cron(EVERY_DAY_AT_3AM)` | ✅ 已落地 |
| Phase 2 业务 | IAP 商品/订单/权益 / 恢复购买 | 🕐 待商务对接 |
| Phase 3 扩展 | 手机号登录 / `ai.moment` 轨道 payload / 协作采集 | 🕐 未启动 |
| 提审阻塞项 | iOS Xcode Sign in with Apple capability 配置 / 真机联调 / 隐私政策更新 | 🕐 待人工操作 |

生产部署：`ubuntu@140.143.187.247:/home/ubuntu/blinklife-api`，部署脚本 `deploy.sh`。

## 0. Phase 切分总览

### Phase 0：规范评审（本次交付后的 1 - 2 周）

- 3 份规范 + 本文档完成技术评审（后端 + 各端负责人 + 合规）
- 修订后定稿 `spec/*.md`，版本号冻结
- 产出评审纪要（模糊点 / 冲突点清单 + 决策记录）

### Phase 1（P0）：iOS 提审必备（2026-04 ~ 2026-06，约 6 周）

**目标**：iOS 首发能过审，账号与资产归属底座站稳。

#### 后端
- 数据表：`users_v2 / auth_identities / auth_sessions / user_devices / audit_logs / user_profiles`
- 接口：`/v1/auth/apple` / `/v1/auth/refresh` / `/v1/auth/logout` / `/v1/account/delete/request` / `/v1/me`
- 双写改造：`/v1/auth/wechat` 新老表双写（见 `account-system-v1.md` §9 阶段 2）
- 审计骨架：`login_success` / `delete_account_request` / `bind_identity` 三类事件

#### 客户端（iOS 先，Android 跟进）
- 登录页：Apple 登录按钮首位 + 微信登录 + 游客"稍后再说"入口
- 设置页：新增"账号与安全"模块（绑定状态 / 当前设备 / 隐私政策 / 注销账号）
- 注销流程：二次确认 + 15 天宽限期说明文案
- `.blink v3` 文件头：仅加 `spec_version + file_uuid + owner` 三字段；tracks / events 留空；`legacy.*` 沿用 v2 内容
- **关键**：保留 DotInputManager 和现有打点链路，不改事件产生侧

#### 测试与合规
- 提审专项：Apple 登录 / App 内注销 / IAP 占位 / 隐私政策更新
- SDK 清单核查 + App Privacy 申报更新

**Phase 1 验收门槛**：
- 新用户能走 Apple 登录全流程
- 老用户能通过 `/v1/auth/wechat` 双写接口维持登录（user_id 切换为 UUID v7）
- App 内能发起 + 撤销 + 完成账号删除
- `.blink v3` 文件可被 v1 客户端正确读取（`legacy.*` 兜底）

### Phase 2（P1）：首发强推（2026-06 ~ 2026-09，约 12 周）

**目标**：商业化可接入、Timeline 多轨道真正落地、跨端同步生产可用。

#### 后端
- 数据表：`user_entitlements / skus / orders / payment_transactions`
- 接口：`/v1/orders` / `/v1/payments/verify` / `/v1/payments/restore` / `/v1/entitlements`
- 云同步升级：`/v1/recordings/sync` 支持 Timeline v2 完整 schema（tracks / events 全字段）
- Event 级合并算子：冲突解决按 `ownership-and-sync-v1.md` §3.4

#### 客户端
- Timeline v2 完整支持：tracks + events 双层模型；内置 `action / biometric.heart_rate / biometric.speed / sync.marker` 四个轨道
- 心率 / 速度轨道接入（手表 / BLE 戒指）
- IAP 商品页：Pro 会员 / AI 复盘 50 次 / 云存储 / 高级模板
- 恢复购买入口
- 业务侧权益查询：AI 复盘按钮 / 云端上传 / 高级模板都走 `entitlement.check()`

#### Android 跟进
- Android 客户端对齐 iOS 的 Phase 1 + Phase 2 全部能力
- 双端在同一后端正常同步

**Phase 2 验收门槛**：
- Pro 会员购买 + 恢复购买闭环跑通
- 心率轨道在手表场景下每秒一条采样，与人工打点同文件存储
- iOS / Android 两端修改同一 `file_uuid`，按 last-writer-wins 正确合并

### Phase 3（P2）：扩展与生态（2026-09 ~ 2026-12）

- 手机号登录 + 邮箱登录
- `ai.moment` 轨道接入（AI 复盘候选事件）
- `sensor.imu` 轨道（传感器流）
- `annotation` 轨道（事后修正）
- WatchOS 独立 App + Wear OS 独立 App
- Web / Studio 客户端 Timeline v2 读能力
- 协作采集（`owner.contributors[]`）规范冻结 + 落地
- Pro 端到端加密可选开关

### Phase 4（P3+）：组织与多产品（2027+）

- 家庭账号 / 教练 - 队员 / 球队空间
- 多产品 SSO 正式化
- 跨产品资产复用
- 企业级 RBAC

## 1. 跨端落地顺序（建议）

### 推荐顺序：**iOS 先 + 后端双写 → Android 对齐 → WatchOS / Wear → Web / Studio**

**理由**：
- iOS 是首发端，且参考文档本身是 iOS 视角
- 后端双写在 iOS 发布前完成，Android 升级时可直接读新表
- WatchOS / Wear 依赖手机主端建立 session，必须在 iOS / Android 稳定后上
- Web / Studio 以消费为主，跟进最慢即可

### 并行度建议

| 工作包 | 可并行 | 依赖 |
|---|---|---|
| 后端 `auth_identities` 新表 | ✅ 独立 | 无 |
| 后端双写改造 | ❌ 需等新表 | 阶段 1 完 |
| iOS Apple 登录 | ❌ 需等后端接口 | 后端阶段 1 完 |
| Android 对齐 Apple / 注销 | ✅ iOS 之后 | iOS 发布后 |
| `.blink v3` 头部 | ✅ 独立 | 无 |
| Timeline v2 tracks / events | ❌ 需先有 v3 头 | `.blink v3` 头完成 |
| 合规评审 / SDK 核查 | ✅ 独立 | 无 |

## 2. 后端六步迁移（详见 `account-system-v1.md` §9.3）

| 步骤 | 内容 | 预估工期 | 验收判据 |
|---|---|---|---|
| 1 | 新表建立 | 1 周 | 表结构评审通过 |
| 2 | 登录双写 | 2 周 | 双写成功率 > 99% |
| 3 | 数据回填 | 1 周 | 老 users 全部映射到 users_v2 |
| 4 | 读路径切换 | 2 周 | P0 接口错误率 < 0.5% |
| 5 | 关闭旧写 | 1 周 | 老表 updated_at 无新增 |
| 6 | 清理 | 1 个月观察期后 | 老表改名 `_archived` |

## 3. 风险与降级

| 风险 | 概率 | 影响 | 降级方案 |
|---|---|---|---|
| Apple 登录接入延期 | 中 | 无法提审 | 本期先铺 UI + mock 接口；Apple 审核前接入真接口 |
| 双写期间数据不一致 | 中 | 用户资产混乱 | 阶段 2 → 3 之间加"一致性校验 cron"，偏差 > 0.1% 自动告警 |
| `.blink v3` 客户端 Bug 导致 legacy 镜像写坏 | 低 | 旧版客户端无法读 | 客户端升级前加"legacy 自校验"单元测试；服务端同步时校验 legacy.dot_records 与 action 轨道 events 一致性 |
| IAP 票据验证失败率高 | 中 | 商业化卡壳 | 失败时 order 状态为 `pending_verification`，后台重试 N 次，用户可"恢复购买" |
| 注销宽限期被误用（大量用户误触） | 低 | 数据损失 | UI 二次确认 + 15 天宽限期内邮件 / 推送提醒可撤销 |
| 采集系统 P0 变更导致现有打点失效 | 低 | 核心功能破坏 | 本规范强制向下兼容（Timeline v2 §6.3），任何 PR 必须跑"v1 文件读取"回归测试 |
| UUID v7 在部分 SDK 无原生支持 | 低 | 客户端生成报错 | 各端依赖列表：Dart `uuid`（v4+支持 v7）、Swift `UUID + v7 helper`、Kotlin `java.util.UUID + helper`、TS `uuid` npm 包；规范附录提供实现参考 |
| v3 写出后 v2 客户端读取失败 | 低 | 新文件无法回看 | v3 写入强制双写 `legacy.*`；v2 客户端读 v3 自动走 legacy 路径 |

### 3.1 紧急回滚策略

- **账号体系回滚**：任一阶段发现不可修复问题 → 新逻辑 feature flag 关闭，老 `/auth/wechat` 链路独立可用
- **Timeline 格式回滚**：客户端统一走 `.blink v3` 写入后若发现 Bug → 版本号立即切回 `0x02`，`legacy.*` 字段保证数据不丢

## 4. 关键里程碑日期（建议）

| 日期 | 里程碑 |
|---|---|
| 2026-04-30 | 3 份规范评审定稿 |
| 2026-05-15 | 后端 Phase 1 新表 + 双写上线 |
| 2026-06-01 | iOS Phase 1 能力完成，提审候选 |
| 2026-06-30 | iOS 上架 |
| 2026-08-01 | Android Phase 1 - 2 对齐完成 |
| 2026-09-30 | IAP + 恢复购买全链路稳定 |
| 2026-12-30 | Phase 3 AI 轨道接入 |

## 5. 验收与回归测试清单

### 5.1 Phase 1 验收

- [ ] Apple 登录首次注册 + 老用户回流
- [ ] 微信登录老用户 user_id 正确切换为 UUID v7
- [ ] 游客本地数据升级登录，claim 全部成功
- [ ] 账号删除发起 + 撤销 + 完成
- [ ] App Privacy 申报与实际收集一致
- [ ] `.blink v3` 文件 v1 客户端可读

### 5.2 Phase 2 验收

- [ ] Pro 会员购买 / 订阅续费 / 退款 / 恢复购买
- [ ] AI 复盘次数扣减正确
- [ ] 心率轨道 1Hz 采样记录 + 查询
- [ ] iOS / Android 同账号同 file 修改合并正确
- [ ] 采集系统北极星"单场有效事件数"≥ 现状 x 1.2

### 5.3 回归测试（每个 Phase 必跑）

- [ ] v1 `.blink` 文件读取无损
- [ ] DotInputManager 原有输入路径（screen_tap / ble_ring / crown / gesture）全部正常
- [ ] 云同步对老数据无副作用
- [ ] 现有 FFmpeg 剪辑链路不受格式升级影响

## 附录 A：交付物清单

| 交付物 | 负责方 | 状态 |
|---|---|---|
| `spec/account-system-v1.md` | 规范作者 | 本次交付 |
| `spec/timeline-v2.md` | 规范作者 | 本次交付 |
| `spec/ownership-and-sync-v1.md` | 规范作者 | 本次交付 |
| `spec/roadmap.md` | 规范作者 | 本次交付 |
| 后端 Phase 1 PR | 后端团队 | 规范定稿后 |
| iOS Phase 1 PR | iOS 团队 | 规范定稿后 |
| Android Phase 1 PR | Android 团队 | 规范定稿后 |
| 提审 Review Notes | 产品 | iOS 提审前 |
| 合规评审意见 | 合规 | 规范评审期 |
