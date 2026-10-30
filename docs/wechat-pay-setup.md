# 微信支付接入说明（服务商 / Partner 模式）

> 前置：个体户/企业执照 ✅、purelyClub 小程序企业认证 ✅、ICP 备案 ✅、平台已申请**微信支付服务商商户号** ✅。
> 本步目标：搞清楚三条收款链路的凭据边界 → 配置服务商侧环境变量 → 商家在后台填子商户号 → 通过绑定校验 → 打通「C 端付款 → 结算到商家子商户」。
> 代码事实依据：`src/config/configuration.ts`（`wechat` / `wechat.partner` 块）、`src/purely-club/payments/*`、`src/purely-profit/stores/stores-wechat-pay*.ts`、`.env.example`。
> 文档日期：2026-10-29（服务商模式改造后重写，旧版「直连普通商户」内容已作废）。

---

## 〇、先分清三条链路：这是所有配置的前提

本仓库有**三条互不相干的微信支付链路**，共用同一批代码基础设施，但**资金方向、商户号来源、密钥来源完全不同**：

| # | 链路 | 资金方向 | 收款商户号 | 签名证书 / 回调密钥 | 回调路由 |
|---|------|---------|-----------|-------------------|---------|
| a | **C 端门店收款**（本次改造对象） | 用户 → 商家 | 门店配置的**子商户号 sub_mchid** | **服务商**商户号证书 + **服务商** APIv3 密钥 | `POST /api/club/payments/wechat/callback` |
| b | 短信钱包充值 | 商家 → 平台 | `wechat.payMchId` | 同左（平台商户号证书 + `wechat.payApiV3Key`） | `POST /api/marketing/sms/wechat/callback` |
| c | 平台会员 / 新客额度 | 商家 → 平台 | `wechat.payMchId` | 同左 | `POST /api/profit/payments/wechat/callback` |

**已确认事实**：现有 `WECHAT_PAY_MCH_ID` 本身就是**微信支付服务商商户号**，b/c 两条链路以及 a 链路的服务商主体都在这同一个商户号下。

### ⛔ 只增不改（红线）

链路 b/c 的消费方与取值**一个都不能动**。本次改造只做加法：

| 共享配置 | 继续服务 | 禁止 |
|---------|---------|------|
| `wechat.mchSerialNo` | b/c + 直连期的 a | 改名 / 替换 / 复用给服务商链路 |
| `wechat.privateKeyPath` / `privateKeyContent` | 同上 | 同上 |
| `wechat.platformPublicKeyContent` | b/c（平台商户号维度的平台证书） | 直接换成服务商维度的证书 |
| `wechat.payMchId` / `wechat.payApiV3Key` | b/c | 拿去当 `sp_mchid` 以外的用途 |
| `wechat.appId` | b/c + 直连期的 a | — |

服务商链路一律走**新增的 `wechat.partner.*`**。即便取值与上面相同（同一商户号），也必须**独立配置一份**：资金语义不同，将来任意一边轮换证书都不能牵连另一条。

---

## 一、凭据归属：商家到底需要提供什么

| 凭据 | 持有方 | 用途 | 商家提供 |
|------|--------|------|---------|
| `sp_mchid` 服务商商户号 | 平台 | 请求主体、结算主体 | ❌ |
| 服务商 API 证书（私钥 + 序列号） | 平台 | 全部 APIv3 请求签名 | ❌ |
| 服务商 APIv3 密钥 | 平台 | **回调报文解密的唯一密钥** | ❌ |
| 微信支付平台证书（服务商维度） | 平台（下载） | 回调验签 | ❌ |
| `sub_mchid` 子商户号 | 商家 | 指定这笔钱的结算去向 | ✅ |
| 子商户主体名称 | 商家 | 页面展示 / 核对 | ✅ |
| 子商户 APIv3 密钥 / 证书 | **微信侧不存在** | — | ❌ |

> **关键口径**：子商户（特约商户）在微信侧**不支持也不存在**自己的 APIv3 密钥与 API 证书。
> 反过来推：如果某个商家说自己能提供 APIv3 密钥或证书，说明它是**直连普通商户**，不是本服务商下的子商户 —— 这是「未进件 / 未授权」的强信号。

---

## 二、环境变量（两组，都要配）

模板见 `.env.example`。生产环境文件：`/etc/purelyprofit-server/production.env`。

### 2.1 平台收款（b/c，改造前就有的那组）

```bash
WECHAT_APP_ID=wxb2533a73dc3764b5
WECHAT_APP_SECRET=你的小程序AppSecret

# 商户 API 证书（服务商商户号的证书）
WECHAT_MCH_SERIAL_NO=你的证书序列号
WECHAT_PRIVATE_KEY_PATH=/etc/secrets/apiclient_key.pem   # 权限 600
# 或 WECHAT_PRIVATE_KEY_CONTENT=-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----

# 平台收款商户号与其密钥（= 服务商商户号）
WECHAT_PAY_MCH_ID=1900000001
WECHAT_PAY_API_V3_KEY=32位平台密钥

# 回调地址（三条各用各的，禁止混用）
WECHAT_PAY_NOTIFY_URL=https://api.你的域名.com/api/club/payments/wechat/callback
SMS_WECHAT_PAY_NOTIFY_URL=https://api.你的域名.com/api/marketing/sms/wechat/callback
PROFIT_WECHAT_PAY_NOTIFY_URL=https://api.你的域名.com/api/profit/payments/wechat/callback

# 回调验签平台证书公钥
WECHAT_PLATFORM_PUBLIC_KEY_CONTENT=-----BEGIN PUBLIC KEY-----\nMIIBIj...\n-----END PUBLIC KEY-----
```

### 2.2 服务商模式（a，本次新增）

```bash
# 灰度总开关：false 时 C 端门店收款回落到旧的直连逻辑（可回滚）
WECHAT_PARTNER_ENABLED=false

# 与 WECHAT_PAY_MCH_ID 同值；因为同号，必须同时开启下面两个豁免变量
WECHAT_PARTNER_SP_MCH_ID=1900000001
WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID=true
WECHAT_PARTNER_SHARED_MCH_ID_REASON=该商户号即为平台微信支付服务商商户号（已核实）

# 服务商 APIv3 密钥：服务商模式下回调解密的唯一密钥（与平台密钥同值，仍需单独填）
WECHAT_PARTNER_API_V3_KEY=32位服务商密钥

# 服务商证书（与全局证书同值，仍单独填一份）
WECHAT_PARTNER_MCH_SERIAL_NO=你的证书序列号
WECHAT_PARTNER_PRIVATE_KEY_PATH=/etc/secrets/apiclient_key.pem
# 或 WECHAT_PARTNER_PRIVATE_KEY_CONTENT=...

# 发起支付的小程序 AppID（sp_appid），未配置时回落 WECHAT_APP_ID
WECHAT_PARTNER_SP_APP_ID=wxb2533a73dc3764b5

# 服务商模式回调地址：必须以 /api/club/payments/wechat/callback 结尾
WECHAT_PARTNER_PAY_NOTIFY_URL=https://api.你的域名.com/api/club/payments/wechat/callback

# 服务商维度平台证书公钥（同号 ⇒ 与 WECHAT_PLATFORM_PUBLIC_KEY_CONTENT 同值，仍需单独填）
WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT=-----BEGIN PUBLIC KEY-----\nMIIBIj...\n-----END PUBLIC KEY-----
```

### 2.3 启动自检（会拦下哪些误配）

`wechat.partner.enabled=true` 时，启动期会校验（`src/bootstrap/wechat-partner-config.validator.ts`）：

- 缺 `spMchId` / `apiV3Key` / `serialNo` / 私钥 / 平台公钥 → **拒绝启动**
- `notifyUrl` 非 HTTPS、含示例域名、不以 `/api/club/payments/wechat/callback` 结尾 → **拒绝启动**
- `spMchId` 与 `payMchId` 相同但**未显式豁免** → **拒绝启动**（防误填/抄错导致资金归属不清）
- 豁免了但没填 `WECHAT_PARTNER_SHARED_MCH_ID_REASON` → **拒绝启动**（必须留档）

> ⚠️ 最容易漏的一条：服务商模式下如果没配 `WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT`，
> C 端回调验签会 **fail-closed 全部拒绝**（这是刻意的安全设计）。上线清单必须包含该项。

---

## 三、数据库：商家只需提供两个字段

服务商改造后，`store_wechat_pay_configs` 的有效字段只有：

| 字段 | 说明 |
|------|------|
| `sub_mch_id` | **子商户号**（资金结算去向）。灰度期允许回落旧的 `mch_id`（迁移已回填） |
| `mch_name` | 子商户主体名称 |
| `bind_status` | 绑定校验状态：`pending` 待校验 / `verified` 已生效 / `failed` 校验失败 |
| `bind_checked_at` / `bind_fail_reason` | 最近一次校验时间与失败原因（中文，可直接展示给商家） |
| `mch_id` | @deprecated 旧直连字段，仅灰度回滚窗口保留 |
| `api_v3_key_enc` | @deprecated 子商户没有自己的密钥，仅旧直连链路使用；灰度结束后删除 |

**「已配置」的判定**：服务商模式下 = `sub_mch_id` 存在 **且** `bind_status === 'verified'`。
只保存未校验时返回 `configured: false`，前端据此提示去校验 —— 杜绝「配了却收不到钱、界面却显示已配置」。

`WECHAT_PAY_KEY_ENCRYPTION_SECRET` 只在**直连模式**下必需（加密门店密钥落库）；服务商模式下商家不提供密钥，该变量不再参与。

---

## 四、特约商户绑定（商家侧动作）与授权校验

本平台采用「**已有商户号绑定为子商户 / 特约商户授权**」，**不实现进件 API**（不采集营业执照、法人、结算账户）。

**商家侧步骤**：
1. 商家已有自己的微信支付商户号；
2. 在微信支付服务商后台发起「特约商户关联 / 邀请」，商家确认授权；
3. 商家登录 purelyProfit → 门店设置 → 微信收款配置，填写**子商户号 + 子商户主体名称**；
4. 点击 **重新校验** → 后端探测绑定关系 → `verified` 才真正可以收款。

**校验接口**：`POST /stores/current/wechat-pay-config/verify`
- 只能校验**当前登录商家自己绑定的门店**（门店取自 JWT，接口不接受门店 ID，越权面在服务端）
- 限频 **10 次 / 5 分钟**
- 探测原理：以 `sp_mchid + sub_mchid` 查一个必然不存在的单号，按返回码判定（见第六节）

---

## 五、灰度开关与回滚步骤

**开启**（建议顺序）：
1. 部署数据库迁移（`20261029120000_add_wechat_partner_payment_fields`）
2. 部署后端；保持 `WECHAT_PARTNER_ENABLED=false`，回归 b/c 两条链路（短信充值、会员/额度各做一次 1 分钱下单 + 回调 + 退款）
3. 填齐 `wechat.partner.*` 全部变量
4. 置 `WECHAT_PARTNER_ENABLED=true` 并重启（启动自检会自动校验配置完整性）
5. 挑一个门店：保存子商户号 → 校验 → 1 分钱真实下单 → 回调入账 → 1 分钱退款
6. 观察 `club_payment_callback_failures` 死信表与解密/验签日志

**回滚**：
1. `WECHAT_PARTNER_ENABLED=false` 并重启（立即回到旧直连逻辑，不需要改代码）
2. 如需撤表：先完成第 1 步，再执行
   `prisma/rollback/20261029120000_add_wechat_partner_payment_fields.rollback.sql`
3. 数据回填可重跑：`pnpm wechat:partner:sub-mchid:backfill`（默认 dry-run，加 `--apply` 才写库，幂等）

**灰度口径**：当前按**环境开关**；门店白名单留作后续开关粒度升级（未实现）。

---

## 六、错误码对照

### 6.1 子商户绑定校验（`verify` 接口探测）

| 微信返回码 | 判定 | 页面展示 |
|-----------|------|---------|
| `ORDER_NOT_EXIST` / `NOT_FOUND` | 关系正常（`verified`） | 子商户绑定关系正常，可以正常收款 |
| `NO_AUTH` | 未绑定/未授权（`failed`） | 该子商户号尚未与本平台服务商绑定或未授权 |
| `MCH_NOT_EXISTS` / `MCHID_NOT_EXIST` | 商户号不存在（`failed`） | 该子商户号在微信支付侧不存在，请核对 |
| 其它 / 网络异常 | 未知（`pending`） | 暂时无法确认绑定关系，请稍后重试（**不会误判为可用**） |

### 6.2 下单 / 查单 / 关单 / 退款常见码

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `NO_AUTH` | 子商户未与服务商绑定 | 引导商家完成绑定授权后重新校验 |
| `MCH_NOT_EXISTS` | 商户号不存在 | 核对子商户号 |
| `APPID_MCHID_NOT_MATCH` | AppID 与商户号不匹配 | 检查 `WECHAT_PARTNER_SP_APP_ID` 是否绑定在该服务商下 |
| `PARAM_ERROR` / `INVALID_REQUEST` | 参数不合法 | 检查 body 是否混用了直连字段（`appid/mchid/openid`）与服务商字段 |
| `ORDERPAID`（关单时） | 用户其实已付款 | **不能**关本地单，保持 pending 等回调 |
| `ORDER_NOT_EXIST`（关单时） | 微信侧无此单 | 等价于不可支付，可安全翻转 expired |
| `NOTENOUGH`（退款） | 子商户可用余额不足 | 提示商家充值后重试 |

### 6.3 回调处理

| 现象 | 原因 | 处理 |
|------|------|------|
| 回调验签失败 | 用了平台商户号维度的证书去验服务商链路的签名 | 配 `WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT` |
| 回调解密失败 | 服务商 APIv3 密钥配错或已轮换 | 核对 `WECHAT_PARTNER_API_V3_KEY`；**不要**拿门店密钥顶替 |
| 日志「资金归属异常」并拒绝入账 | 回调里的 `sp_mchid`/`sub_mchid` 与配置不一致 | 商家可能已换绑子商户，需重新保存 + 校验 |

---

## 七、上线前验证清单

> 可执行版（命令 + SQL + 失败对照）：**`docs/wechat-partner-live-acceptance.md`**；
> 自动自检脚本：`pnpm wechat:partner:live-check`。下面只列判定项。

- [ ] 已确认 `WECHAT_PAY_MCH_ID` 即服务商商户号，且已填豁免与原因
- [ ] `wechat.partner.*` 全部变量已配（含 `WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT`）
- [ ] 启动自检通过（服务能起来即代表配置完整性校验已过）
- [ ] `WECHAT_PARTNER_ENABLED=false` 时：b/c 两条链路各做一次 1 分钱下单 + 回调 + 退款，全绿
- [ ] `=true` 时：试点门店保存子商户号 → 校验通过（`bind_status=verified`）
- [ ] 试点门店 1 分钱真实下单：小程序能拉起、支付成功、回调验签通过、**解密用服务商密钥**、`sp_mchid/sub_mchid` 落库且与回调一致
- [ ] 1 分钱退款成功（请求带 `sub_mchid`，查单状态正确）
- [ ] 未绑定/绑错子商户时：下单有明确中文提示，前端展示「校验失败 + 原因」
- [ ] 商家 A 的配置不会被商家 B 读取或篡改（越权用例）
- [ ] 回调不再遍历门店密钥（日志中不应出现「缓存中的 APIv3Key 全部解密失败」）
- [ ] Nginx 放行 `/api/club/payments/wechat/callback` 公网 POST

---

## 八、与代码侧对应关系（备查）

| 能力 | 代码位置 |
|------|----------|
| 配置读取 | `src/config/configuration.ts` → `wechat` / `wechat.partner` |
| 启动校验 | `src/bootstrap/wechat-partner-config.validator.ts` |
| 支付身份解析（唯一真相源） | `src/purely-club/payments/club-wechat-pay-identity.service.ts` |
| 签名与请求（按凭据作用域） | `src/purely-club/payments/club-wechat-pay-http.service.ts` |
| 下单 / 查单关单 / 退款 | `club-wechat-jsapi.service.ts`、`club-wechat-transaction.service.ts`、`club-wechat-refund.service.ts` |
| 回调解密（服务商密钥） | `src/purely-club/payments/club-wechat-callback-decryptor.service.ts` |
| 回调验签（按链路选证书） | `src/purely-club/payments/club-payment-callback-signature.service.ts` |
| 子商户绑定校验 | `club-wechat-sub-merchant-verify.service.ts`、`stores-wechat-pay-bind.service.ts` |
| 订单支付身份落库 / 读取 | `src/purely-club/payments/club-payment-order-record.service.ts` |
| 迁移 / 回滚 / 回填 | `prisma/migrations/20261029120000_*`、`prisma/rollback/20261029120000_*`、`scripts/backfill-store-wechat-sub-mch-id.mjs` |

---

## 九、常见坑

1. **把平台证书公钥直接换成服务商维度的**：b/c 两条链路验签会同时失效。必须新增 `WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT`，不能改原来的。
2. **用 `WECHAT_PAY_MCH_ID` 当收款商户号下单**：钱会落进平台而不是商家。资金去向只能由 `sub_mchid` 决定。
3. **服务商模式下还让商家填 APIv3 密钥**：子商户没有这个东西，填了说明它可能是直连商户，需先完成特约商户绑定。
4. **回调解密失败就去翻门店密钥**：服务商模式下回调由服务商密钥加密，遍历门店密钥 100% 失败（改造前正是这么做的，已删除）。
5. **`sp_mchid` 与 `payMchId` 同号但没开豁免**：启动直接失败。这是刻意的，防止误填。
6. **回调地址三条混用**：会把别链路的订单当成 C 端订单入账。`WECHAT_PARTNER_PAY_NOTIFY_URL` 必须以 `/api/club/payments/wechat/callback` 结尾。
7. **门店换绑子商户后历史订单退款**：退款优先取订单落库的子商户号；历史单据没有记录时会回落门店当前配置并**告警**，需人工核对。
8. **未做真实支付就宣称上线**：本改造的所有结论中，真实 1 分钱下单/退款部分必须由你按第七节实际跑一遍才算完成。
