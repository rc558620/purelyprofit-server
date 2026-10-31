# purelyProfit + purelyprofit-server + purelyClub 上线待办清单

> 适用场景：副业个人开发者，无实体门店，纯线上经营（微信小程序扫码点餐 / 商家后台 / 后端服务）。
> 核心思路：**用「网络经营场所登记」办个体户执照（零租办公室成本）** → 注册小程序 → 开微信支付 → 部署服务器上线。
> 文档生成日期：2026-08-25；上次更新：2026-09-14。

## 当前进度（2026-09-14 更新）

> ⚠️ 重要更正：此前误将「小程序可搜到 + 备案通过」等同于「执照已办成」。实际现状是——小程序为**个人主体**（30 元个人认证，非 300 元个体户认证），备案为**个人备案**（无需执照），**个体户营业执照并未办成（此前已取消）**。因此微信支付（须个体户/企业执照）目前仍不可开通。

- [x] [1] 注册 purelyClub 小程序 → AppID：`wxb2533a73dc3764b5`
- [ ] [2] 网络经营场所登记 → 个体户营业执照**未办成（此前取消，需重新办理）**
- [~] [3] 小程序认证 → 当前为**个人认证（30 元/年）**，非个体户认证；需升级为**个体工商户认证（300 元/年）**才能开微信支付
- [x] [5] 域名 + ICP 备案 → **个人备案**已通过（个人主体也能备案，不需执照）
- [x] 小程序正式发布 → 线上版本 **1.0.0**，发布于 2026-09-14，在微信可搜索「纯利宝」（个人主体可发布）

剩余卡点（按依赖顺序）：

- [ ] [2] 办个体户营业执照（网络经营场所登记，填小程序链接，不租办公室）
- [ ] [3] 小程序主体升级为个体工商户认证（300 元/年，上传执照）
- [ ] [4] 微信支付商户号（个体户）→ 详见 **`docs/wechat-pay-setup.md`**
- [ ] [6] 服务器部署 + 域名证书 + production.env 配置
- [ ] [7] 生产环境联调冒烟

> 注意：前端小程序已可搜索并打开，但当前是个人主体、无支付能力；后端未部署。必须先补齐 [2][3][4] 才能真正收款。

---

## 〇、全局前提与法律卡点

| 卡点 | 是否必须 | 说明 |
|------|----------|------|
| 个体户/企业营业执照 | **仅微信支付与个体户认证必须** | 微信支付商户号、小程序**个体户**认证依赖它；但个人主体小程序可发布、可做**个人** ICP 备案（无需执照）。个人主体小程序不能开微信支付。 |
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

> ⚠️ **C 端门店收款已改造为服务商（Partner）模式**，与上面这段「商户号 + APIv3 密钥」不同：
> 商家只需提供**子商户号 + 主体名称**并保存，再由后台点击「重新校验」通过绑定校验后才能收款；
> 签名证书与回调密钥全部由平台（服务商）持有，且**子商户在微信侧不存在自己的 APIv3 密钥与证书**。
> 完整配置口径、环境变量清单与错误码对照见 **`docs/wechat-pay-setup.md`**，本清单不再展开。

---

## 六、[5] 域名 + 备案 + 证书

**目的**：正式环境 API、管理端、小程序 WebSocket 都需要真实已备案域名 + TLS 证书（localhost/IP/自签均不能用于正式小程序）。

**域名规划（已定，生产）**：

| 域名 | 用途 | 部署位置 |
|------|------|----------|
| `chunlibao.cn` | purelyProfit 商家端（老板/店员） | Nginx 静态 ` /var/www/purelyprofit/current` |
| `www.chunlibao.cn` | 301 到根域 | Nginx 跳转 |
| `api.chunlibao.cn` | purelyprofit-server API + Socket.IO + 原生 WebSocket | Nginx 反代 `127.0.0.1:3000` |
| `pulse.chunlibao.cn` | purelyPulse 平台运营端 | Nginx 静态 `/var/www/purelypulse/current` |
| `club.chunlibao.cn` | purelyClub 邀请码落地 H5（`CLUB_PUBLIC_BASE_URL`） | Nginx 静态 `/var/www/club/current` |
| `scan.chunlibao.cn` | 桌码 / 空间码入口（`SCAN_QR_BASE_URL`） | Nginx 占位页（微信客户端直接拦截） |

> `club` 与 `scan` 必须分域：微信「扫普通链接二维码」按域名+路径前缀下发规则，共用会把邀请码一并唤起小程序。

**步骤**：
1. DNS：为以上 6 个主机名添加 A 记录，全部指向同一台服务器（`*.chunlibao.cn` 泛解析 + 根域可覆盖）。
2. **ICP 备案**（个人/个体户均可，周期约 1–3 周），未备案域名会被微信与运营商拦截。
3. 证书：推荐一张泛域名证书，避免逐个子域续期：
   ```bash
   certbot certonly --dns-<插件> -d chunlibao.cn -d '*.chunlibao.cn'
   ```
   若按子域分别签发，把 `deploy/nginx/*.conf` 里的证书路径逐个替换。
4. Nginx 部署三份文件（缺 snippet 会 include 失败）：
   ```bash
   sudo install -d /etc/nginx/snippets
   sudo cp deploy/nginx/purelyprofit.conf /etc/nginx/conf.d/api.chunlibao.cn.conf
   sudo cp deploy/nginx/chunlibao-sites.conf /etc/nginx/conf.d/
   sudo cp deploy/nginx/snippets/purelyprofit-api-proxy.inc /etc/nginx/snippets/
   sudo nginx -t && sudo systemctl reload nginx
   ```

**小程序后台配置**（微信公众平台 → 开发 → 开发管理 → 开发设置）：
- request 合法域名：`https://api.chunlibao.cn`
- socket 合法域名：`wss://api.chunlibao.cn`
- 「扫普通链接二维码」规则前缀：`https://scan.chunlibao.cn/t/`、`https://scan.chunlibao.cn/p/`

**构建时环境变量**：
- purelyClub：`TARO_APP_API_BASE_URL=https://api.chunlibao.cn`、`TARO_APP_WS_BASE_URL=https://api.chunlibao.cn`
- purelyProfit / purelyPulse：**不设置** `VITE_API_BASE_URL` / `VITE_SOCKET_BASE_URL`，默认走同源 `/api` 与 `window.location.origin`，由 Nginx 在各自域反代后端（无跨域、无 CORS 维护成本）

---

## 六点五、[5.5] CI/CD 配置（purelyprofit-server）

**链路**：`push main → CI(质量门/构建产物) → Deploy Production(SSH) → 服务器解包/迁移/切软链/重启/健康检查`。

**GitHub Secrets（production Environment）**：

| Secret | 说明 |
|--------|------|
| `SSH_HOST` | 服务器 IP 或域名 |
| `SSH_USER` | SSH 用户（建议专用 `deploy`） |
| `SSH_KEY` | 部署私钥全文（`ssh-keygen -t ed25519 -f ~/.ssh/chunlibao_deploy`） |
| `SSH_PORT` | 可选，默认 22 |
| `SSH_REMOTE_TMP` | 可选，默认 `/tmp` |

**GitHub Variables（均有默认值，可覆盖）**：`APP_DOMAIN`、`API_DOMAIN`、`APP_ROOT`、`APP_SERVICE`、`APP_ENV_FILE`、`APP_HEALTHCHECK_URL`、`APP_KEEP_RELEASES`、`RELEASE_REQUIRE_BACKUP`、`AUTO_DEPLOY_ENABLED`。

**一键注入**：
```bash
SERVER_HOST=<IP> SERVER_USER=deploy SSH_KEY_FILE=~/.ssh/chunlibao_deploy \
  bash scripts/setup-github-env.sh
```
脚本同时创建 `production Environment`、配置 main 分支保护（CI 四项检查必填）并写入上述 Secrets/Variables。

**服务器一次性准备**：

```bash
# 服务用户（跑进程）与发布用户（SSH 部署）分离：目录归发布用户，服务用户只读
sudo useradd -r -m -d /opt/purelyprofit-server -s /usr/sbin/nologin purelyprofit
sudo install -d -o <deploy_user> -g purelyprofit -m 775 /opt/purelyprofit-server/{releases,backups}
sudo chown <deploy_user>:purelyprofit /opt/purelyprofit-server

# 发布用户只被允许重启这一个 unit，不放开全量 sudo
echo '<deploy_user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart purelyprofit-server, /usr/bin/systemctl is-active purelyprofit-server' \
  | sudo tee /etc/sudoers.d/purelyprofit-release
sudo chmod 440 /etc/sudoers.d/purelyprofit-release

# 运行时环境文件：640 + 组 purelyprofit，systemd(root) 与发布用户都可读
sudo install -d -m 750 -o root -g purelyprofit /etc/purelyprofit-server
sudo install -m 640 -o root -g purelyprofit deploy/production.env.example /etc/purelyprofit-server/production.env
sudo usermod -aG purelyprofit <deploy_user>
# 逐项替换 <...>；JWT_SECRET 等用 openssl rand -base64 48 生成

sudo cp deploy/systemd/purelyprofit-server.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable purelyprofit-server
```

**发布**：
- 自动：合并到 `main` 且 CI 通过后自动发布；`AUTO_DEPLOY_ENABLED=false` 可一键降级为手动。
- 手动：Actions → Deploy Production → Run workflow，`dry_run=true` 只打印计划，首次上线务必先预演。
- 回滚：脚本在健康检查失败时自动把 `current` 切回上一版本；数据库已迁移则需先 `pg_restore` 备份（路径在失败摘要里）。

**运行时配置唯一来源**：服务器 `/etc/purelyprofit-server/production.env`（模板 `deploy/production.env.example`）。业务变量不再从 GitHub 注入，避免两处漂移。

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
