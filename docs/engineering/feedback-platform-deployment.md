---
title: 反馈平台部署与运维
sidebar_position: 13
description: "反馈平台 Phase 1 上线 checklist：migration 执行、admin 授权、JWT 签发、环境变量、验证"
---

# 反馈平台部署与运维

> 对应 `feedback-platform-dev-spec.md` 的实施；本文只讲**部署动作**，架构设计与字段定义以 spec 为准。

## 0. 前置假设

- `blinklife-api` 生产部署在 `ubuntu@140.143.187.247:/home/ubuntu/blinklife-api`，pm2 进程名 `blinklife-api`，使用 `deploy.sh` 一键部署
- `blinklife-web` 生产部署在同一 CVM `/home/ubuntu/blinklife-web`，pm2 进程名 `blinklife-web`，同样走 `deploy.sh`
- 两个仓库 `.env` 都在服务器上维护，rsync 有 `--exclude .env` 保护

## 一键部署（推荐）

§1–§5 的手工流程已经打包成幂等脚本：

```bash
cd blinklife-api
./scripts/deploy-feedback-v1.sh --user-id=<你的 user_id>
# 支持 --dry-run / --force-jwt / --skip-api / --skip-web / --basic-password=... / --jwt-ttl-days=...
```

脚本行为：
1. SSH 可达性检查
2. `./deploy.sh` 部署 API（migration + seed + pm2 restart）
3. 查数据库：如果 user 没有 `feedback_admin` 角色就补上（已有则跳过）
4. 如果服务器 `web/.env` 没有 `FEEDBACK_ADMIN_JWT` 就在**服务器上**跑 `mint-feedback-admin-jwt.mjs` 签发；已有则保留（`--force-jwt` 强制重签）
5. 如果没有 `FEEDBACK_ADMIN_BASIC_PASSWORD` 就 `openssl rand -base64 24` 生成；已有则保留（`--basic-password=...` 显式覆盖）
6. 用 `python3` 安全 upsert 三个 env key 到 `/home/ubuntu/blinklife-web/.env`（保留其他 key 不变）
7. `./deploy.sh` 部署 Web + `pm2 restart --update-env`
8. curl 冒烟测试：提交一条 + 重放验证 `deduped=true`

结束时脚本输出 `用户名 / 密码 / Admin user_id`，请立即保存到密码管理器。

下面 §1–§5 是手工分步流程，遇到一键脚本报错时作为定位参考。

## 1. 部署 blinklife-api

`deploy.sh` Step 4 已把新 migration 加入执行列表，直接跑：

```bash
cd blinklife-api
./deploy.sh
```

Step 4 会执行：

- `feedback_platform_v1_up.sql`（6 张表 + 基础 seed：1 product + 4 apps）
- `feedback_platform_v1_tags_seed.sql`（10 个 canonical 标签）

两个文件都用 `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`，**重跑安全**。

完成后验证：

```bash
ssh ubuntu@140.143.187.247 "pm2 list | grep blinklife-api"
```

## 2. 授予 feedback_admin 角色

在服务端执行：

```sql
UPDATE users
SET roles = array_append(roles, 'feedback_admin')
WHERE id = <你的 user_id>;
```

一种便捷做法（通过 deploy 服务器跑）：

```bash
ssh ubuntu@140.143.187.247 "
  DB_URL=\$(grep -E '^DATABASE_URL=' /home/ubuntu/blinklife-api/.env | cut -d'=' -f2- | tr -d '\"' | sed 's|?schema=[^&#]*||');
  psql \"\$DB_URL\" -c \"UPDATE users SET roles = array_append(roles, 'feedback_admin') WHERE id = <USER_ID>;\"
"
```

确认：

```sql
SELECT id, nickname, roles FROM users WHERE 'feedback_admin' = ANY(roles);
```

## 3. 签发 FEEDBACK_ADMIN_JWT

**在本地开发机**（不需要上服务器）执行：

```bash
cd blinklife-api
npm run mint-feedback-admin-jwt -- --user-id=<admin 的 user_id>
```

输出包含 JWT 字符串与部署提示。默认 TTL 365 天，可 `--ttl-days=N` 覆盖。

脚本：
- 从本地 `blinklife-api/.env` 读 `JWT_SECRET`（需先本地同步或临时 scp 拿过来）
- `aud='blinklife'`，与 `JwtStrategy` 一致
- **不查 DB**，请自行确认步骤 2 已执行

> 注意：本地 `.env` 的 `JWT_SECRET` **必须和生产完全一致**才能签出生产可用的 JWT；否则 `JwtAuthGuard` 会拒绝。生产 `.env` 只在服务器上，如果本地没同步，需要临时 scp 过来签一次（签完立即删除），或者**直接在服务器上跑脚本**。

服务器直接跑：

```bash
ssh ubuntu@140.143.187.247 "cd /home/ubuntu/blinklife-api && node scripts/mint-feedback-admin-jwt.mjs --user-id=<USER_ID>"
```

## 4. 配置 blinklife-web 环境变量

参考 `blinklife-web/.env.example`。生产 `.env` 里加：

```bash
FEEDBACK_ADMIN_BASIC_USER=admin
FEEDBACK_ADMIN_BASIC_PASSWORD="$(openssl rand -base64 24)"
FEEDBACK_ADMIN_JWT=<步骤 3 输出的 JWT>
# BLINKLIFE_API_BASE_URL 不配时默认 https://api.blink-life.cn/api/v1
```

> `FEEDBACK_ADMIN_BASIC_*` 任一未配 → `src/proxy.ts` 返回 503，后台不可访问（故意的，防止裸奔）。

部署：

```bash
cd blinklife-web
./deploy.sh
```

`pm2 restart blinklife-web` 会重新加载 `.env`（假设 pm2 用 `--update-env` 或进程启动读取 .env）。如果 pm2 没自动重读：

```bash
ssh ubuntu@140.143.187.247 "cd /home/ubuntu/blinklife-web && pm2 restart blinklife-web --update-env"
```

## 5. 验证

### 5.1 匿名提交

```bash
CLIENT_EVENT_ID=$(uuidgen | tr 'A-Z' 'a-z')
INSTALL_ID=$(uuidgen | tr 'A-Z' 'a-z')
curl -i -X POST https://api.blink-life.cn/api/v1/feedback/records \
  -H 'Content-Type: application/json' \
  -d "{
    \"product_code\":\"blinklife\",
    \"app_code\":\"blinklife_ios\",
    \"client_event_id\":\"$CLIENT_EVENT_ID\",
    \"anonymous_install_id\":\"$INSTALL_ID\",
    \"feedback_type\":\"bug\",
    \"source_type\":\"form\",
    \"content\":\"部署冒烟测试\"
  }"
```

预期：HTTP 200，body `{"id":"...","status":"new","deduped":false}`。

### 5.2 幂等去重

重复执行**同一条** curl，预期返回 `{"id":"...","status":"new","deduped":true}`。

### 5.3 限流

快速执行 11 次，第 11 次预期 HTTP 429 `ThrottlerException: Too Many Requests`。

### 5.4 管理端

浏览器访问 `https://blink-life.cn/internal/feedback`（或你的 web 域名）：

- 预期弹 Basic Auth 对话框
- 输入 `FEEDBACK_ADMIN_BASIC_USER` / `FEEDBACK_ADMIN_BASIC_PASSWORD` 后应能看到列表
- 点某条 → 详情页 → 改状态 → 时间线出现 `status_changed` 条目 + operator_id = 你的 admin user_id
- 发送"回复" → 时间线出现 `admin_reply` 事件（标"用户可见"）

### 5.5 客户端"我的反馈"

- 用**已授予 feedback_admin 角色的同一个账号**登录 app（或任意一个有反馈的账号）
- 后台回复 → 客户端 profile 页 → "我的反馈" 行出现红点
- 点进详情 → 看到回复气泡 → 返回后红点消失

## 6. 常见问题

**Q：Web 后台 PATCH 请求 500，错误 "FEEDBACK_ADMIN_JWT 未配置"**
→ 步骤 4 的环境变量没配上；或 pm2 没 `--update-env` 重读；或生产 `.env` 和本地签发的 `JWT_SECRET` 不一致。

**Q：Web 后台页面 503 "Internal admin not configured"**
→ `FEEDBACK_ADMIN_BASIC_USER` / `FEEDBACK_ADMIN_BASIC_PASSWORD` 没配全。

**Q：提交反馈接口返回 401**
→ 不会。提交接口不走 guard；401 意味着 `GET /feedback/records/mine*` 路径的 JWT 问题（过期/非法）。

**Q：后台 API 返回 403 "需要 feedback_admin 角色"**
→ 步骤 2 没做或 JWT 里的 userId 和授权的 userId 不是同一个人。`SELECT roles FROM users WHERE id = ?;` 验证。

**Q：Android 反馈入口不显示**
→ `FeatureFlags.kFeedbackEnabled` 被改成 `false`，或当前 app 是旧版本。

## 7. 关闭开关（紧急情况）

反馈平台出问题需要关闭：

1. **客户端**：把 `lib/config/feature_flags.dart` 的 `kFeedbackEnabled` 改 `false` 出热补丁；profile / overlay 的入口全部隐藏
2. **服务端**：`pm2 stop blinklife-api` 会整体停服，过于粗暴；更稳妥的是在 `feedback.module.ts` 上加 `@Controller` 级别的 guard 临时拒绝；Phase 2 考虑增加 runtime feature flag 表

## 8. Phase 2 前清理项

- `FEEDBACK_ADMIN_JWT` 长期 token 方案换成 Web SSO
- `FEEDBACK_ADMIN_BASIC_*` Basic Auth 换成正经登录会话
- 诊断信息的 `app_version` / `build_number` 已接 `package_info_plus`，Phase 1 的硬编码 TODO 已清
