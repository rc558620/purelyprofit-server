# 微信支付接入下一步行动文档

> 前置：个体户执照 ✅、小程序企业认证 ✅、ICP 备案 ✅、小程序已发布（线上 1.0.0）✅。
> 本步目标：申请微信支付商户号 → 把密钥填入后端 `production.env` → 把商户号/密钥写入数据库 → 配置支付回调域名 → 打通收款。
> 代码事实依据：`src/config/configuration.ts`（wechat 块）、`src/purely-profit/stores/*wechat-pay*`、`.env.example`（微信区块）、`src/bootstrap/bootstrap.ts:263`（全局前缀 `api`）。
> 文档日期：2026-09-14。

---

## 〇、先看清楚：哪类配置走环境变量，哪类走数据库

这是最容易搞混的点，务必分清：

| 配置项 | 注入方式 | 原因 |
|--------|----------|------|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | **环境变量** | 小程序登录（code2session）全局共用 |
| `WECHAT_MCH_SERIAL_NO` / `WECHAT_PRIVATE_KEY_*` | **环境变量** | 商户 API 证书（RSA 私钥 + 序列号） |
| `WECHAT_PAY_NOTIFY_URL` | **环境变量** | 支付回调公网地址 |
| `WECHAT_PLATFORM_PUBLIC_KEY_CONTENT` | **环境变量** | 回调验签平台公钥（可选但建议） |
| `WECHAT_PAY_KEY_ENCRYPTION_SECRET` | **环境变量** | 加密存库的 APIv3 密钥（**必须，缺则无法保存**） |
| `mchId` / `mchName` / `apiV3Key` | **写数据库** | 通过商家端管理接口 `UpdateWechatPayConfigDto` 入库，由 `StoresWechatPayService` 加密落库 |

> 也就是说：证书类、回调地址类走 env；**商户号 + APIv3 密钥是运行时通过商家后台页面填的，最终存数据库**（加密后存 `storeWechatPayConfig` 表）。两者缺一不可。

---

## 一、申请微信支付商户号

**入口**：https://pay.weixin.qq.com → 注册/接入 → 选择「**个体工商户**」主体。

**材料**（执照已齐，直接可用）：
- 个体户营业执照（统一社会信用代码）
- 经营者身份证
- 经营者结算银行卡（对私账户即可）
- 已认证的 purelyClub 小程序 AppID：`wxb2533a73dc3764b5`

**申请内容**：
- 开通 **JSAPI 支付**（扫码点餐下单 `POST /api/club/scan-ordering/orders` 用的就是这个）
- 同步支持 Native/小程序支付场景

**产出（务必全部保存）**：
1. **商户号 `mchId`**：10 位纯数字（如 `1234567890`）
2. **APIv3 密钥 `apiV3Key`**：32 位字符串（商户平台「账户中心 → API 安全」自己设置）
3. **API 证书**：在「账户中心 → API 安全 → 申请证书」下载，得到：
   - `apiclient_key.pem`（商户 API RSA 私钥）
   - 证书序列号 `serial_no`（40 位十六进制）→ 对应 `WECHAT_MCH_SERIAL_NO`
4. 微信支付平台公钥（用于回调验签，可在「账户中心 → API 安全」或调用 `GET /v3/certificates` 获取）→ 对应 `WECHAT_PLATFORM_PUBLIC_KEY_CONTENT`

---

## 二、填 `production.env` 微信支付区块

按 `.env.example` 微信区块（第 190–217 行）补全。生产环境文件为 `/etc/purelyprofit-server/production.env`。

```bash
# ── 小程序（全局共用）──
WECHAT_APP_ID=wxb2533a73dc3764b5
WECHAT_APP_SECRET=你的小程序AppSecret        # 公众平台 → 开发 → 开发设置 → AppSecret

# ── 商户 API 证书 ──
WECHAT_MCH_SERIAL_NO=你的证书序列号          # 商户平台 → 账户中心 → API 安全
# 私钥二选一：生产推荐文件路径（权限 600）
WECHAT_PRIVATE_KEY_PATH=/etc/secrets/apiclient_key.pem
# 或内联内容（Docker/CI 注入，换行用字面 \n）：
# WECHAT_PRIVATE_KEY_CONTENT=-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----

# ── 支付回调（公网 HTTPS，含全局前缀 /api）──
WECHAT_PAY_NOTIFY_URL=https://api.你的域名.com/api/club/payments/wechat/callback

# ── 回调验签平台公钥（建议配置）──
WECHAT_PLATFORM_PUBLIC_KEY_CONTENT=-----BEGIN PUBLIC KEY-----\nMIIBIj...\n-----END PUBLIC KEY-----

# ── APIv3 密钥加密主密钥（32 字节，.env.example 未列出，必须自行添加！）──
WECHAT_PAY_KEY_ENCRYPTION_SECRET=自己生成的32字节随机串
```

**关键提醒**：
- `WECHAT_PAY_KEY_ENCRYPTION_SECRET` **不在 `.env.example` 中，但代码强制要求**（`src/purely-profit/stores/wechat-pay-encryption.service.ts`：未配置则保存商户配置报 400）。必须自己加，且长度需 32 字节（任意 32 字符即可，建议随机生成）。
- `WECHAT_PAY_NOTIFY_URL` 必须是**已备案的 HTTPS 公网地址**，且路径严格为 `/api/club/payments/wechat/callback`（全局前缀 `api` 来自 `bootstrap.ts:263`，回调路由来自 `club-payments.controller.ts` 的 `@Controller('club/payments')` + `@Post('wechat/callback')`）。
- 所有密钥严禁提交 Git；统一放 `production.env` 或密钥管理服务。

---

## 三、把商户号/密钥写入数据库（商家后台操作）

环境变量解决证书与回调，**商户号与 APIv3 密钥需通过商家端后台页面写入数据库**：

1. 确保 `WECHAT_PAY_KEY_ENCRYPTION_SECRET` 已配（否则下一步保存会失败）。
2. 登录 purelyProfit 商家端 → 门店设置 → 微信收款配置。
3. 填写：
   - `mchId`：步骤一产出的 10 位商户号
   - `mchName`：商户名称（如「纯利宝」）
   - `apiV3Key`：32 位 APIv3 密钥
4. 保存后，后端 `StoresWechatPayService.updateWechatPayConfig` 会用 `WECHAT_PAY_KEY_ENCRYPTION_SECRET` 加密 `apiV3Key` 落库到 `storeWechatPayConfig` 表。

> 该接口路径在商家端模块内（非本文重点），如不确定入口，可在 purelyProfit 门店设置页查找「微信收款 / 支付配置」。

---

## 四、配置支付回调域名（商户平台侧）

微信支付 v3 的回调地址由代码发起支付时按 `WECHAT_PAY_NOTIFY_URL` 传入，但商户平台仍需保证该域名可信：

1. 商户平台 → **账户中心 → API 安全**：确认 APIv3 密钥、API 证书已配置。
2. 确认 `WECHAT_PAY_NOTIFY_URL` 中的域名（`api.你的域名.com`）已完成 ICP 备案且 HTTPS 可达。
3. 若商户平台有「支付回调域名 / 授权域名」配置项，把 `api.你的域名.com` 加入白名单。
4. 微信商户平台「产品中心 → JSAPI 支付」确认产品已开通，且 AppID `wxb2533a73dc3764b5` 已绑定到该商户号（「AppID 账号管理」中关联）。

---

## 五、上线前验证清单

- [ ] 商户号申请完成，JSAPI 支付已开通
- [ ] `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 已填且为 `wxb2533a73dc3764b5`
- [ ] `WECHAT_MCH_SERIAL_NO` 与下载的证书序列号一致
- [ ] `WECHAT_PRIVATE_KEY_PATH` 指向的 pem 文件存在且权限 600（或 `WECHAT_PRIVATE_KEY_CONTENT` 已填）
- [ ] `WECHAT_PAY_NOTIFY_URL` = `https://api.你的域名.com/api/club/payments/wechat/callback`
- [ ] `WECHAT_PAY_KEY_ENCRYPTION_SECRET` 已配（32 字节）
- [ ] 商家后台已保存 `mchId` / `mchName` / `apiV3Key` 到数据库（接口返回 `configured: true`）
- [ ] 小程序 AppID 已在商户平台关联到该商户号
- [ ] Nginx 已放行 `/api/club/payments/wechat/callback` 公网 POST（默认已随 `/api` 暴露）

---

## 六、与代码侧对应关系（备查）

| 配置 | 代码位置 |
|------|----------|
| 微信配置读取 | `src/config/configuration.ts` → `wechat` 块（第 375–424 行） |
| APIv3 密钥加密/解密 | `src/purely-profit/stores/wechat-pay-encryption.service.ts` |
| 商户配置存库 | `src/purely-profit/stores/stores-wechat-pay.service.ts`（`updateWechatPayConfig` / `getWechatPayConfigForStore`） |
| 配置 DTO | `src/purely-profit/stores/dto/wechat-pay-config.dto.ts`（`mchId` 10 位、`apiV3Key` 32 位） |
| 支付回调路由 | `src/purely-club/payments/club-payments.controller.ts` → `POST /api/club/payments/wechat/callback` |
| 全局前缀 | `src/bootstrap/bootstrap.ts:263` → `setGlobalPrefix('api')` |
| env 模板 | `.env.example` 第 190–217 行（微信支付区块） |

---

## 七、常见坑

1. **只填了 env 没存库**：证书/回调能读，但下单时查不到 `mchId`/`apiV3Key` → 收款失败。必须两步都做。
2. **漏了 `WECHAT_PAY_KEY_ENCRYPTION_SECRET`**：商家后台保存收款配置直接 400。
3. **回调地址少了 `/api`**：路径必须是 `/api/club/payments/wechat/callback`，少前缀会导致微信回调 404。
4. **回调用 localhost / IP / 自签证书**：微信拒绝，必须用已备案 HTTPS 域名。
5. **AppID 未绑定商户号**：JSAPI 支付报「appid 与商户号不匹配」。
6. **`CLUB_MANUAL_CONFIRM_PAID_ENABLED` 生产须为 false**：默认开发为 true（跳过真实支付），生产环境要在 `production.env` 显式设为 `false`，否则订单只走手动确认、不会真正调用微信支付（`src/config/configuration.ts` club 块）。
