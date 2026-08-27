# purelyProfit + purelyprofit-server + purelyClub 上线待办清单

> 适用场景：副业个人开发者，无实体门店，纯线上经营（微信小程序扫码点餐 / 商家后台 / 后端服务）。
> 核心思路：**用「网络经营场所登记」办个体户执照（零租办公室成本）** → 注册小程序 → 开微信支付 → 部署服务器上线。
> 文档生成日期：2026-08-25。

---

## 〇、全局前提与法律卡点

| 卡点 | 是否必须 | 说明 |
|------|----------|------|
| 个体户/企业营业执照 | **必须** | 微信支付商户号、小程序企业认证、域名 ICP 备案都依赖它。个人主体小程序不能开微信支付。 |
| 实体办公室 | **不需要** | 纯线上经营走「网络经营场所登记」，用小程序链接当经营场所，合法且零租金。 |
| 服务器 / 数据库 / 部署 | 独立 | 不依赖执照，可并行推进（见第六节）。 |

> 提醒：若窗口说「必须租办公室才能办照」，多为代办图省事或理解偏差。直接问：「我做的是纯微信小程序电商，能否走网络经营场所登记，或用住宅地址？」

---

## 一、完整顺序总览

```
[1] 注册 purelyClub 微信小程序账号（用个体户信息）
        │ 拿到 AppID / 小程序店铺页链接
        ▼
[2] 云南省智能开办 → 网络经营场所登记（填小程序链接）→ 拿个体户执照
        │
        ▼
[3] 微信公众平台：用执照完成小程序企业认证
        │
        ▼
[4] 申请微信支付商户号（个体户主体）→ 拿到商户号 + APIv3 密钥/证书
        │
        ▼
[5] 准备域名 + ICP 备案 + HTTPS/WSS 证书（备案需执照主体）
        │
        ▼
[6] 服务器部署（purelyprofit-server 后端 + 前端 CI/CD）→ 技术侧 D 阶段
        │
        ▼
[7] 生产环境联调冒烟（重跑 e2e 脚本）→ 正式上线
```

---

## 二、[1] 注册 purelyClub 微信小程序账号

**目的**：先有小程序的 AppID 和店铺页，才能作为「网络经营场所」去办照。

**入口**：微信公众平台 https://mp.weixin.qq.com → 注册小程序账号。

**材料**：
- 个体户经营者本人微信号 + 身份证
- 个体户名称（可先用「昆明市xx区xx经营部」之类，后续执照下来再改主体信息）
- 一个未注册过公众号/小程序的邮箱

**产出**：
- 小程序 **AppID**（gh_ 开头的原始 ID 和 AppID 字符串）
- 小程序后台「设置 → 基本设置」页（可作为网络经营场所证明截图）

**注意**：
- 注册时主体类型先选「个人」也能拿到 AppID 用于占位；但**最终必须用个体户执照做企业认证**才能开微信支付（见 [3]）。
- 建议直接用个体户信息注册，减少后续主体变更麻烦。

---

## 三、[2] 网络经营场所登记办个体户执照

**目的**：合法主体，零租办公室成本。

**入口（官方免费）**：
- 微信小程序搜「**云南省市场主体智能开办**」或「**云南省市场监管公共服务平台**」
- 或「**一部手机办事通**」APP
- 或电脑端「云南市场监管网上办事大厅 → 个体工商户专区 → 个体工商户智能化开办」

**办理路径**：个体工商户登记 → 网络经营场所登记 → 填写** purelyClub 小程序链接 / AppID** 作为经营场所。

**材料**：
- 经营者身份证
- 个体户名称、经营范围（见下方建议）
- 网络经营场所证明（[1] 拿到的小程序店铺页截图/链接）
- 实名核验（人脸识别）

**经营范围建议写法**（供窗口核定参考，避免只写软件开发导致餐饮相关被卡）：
- `信息技术服务` / `软件开发` / `互联网信息服务`
- `食品互联网销售`（若涉及餐饮外卖、团购核销）
- `餐饮服务（仅限网络经营）` 或按当地口径

**周期**：一般 2–5 个工作日，智能化开办多数当场或次日下证。

**产出**：《个体工商户营业执照》（含统一社会信用代码）。

---

## 四、[3] 小程序企业认证

**目的**：将 purelyClub 小程序主体从个人升级为个体户，解锁微信支付与合法经营标识。

**入口**：微信公众平台 → purelyClub 小程序 → 设置 → 微信认证。

**材料**：
- 个体户营业执照
- 经营者身份证
- 对公账户或经营者个人银行卡（认证打款验证用）
- 300 元/年认证费

**产出**：小程序企业认证通过，主体类型=个体工商户。

---

## 五、[4] 微信支付商户号

**目的**：扫码点餐下单、会员充值、团购核销等所有收款的必备前提。

**入口**：微信支付商户平台 https://pay.weixin.qq.com → 接入成为商户（选择「个体工商户」）。

**材料**：
- 个体户营业执照
- 经营者身份证
- 经营者结算银行卡
- 小程序 AppID（已认证）
- 门店/经营信息

**产出**：
- **商户号（mch_id）**
- **APIv3 密钥**、**API 证书（apiclient_cert.pem / key.pem）**、**证书序列号**
- 开通 **JSAPI 支付**（扫码点餐下单用，见 `src/purely-club/scan-ordering/club-scan-ordering-payment.service.ts`）

**关键配置（对接代码侧）**：
- 后端 `src/purely-profit/stores/wechat-pay-encryption.service.ts`、`stores-wechat-pay.service.ts` 读取商户配置。
- 生产环境变量（`/etc/purelyprofit-server/production.env`）填入：商户号、APIv3 密钥、证书内容、APPID。
- 支付回调地址：`POST /api/club/payments/wechat/callback`（需求文档 5.3 节），需在商户平台配置支付回调域名（必须是已备案 HTTPS 域名）。

---

## 六、[5] 域名 + 备案 + 证书

**目的**：正式环境 API、管理端、小程序 WebSocket 都需要真实已备案域名 + TLS 证书（localhost/IP/自签均不能用于正式小程序）。

**步骤**：
1. 注册一个域名（如 `api.yourdomain.com`、`admin.yourdomain.com`）。
2. **ICP 备案**（工信部，需执照主体信息，个人/个体户均可备）。周期约 1–3 周。
3. 申请 HTTPS/WSS 证书（Let's Encrypt 免费或云厂商证书，配置自动续期）。

**小程序后台配置**（微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名 / 业务域名 / socket 合法域名）：
- 将 `https://api.yourdomain.com` 加入 request 合法域名
- 将 `wss://api.yourdomain.com` 加入 socket 合法域名

**构建时环境变量**：
- purelyClub：`TARO_APP_WS_BASE_URL=https://api.yourdomain.com`（运行期转 `wss://api.yourdomain.com/api/ws/scan-ordering`）
- purelyProfit（若与 API 不同域）：`VITE_SOCKET_BASE_URL=https://api.yourdomain.com`

---

## 七、[6] 服务器部署（技术侧 D 阶段，不依赖执照，可并行）

> 详见 `deploy/PRODUCTION_REALTIME_ACCEPTANCE.md` 与 `docs/profit-manual-entry/handoff.md` 阶段 D。

**基础设施**：
- 至少 1 台（建议 2 台高可用）装 Node.js + pnpm 的 API 服务器
- 共享 PostgreSQL + Redis（Socket.IO Redis Adapter 跨 Worker 广播）

**后端部署（purelyprofit-server）**：
- `deploy/systemd/purelyprofit-server.service` 注册服务，初始 `CLUSTER_WORKERS=2`
- `deploy/nginx/purelyprofit.conf` 替换真实域名/证书/upstream 私网地址
- `/etc/purelyprofit-server/production.env` 填：生产库、Redis、JWT、CORS、**微信支付密钥**（[4] 产出）
- 确认 Prisma migration 在部署流程执行（`.github/workflows/deploy-production.yml`）
- 新增环境变量同步 `.env.example`

**前端部署**：
- purelyProfit：走 `.github/workflows/deploy.yml` CI/CD
- purelyClub：小程序上传审核发布（需 [3] 认证 + [5] 域名配置完成）

**发布前检查**：
```bash
pnpm run build
pnpm run realtime:ready   # 必须 database=up / redis=up / realtime=up
sudo nginx -t && sudo systemctl reload nginx
```

**Cluster 验收**：`CLUSTER_WORKERS=2 pnpm start:cluster` → 小程序下单、管理端实时收单、终止 worker 自动重连。

---

## 八、[7] 生产环境联调冒烟

**目的**：正式切流前验证全链路。

- 后端：`node scripts/manual-entry-e2e.mjs <生产地址>`（handoff.md C1 三条场景：团购到店 / 第三方外卖 / 普通堂食自取，18/18 断言）
- 扫码点餐：`test/scan-ordering-club-bridge.e2e-spec.ts`、扫码点餐联调脚本
- 支付：用真实商户号走一笔小额支付 → 回调确认 → 订单状态 `pending_acceptance`
- 实时：管理端不刷新自动收到新订单、状态同步

全部通过后再将流量切入生产。

---

## 九、材料速查表

| 步骤 | 核心材料 | 产出 |
|------|----------|------|
| [1] 小程序注册 | 微信、身份证、邮箱 | AppID、店铺页 |
| [2] 网络经营场所登记 | 身份证、小程序链接、经营范围 | 个体户营业执照 |
| [3] 企业认证 | 执照、身份证、银行卡、300元 | 认证通过 |
| [4] 微信支付 | 执照、身份证、银行卡、AppID | 商户号、APIv3 密钥/证书 |
| [5] 域名备案 | 执照主体、域名 | 备案号、HTTPS/WSS 证书 |
| [6] 服务器部署 | 服务器、库、Redis、production.env | 生产服务运行 |
| [7] 冒烟 | 生产地址、e2e 脚本 | 上线闭环 |

---

## 十、常见坑

1. **窗口要求租办公室**：据理力争网络经营场所登记或住宅地址，纯线上经营合法。
2. **个人主体小程序不能开微信支付**：必须先用执照做企业认证。
3. **支付回调域名必须已备案 HTTPS**：localhost/自签/IP 不行。
4. **生产密钥禁提交 Git**：统一放 `production.env` 或密钥管理服务。
5. **经营范围别只写软件开发**：涉及餐饮核销加「食品互联网销售」类目。
6. **ICP 备案周期长**：尽早提交，可与服务器准备并行。
