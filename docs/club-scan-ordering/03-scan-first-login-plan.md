# 扫码即点餐（Scan-First）改造计划与批次进度

> 目标：用户用微信扫一次桌码，直接进入菜单点餐。
> 免登录（无点击）、登录即注册、无需 getPhoneNumber。

---

## 1. 背景

改前的扫码点餐链路要求用户先完成「登录 + 绑手机号 + 入店」，再在小程序内**第二次**扫桌码才能点餐：

```
微信扫桌码 → 唤起小程序
  → app.tsx handleQrScene：未登录时只缓存 storeId，不登录
  → 首屏 useAuthGuard 无 token → reLaunch 登录页
  → 用户手动点「微信一键登录」
  → needPhoneBind=true → 强制 reLaunch 绑手机号页
  → 输手机号 + 拼图验证 + 短信验证码
  → joinStoreByScanCode 入店 → 首页
  → 用户自己找到「扫码点餐」入口 → 【第二次扫码】
  → 菜单页
```

根因有两个：

1. **第一次扫码的桌码被丢弃**。旧 `handleQrScene` 只从扫码内容里抠 `storeId`，桌码解析不出 `storeId` 就 `return`，桌号信息彻底丢失，所以登录后必须再扫一次。
2. **点餐被「先入店」倒逼出手机号依赖**。入店走 `Member.phone` 匹配，所以必须有手机号；但点餐链路本身只认 `user.id`，根本不需要手机号。

---

## 2. 改造后的目标链路

```
微信扫桌码（普通链接二维码 / 小程序码）
  → 统一落地页 pages/scanEntry/index
  → 读 q / scene 拿到原始扫码内容
  → 静默 Taro.login() → POST /club/auth/login/wechat   【注册 + 登录，0 点击 0 成本】
  → 忽略 needPhoneBind，仅记录标志位
  → POST /club/scan-ordering/scan/resolve  { qrToken }  【识别桌码：门店 + 桌号 + scanToken】
  → POST /club/scan-ordering/sessions      { scanToken }
  → reLaunch 菜单页
  → 点餐
```

手机号在下单前才要（见批次 2）。

---

## 3. 关键架构决策

| 决策 | 结论 | 原因 |
|---|---|---|
| 二维码落地方式 | 普通链接二维码 + 统一中转页 | 只需在公众平台配 **1 条前缀规则**，将来加场景不用改后台（规则发布有 500 次/月限额） |
| 扫码内容解析位置 | 前端只「取原始内容 + 粗分类型」，业务解析交后端 | 后端 `resolveStoreInviteQrPayload` 已是权威解析；避免两端协议漂移 |
| 桌码 token 提取位置 | **前端提取**，后端不改 | 后端 `extractQrToken` 只认 `?token=` query，路径式 `/t/xxx` 会被整条当 token 去 hash（`club-scan-ordering.service.ts:352-364`） |
| 中转页必要性 | 必须 | 菜单页调用 `useAuthGuard`（`pages/orderPkg/menu/index.tsx:16`），而 `PUBLIC_PAGE_ROUTES` 不含菜单页；若冷启动直落菜单页，`useDidShow` 会在静默登录回来前触发守卫 → 被踢回登录页 |
| 手机号获取方式 | 短信验证码（自有通道） | getPhoneNumber 需微信认证，当前主体变更审核中 |
| 手机号触发时机 | 确认订单页，下单前 | 用户意图最强、流失最少；订单产生前商家即可拿到 |

---

## 4. 批次进度

### 批次 0 — 扫码内容解析层（✅ 已完成）

| 文件 | 说明 |
|---|---|
| `purelyClub/src/utils/scanPayload.ts` | 新增。`readLaunchScanPayload`（q 优先于 scene）、`classifyScanPayload`（路径粗分） |
| `purelyClub/src/utils/__tests__/scanPayload.test.ts` | 新增。11 条单测，已全绿 |
| `purelyClub/src/app.tsx` | 修正：不再前端解析 `storeId`，改为透传**原始扫码内容**给后端权威解析 |

顺带修复的既有缺陷：

- `app.tsx` 原先把前端解析出的数字 `storeId` 传给 `joinStoreByScanCode`，而后端 `resolveStoreInviteQrPayload` 期望的是原始扫码内容（邀请码正则 `^[A-Z0-9]{6,32}$`）→ 必然解析失败，且被 `catch {}` 静默吞掉。现已改为透传原始内容，与门店选择页扫码行为一致。

### 批次 1 — 扫码直达菜单（✅ 已完成，开发者工具端到端验证通过）

| 项 | 文件 | 状态 |
|---|---|---|
| 桌码 token 提取 | `purelyClub/src/utils/scanPayload.ts` | ✅ |
| 静默登录（并发去重、不跳绑手机号） | `purelyClub/src/services/silentAuthService.ts` | ✅ |
| **扫码落地编排（已抽出，可脱离真机测试）** | `purelyClub/src/pages/scanEntry/scanEntryFlow.ts` | ✅ |
| 统一扫码落地中转页（薄组件） | `purelyClub/src/pages/scanEntry/index.tsx` + `index.module.less` | ✅ |
| 注册中转页（主包，避免分包下载延迟） | `purelyClub/src/app.config.ts` | ✅ |
| 中转页加入 `PUBLIC_PAGE_ROUTES` | `purelyClub/src/utils/routeGuard.ts` | ✅ |
| 落地页为中转页时跳过自身处理 | `purelyClub/src/app.tsx` | ✅ |
| 单测 | 见第 10 节 | ✅ 43/43 通过 |

**验收标准**：扫码 → 静默注册 → 识别桌码 → 直达菜单页，无需任何点击。

#### 验证记录（2026-09-18，微信开发者工具模拟器）

链路已端到端跑通，落地菜单页标题为「联调测试区 · 联调测试桌」——门店与桌号**均来自桌码解析**，非本地缓存。

库端证据：

| 证据 | 值 |
|---|---|
| 新账号 | `users.id = 215`，`email = club_wechat_{openid}@purelyprofit.local`，`wechat_phone = NULL` |
| 新会话 | `scan_ordering_sessions.id = 295`，`club_user_id = 215`，`store_id = 37`，`table_id = 60`，`status = active` |
| 时序 | 建号 `…07.196` → 建会话 `…07.267`，**仅相差 71ms**，证明「静默注册」与「建点餐会话」在同一次扫码内连贯完成，中间无用户操作 |
| 脏数据 | 库中「有 openid 且无手机号」的用户仅 1 条，即上述账号——静默注册未产生冗余账号 |

> 表时间戳为库内 UTC 值，与本机时区存在偏移（项目已知问题，参见 `scripts/check-sql-timezone.mjs`）。

#### 验证中发现并修复的缺陷：扫码点餐从不创建会员档案

首轮端到端验证在「下单 → 结算」阶段暴露出 404 `当前账号暂无可访问门店`（`/api/club/member/account`）。库端取证：

| 表 | 现状 |
|---|---|
| `users` | `wechat_phone` 已写入真实手机号（绑定本身成功） |
| `scan_ordering_sessions` | 会话存在，`club_user_id` 正确 |
| `marketing_customers` | 已建（`club_user_id` 绑定），但 **`phone` 为 null** |
| `members` | **完全不存在** |

两个独立缺陷：

| # | 缺陷 | 后果 |
|---|---|---|
| 1 | 扫码点餐链路**从不创建 `Member`**——`ClubScanOrderingMarketingCustomerService.resolveActiveCustomer` 只建 `MarketingCustomer` | `ClubStoreAccessService.findAccessibleStores` 按 `Member.phone` 匹配门店 → 空 → 一切以「当前门店」为前提的接口 404（`/club/member/account`、余额支付等） |
| 2 | `migrateWechatPlaceholderPhone` 只匹配 `phone = club_wechat:{openid}` | `resolveActiveCustomer` 在用户未绑手机号时把 `phone` 落成 **null**，匹配不到 → 绑手机号后 phone 仍为 null → **商家端按手机号查不到该顾客**（恰是本次改造的核心目的） |

**修复**：

| 改动 | 文件 |
|---|---|
| 新增 `ensureStoreMembership(user, storeId)`：按门店 ID 复用入店链路的档案同步逻辑，并清可访问门店缓存 | `src/purely-club/stores/club-store-access.service.ts` |
| `upsertMemberAndCustomer` 增加可选 `clubUserId`：优先按 `(storeId, clubUserId)` 复用营销档案（否则会重复建档），仅在 `phone` 缺失时补齐，不覆盖已有真实手机号 | `src/purely-club/stores/club-member-binding.service.ts` |
| `createOrRestoreSession` 建会话前调用 `ensureStoreMembership`——**到店消费即成为该门店会员** | `src/purely-club/scan-ordering/club-scan-ordering.service.ts` |
| `migrateWechatPlaceholderPhone` 兜底同步「仅 `club_user_id` 绑定、`phone` 为 null」的营销档案 | `src/purely-club/auth/club-auth.service.ts` |

**设计要点**：扫码点餐与邀请码入店现在**共用同一套档案同步逻辑**（`ClubMemberBindingService`），差异仅在「门店从哪来」（inviteCode vs 桌码解析出的 storeId）。这样两条路径写出的数据语义必然一致，不会再分叉出第二套会员身份。

**测试**：`club-store-access.service.spec.ts` 新增 3 例、`club-scan-ordering.service.spec.ts` 新增 2 例；`purely-club` 全量 402 例通过。

> 新增用例当场抓出一个实现 bug：`table` 查询的 `select` 未包含 `storeId`，导致传入门店 ID 为 `undefined`（已改用 `scanContext.storeId`）。这类"字段没 select 出来"的问题单测跑不出来，说明该用例值得保留。

#### 修复后的端到端验收（2026-09-18）

重新扫码走完整链路后全流程通过：

| 环节 | 结果 |
|---|---|
| 支付页余额查询（`/club/member/account`） | 不再 404 |
| 下单 + 支付 | 成功。`scan_orders.id = 709`，`club_user_id = 215`，`status = completed` |
| 会员档案 | `members` 新增 `id = 15`：`store_id = 37`、`phone = 15919654010`、`name = 纯利会员4010` |
| 营销顾客 | `marketing_customers.id = 45` 的 `phone` 由 `null` 同步为 `15919654010`，`name` 同步为 `纯利会员4010` |
| purelyProfit「会员用户」列表 | 显示「纯利会员4010 / 15919654010 / 新客 / 消费 1 次」 |
| 二次支付 | 不再弹绑定手机号页（`needPhoneBind` 已为 false），符合预期 |

**结论**：C 端一次扫码即可完成「静默注册 + 识别桌码 + 点餐 + 支付」，且商家端能按手机号看到该顾客及其消费记录——本次改造的核心目的（purelyProfit 需要 C 端手机号）已达成。

#### 第二轮验收：新手机号 + 完整绑定链路（2026-09-18）

上一轮复测时账号**已绑过手机号**，Member 是直接用真实手机号创建的——**占位手机号迁移分支根本没被走到**。为覆盖它，先把账号还原为「扫码进来了但未绑手机号」状态，再用**新手机号 15919654011** 重跑全链路：

| 环节 | 结果 |
|---|---|
| 静默登录 | `needPhoneBind = true` |
| 提交订单 | 跳转绑定手机号页 |
| 短信验证码 | `send-bind-phone-code` 响应体带 `code`（`AUTH_EXPOSE_CODE_IN_RESPONSE=true`），拼图 `captchaToken` 校验通过 |
| 绑定 | 成功，自动返回确认订单页 |
| 下单 + 支付 | 成功。`scan_orders.id = 710`，`status = completed` |
| `users.wechat_phone` | `15919654011` |
| `members.id = 15` | `phone` 由 `club_wechat:o6Al43…R5Y` **迁移为** `15919654011` |
| `marketing_customers.id = 45` | `phone` 由 `null` **补齐为** `15919654011`，余额 ¥6450.7 **完整保留** |
| 占位记录残留 | `members` 中 `phone LIKE 'club_wechat:%'` → **0 条**，迁移彻底无残留 |
| purelyProfit 列表 | 显示「15919654011 / 新客 / 消费 1 次」 |

**这一轮才真正验证了 P0 修复**：占位手机号 → 真实手机号的迁移、以及 `phone` 为 null 的营销顾客兜底补齐，都在真实操作中被走到。

#### 顺带修复：绑定手机号后展示名未同步

上轮验收发现会员名为「纯利会员HR5Y」——取自 openid 后 4 位，对商家没有意义。

| 改动 | 文件 |
|---|---|
| 抽出共享的 `buildClubMemberDisplayName(phone, name)` | `src/purely-profit/auth/auth.utils.ts` |
| `resolveDisplayName` 改用它（同时清掉原实现里两个分支完全相同、恒等的三元表达式） | `src/purely-club/stores/club-store-access.service.ts` |
| 绑手机号迁移时同步自动生成的展示名 | `src/purely-club/auth/club-auth.service.ts` |

**安全性**：仅在 `name` 恰好等于「由占位手机号派生出的自动名」时才更新，不会覆盖商家在 purelyProfit 手动改过的名字。

**验证方式**：断言 `member.updateMany / marketingCustomer.updateMany` 被以 `{ where: { phone, name: '纯利会员_abc' }, data: { name: '纯利会员8000' } }` 调用（openid 后 4 位 → 手机号后 4 位）。

**payload 注入来源**：启动参数 `q`/`scene` 优先，回退页面参数 `payload`/`q`（`readScanEntryPayload`）。
后者用于小程序码 `page` 带参、页面内跳转等**无法走冷启动参数**的场景——`scene` 上限 32 字节放不下 43 位的桌码 token，所以小程序码只能靠 `page` 带参。

**已知约束（刻意不修）**：裸桌码 token 无法按路径分类，会走门店入店兜底分支。
原因：裸 token 与裸邀请码无可靠形态区分，按形态猜测会引入静默误判；且裸 token 不是合法 URL，本就命中不了「扫普通链接二维码」规则。小程序内扫码入口直接调 `resolve`，不受影响。

**配套修复：统一扫码 token 提取**（消除 URL 迁移隐患）

服务端 `ClubScanOrderingService.extractQrToken` 只识别 `?token=` query 形式，
路径式 URL 会被整条当作 token 参与 sha256 匹配。二维码内容从「裸 token / 自定义协议」
迁移为 https URL 后，所有扫码入口都必须先在前端提取。以下两处已统一到 `scanPayload.ts`：

| 入口 | 原实现 | 现状 |
|---|---|---|
| `src/pages/home/components/ScanOrderEntry/ScanOrderEntry.tsx` | 直接把扫码原文当 token | 改用 `extractTableToken` |
| `src/pages/home/components/ServiceCallEntry/ServiceCallEntry.tsx` | 只认 `purelyclub://space-scan?token=` | 改用 `extractSpaceToken`，兼容路径式 URL / query 式 URL / 历史自定义协议 |

### 批次 1.2 — 二维码载荷 URL 化（✅ 已完成，待配置域名）

| 项 | 文件 | 状态 |
|---|---|---|
| 新增桌码 / 空间码载荷构建（未配置域名回退历史格式） | `src/purely-profit/operations/scan-qr-payload.utils.ts` | ✅ |
| 抽出共享公共域名校验（三条二维码协议共用） | `src/shared/qr-public-url.utils.ts` | ✅ |
| 邀请码工具改为复用共享校验（删除本地重复的 IP 段判断） | `src/purely-profit/stores/store-invite-code-qr.utils.ts` | ✅ |
| 桌码生成改用 URL 载荷 | `src/purely-profit/operations/scan-ordering/scan-ordering-qr.service.ts` | ✅ |
| 空间码生成改用 URL 载荷（`purelyclub://` 仅作回退） | `src/purely-profit/operations/spaces/space-qr-code.service.ts` | ✅ |
| 新增 `club.scanQrBaseUrl`（env `SCAN_QR_BASE_URL`） | `src/config/configuration.ts`、`.env.example` | ✅ |
| 单测（含「默认回退历史格式」「前后端路径契约」） | `src/purely-profit/operations/scan-qr-payload.utils.spec.ts` | ✅ |

**为什么现在做而不是等主体变更**：这条路径不依赖微信审核（只依赖域名备案），
且**不配置环境变量时行为与改造前完全一致**，属于纯增量；提前做完，
域名就绪后只需改环境变量，不必再动代码、也不必在"等审核"期间夹着改代码调 bug。

**为什么必须独立域名**：见第 7 节——与邀请二维码共用域名时，「扫普通链接二维码」规则
容易把 `{base}/i/...` 一并唤起小程序，破坏邀请二维码的 H5 落地。

### 批次 2 — 手机号绑定（✅ 已完成，待真机验证）

| 项 | 文件 | 状态 |
|---|---|---|
| **修复 `bindPhone` 分支 B 不迁移 `Member`/`MarketingCustomer`** | `src/purely-club/auth/club-auth.service.ts` | ✅ |
| 后端抽 `bindVerifiedPhone(userId, phone)` 统一入口 | 同上 | ✅ |
| 确认订单页提交前检查手机号 → 跳 `bindPhone` | `purelyClub/.../confirmOrder/hooks/useConfirmOrderPage.ts` | ✅ |
| 绑定成功返回确认订单页并重新核算价格 | `purelyClub/.../bindPhone/hooks/useBindPhoneController.ts` | ✅ |
| 单测 | 两端 | ✅ 后端 11/11，前端 160/160 |

**手机号获取方式**：短信验证码（自有通道尚未接入，本地用 `AUTH_EXPOSE_CODE_IN_RESPONSE=true` 从 Network 读取验证码，见第 5 节）。

**触发时机**：确认订单页提交订单前。扫码 → 静默注册 → 浏览菜单 → 点「去结算」→ 提交时若未绑手机号则跳绑定页 → 绑定完成自动返回并重新核算价格。

**关键设计**：

1. `bindVerifiedPhone` 是「手机号已验证」语义的统一入口，`bindPhone`（短信）与将来 `getPhoneNumber` 共用；两者差异仅在「如何证明手机号归属」。
2. 绑定成功后调用 `clearNeedPhoneBind()` 清除前端标志位，避免确认订单页重复拦截。
3. 确认订单页从绑定页返回时通过 `useDidShow` **重新核算价格**：绑定后账号身份变化可能命中会员价 / 积分抵扣，而 `preview` 携带的 `cartVersion` / `pricingVersion` 陈旧会导致建单失败或金额与展示不符。
4. 由确认订单页进入绑定页时，`handleBack` **只返回不退出登录**（强制登出会丢掉桌台会话，用户需重新扫码才能继续点餐）。

**待真机验证**：需开启 `AUTH_EXPOSE_CODE_IN_RESPONSE=true`，并确认短信降级日志或响应体中的验证码可用于完成绑定。

#### 「无可访问门店」的兜底：一处只改一半导致的卡死（2026-09-19 修复）

前述 `[BUG-8]` 想把「无门店」的判定从**硬编码文案**换成**业务码**，方向没错，
但当时只改了前端 `useBindPhoneController` 一处，后端从不下发该业务码：

| 调用点 | 当时的匹配方式 | 实际能否命中 |
|---|---|---|
| `useHomePageController` / `useWechatLoginController` / `useLoginPageController` | `error.message === '当前账号暂无可访问门店'` | ✅ |
| `useBindPhoneController` | `error.businessCode === 'NO_ACCESSIBLE_STORE'` | ❌ 恒不命中 |

后果是用户**绑定手机号成功后**被留在绑定页：手机号其实已经绑好，但界面只有一句
「当前账号暂无可访问门店」，没有任何出口。比改之前（文案硬编码、能工作）更糟。

现在两端补齐：**后端** `club-current-store-context.service` 抛出带 `code` 的
`NotFoundException`（经全局过滤器透传到响应体 `code` 字段）；**前端**统一判定收敛到
`purelyClub/src/utils/storeErrors.ts` 的 `isNoAccessibleStoreError()`，4 个调用点共用，
且**业务码与文案都认**——新旧后端版本错开部署时也不会失效。

刻意不用 `instanceof ApiError`：多个测试用 `vi.mock` 把 `ApiError` 换成同结构的局部类，
跨模块引用会让 `instanceof` 静默失效（表现为「用例覆盖到了却从未真正走进分支」）。
契约由 `club-current-store-context.service.spec.ts` 与 `storeErrors.test.ts` 双向锁住。

### 批次 3 — getPhoneNumber（🔒 认证阻塞；**后端骨架已就绪，2026-09-19**）

前置条件：**微信主体变更 → 微信认证**。认证通过后：

- `bindPhone` 增加 getPhoneNumber 入口（体验更优、0.03/次，比短信便宜）
- 仅调用 `bindVerifiedPhone`，核心逻辑不动
- ⚠️ **不能复用 `login/wechat { phoneCode }`**：那条路对「已存在用户」走的是
  `existingUser` 分支，`safeUpdateWechatPhone` 只写 `wechat_phone` 不迁移占位档案，
  且 `signToken({ phone: existingUser.phone })` 用的是**更新前**的 phone——
  会同时踩中批次 2 修好的两个坑。必须新增
  `POST /club/auth/bind-phone/by-wechat-code` → `getPhoneNumber` → `bindVerifiedPhone`。

#### ✅ 已就绪（把等审核的时间变成实际产出）

认证虽然没过，但**接口本身不依赖认证才能写**，因此提前做完，认证下来当天即可上线：

| 项 | 位置 |
|---|---|
| `POST /club/auth/bind-phone/by-wechat-code`（JWT 鉴权 + 限流） | `club-auth.controller.ts` |
| `ClubAuthService.bindPhoneByWechatCode`：`getPhoneNumber` → 校验大陆号 → `bindVerifiedPhone` | `club-auth.service.ts` |
| 入参 DTO（`e.detail.code`） | `dto/bind-phone-by-wechat-code.dto.ts` |
| 开关 `auth.wechatPhoneBindEnabled`（env `AUTH_WECHAT_PHONE_BIND_ENABLED`，**默认 false**） | `config/configuration.ts`、`.env.example` |
| 单测 4 例（开关门禁 / 换取后委托 / 不校验短信码 / 拒绝非大陆号） | `club-auth.service.spec.ts` |

**开关默认关闭**：未认证时开启只会让每次调用都被微信侧拒绝，不如显式关闭并返回
501 + 明确文案（引导用户走短信验证码）。**认证通过后只需置 `AUTH_WECHAT_PHONE_BIND_ENABLED=true`，不改任何代码。**

**为什么这里不校验短信验证码**：手机号归属由微信背书——服务端要用 access_token 才能
兑换 code，且接口要求 JWT 鉴权，攻击者即便拿到自己的 code 也只能绑到自己账号上，
无法像短信路径那样「填入他人手机号触发账号合并」。

#### 认证通过后仍待做

1. 置 `AUTH_WECHAT_PHONE_BIND_ENABLED=true`；
2. **前端接线**：bindPhone 页加 `<Button open-type="getPhoneNumber">` + `bindgetphonenumber`
   回调，把 `e.detail.code` 传给新接口。
   > 刻意**不在认证前**写前端：没有认证就无法真机验证这个按钮，写出来就是纯死代码——
   > 批次 7.1 刚清理过一处同类问题，不重复制造。
3. 真机验证：一键绑定 → 档案迁移（与批次 2 同一条 `bindVerifiedPhone` 逻辑，已有回归覆盖）。

### 批次 4 — 无 token 不再等于跳登录页（✅ 已完成，待真机验证）

**目标**：让「无 token」不再等于「跳登录页」。老用户从「最近使用 / 搜索」进入时无感恢复会话，
登录页保留但不再是必经路径。

| 改动 | 文件 |
|---|---|
| 新增 `ensureSession()`：无 token 时**唯一**的自动登录判定入口 | `purelyClub/src/services/silentAuthService.ts` |
| 新增「主动退出登录」标记，`persistAccessToken` 成功时自动解除 | `purelyClub/src/utils/authSession.ts` |
| 路由守卫：无 token 先静默登录，失败才跳登录页 | `purelyClub/src/utils/routeGuard.ts` |
| 启动预热静默登录（避免「先渲染页面、再被跳转」的闪动） | `purelyClub/src/app.tsx` |
| 401 恢复：refreshToken 失效后尝试静默登录，http 层用新 token 重放原请求 | `purelyClub/src/app.tsx` |
| 退出登录置标记 | `purelyClub/src/pages/profile/hooks/useProfileController.ts` |
| 绑手机号页「不绑定 = 退出登录」分支置标记 | `purelyClub/src/pages/loginPkg/bindPhone/hooks/useBindPhoneController.ts` |
| 扫码中转页：主动退出后扫码引导显式登录，不自动登录 | `purelyClub/src/pages/scanEntry/index.tsx` |
| 扫码入店：无 token 时先静默登录，不再要求用户先去登录页 | `purelyClub/src/app.tsx` |

**为什么必须加「主动退出」标记**：没有它，路由守卫会在清掉 token 后**立刻静默登录把用户登回来**，
「退出登录」形同虚设。共用设备的场景下风险尤其明显——别人拿这台手机扫码即可用退出者的账号与余额下单。

**哪些路径尊重该标记**（退出后一律不自动登录）：路由守卫、401 恢复、扫码中转页、扫码入店。
**唯一的解除方式是用户显式登录成功**（拿到新 token 时自动清除）。

**关于登录页的定位（2026-09-19 修正）**：本批次的实质是「让 `ensureSession()` 兜住无 token 时的
自动恢复」，登录页只是从「必经路径」退回「正常流程不可达」。

此前把本批次命名为「登录页降级为兜底」、并把「保留登录页」当成主题，是**本末倒置**：批次目标
写在正文第一句（「让无 token 不再等于跳登录页」），标题却把附带决定当成了主题。后续几轮甚至拿
这个错标题去论证「登录页是必需的」，与「只用静默登录、不用登录页」的诉求相悖。

**按业务方决定（2026-09-19）**：**退出登录只在开发环境显示**（`profile.tsx` 的 `SHOW_LOGOUT`）——
C 端身份由微信静默登录决定，退出后下次进入会被静默登回，对用户既无意义，又必须配套一个
「能回来」的显式登录入口（`markManualLogout` 会让静默登录永久失效）。

因此生产环境的登录页也不再需要，其残留的唯一可达路径应改为「停留在重试态」：

| 路径 | 生产环境 | 开发环境 |
|---|---|---|
| `handleLogout`（「我的」→ 退出登录） | 不可达（按钮不渲染） | 跳登录页 |
| `redirectToLoginIfManuallyLoggedOut` | 不可达（无人置标记） | 跳登录页 |
| `routeGuard.redirectToLoginIfNeeded`（401 与页面守卫） | ✅ 不跳转（清会话后原地失败） | 跳登录页 |
| `useBindPhoneController` 的「返回 / 不绑定」分支 | ✅ 不再退出登录，直接返回上一页 | 同 |
| `app.tsx` 的 `handleScanEntry`（未登录时扫码） | ✅ 空操作，原地失败 | 跳登录页 |
| `scanEntryDeps` 的 `redirectToLoginIfManuallyLoggedOut` | ✅ 空操作（且 `isManualLogout()` 在生产恒为 false） | 跳登录页 |

> `markManualLogout()` 现在**只剩一处**调用——`useProfileController` 的退出登录（已 dev-only）。
> 因此「主动退出」这个状态在生产环境恒不存在。

**实现方式：一个受门禁保护的统一出口**

上表 4 个跳转点全部改为调用 `goToLoginPage()`，而不是各自 `Taro.reLaunch`：

```ts
// routeGuard.ts
export const goToLoginPage = async (): Promise<boolean> => {
  if (!SHOW_LOGIN_PAGE) return false   // 生产：空操作
  await Taro.reLaunch({ url: LOGIN_PAGE_URL })
  return true
}
```

返回值让调用方判断「是否已跳转、要不要终止后续流程」——`redirectToLoginIfManuallyLoggedOut`
正是靠它向扫码编排返回"已跳转"。

> ⚠️ 起初只把门禁加在 `redirectToLoginIfNeeded` 上，就宣称"收束了 2 个调用点"，是**不完整的**：
> `app.tsx` 与 `scanEntryDeps` 各自还有一处裸 `Taro.reLaunch`。现在统一到一个出口，
> 以后新增跳转点也不会再漏掉门禁。

#### 401 / 守卫收尾：生产环境不再跳登录页（2026-09-19）

做法是一个环境开关，而不是删代码——开发态行为不变（便于调试），生产构建自动收敛：

```ts
// routeGuard.ts —— 与 profile.tsx 的 SHOW_LOGOUT 同一门禁
const SHOW_LOGIN_PAGE = process.env.NODE_ENV !== 'production'
```

`redirectToLoginIfNeeded` 在门禁为假时直接返回。**一处门禁同时收束两个调用点**：

| 调用点 | 生产环境行为 |
|---|---|
| `app.tsx` 的 `onUnauthorized`（401 收尾，refresh + 静默登录均失败后） | 只 `clearSession()`，不导航 |
| `routeGuard.ensureAuthenticatedRoute`（**18 个页面**经 `useAuthGuard` 使用） | 只 `clearSession()`，原地停留 |

> 页面通过 `purelyClub/src/hooks/useAuthGuard.ts` 间接接入 `ensureAuthenticatedRoute`，
> 直接 grep `ensureAuthenticatedRoute` 会漏统计；grep `useAuthGuard` 命中的 23 个文件里
> 有 5 个是 `__tests__`，真实页面为 **18** 个。

**为什么选「原地失败」而不是跳登录页**：能走到这一步的原因几乎都是**暂时性**的——
网络断开、微信侧故障、服务端 5xx。**让用户去登录页手输验证码，同样要走网络、一样会失败**，
代价却是把用户从当前页踢走并丢掉上下文。登录页在这个场景是死路。

「原地失败」不等于"什么都不做"，恢复是自动的：

```
401 + refresh 失败 + 静默登录失败
  → clearSession()（丢掉废 token，避免后续请求继续带着它）
  → 不跳转，交给页面自身的请求错误态表达「加载失败」
  → 页面下次显示（下拉刷新 / 切页 / 重进小程序）
  → ensureSession() 重新静默登录 → 网络恢复即无感恢复 ✓
```

生产环境 `isManualLogout()` 恒为 false（退出登录已 dev-only），因此"无 token"必然触发
静默登录，判断收敛为一条路径。

**刻意不做全局 toast**：守卫在 18 个页面的 `useDidShow` 里跑，切 3 个 tab 就弹 3 次；
「加载失败」的表达交给各页面自身的请求错误处理（已存在）。

**测试**：`routeGuard.test.ts` 从 5 例增至 **9 例**——`stubEnv('NODE_ENV','production')` +
重置模块后重新导入（门禁在模块加载时求值），覆盖：守卫不跳转、`redirectToLoginIfNeeded`
不跳转、`goToLoginPage` 生产返回 false / 开发跳转并返回 true。
`bindPhone` 侧同步调整为 3 例（含新增「栈底返回回首页，避免原地卡住」）。

> **踩坑记录**：`scanEntryDeps` 引入 `goToLoginPage` 后，其单测整套加载失败——
> `routeGuard` 会带出 `memberProfileStore`，而该 zustand store **在模块加载时就读 Storage**，
> 测试里精简过的 Taro mock 缺 `getStorageSync`。已补全该 mock。
> （同类问题此前出现过一次：`ProfileHeroSection.test.tsx` 的 utils mock 缺 `maskPhone`。
> 精简 mock 的代价就是**依赖链一变就整套挂掉**——这是这套测试脚手架的结构性问题。）

**测试**：新增 `utils/__tests__/authSession.test.ts`（4 例，含「`clearAccessToken` 不得清除该标记」）、
`silentAuthService` 的 `ensureSession` 4 例、重写 `routeGuard.test.ts`（5 例，显式覆盖两个分支）；
受影响页面测试全绿。

### 批次 5 — 门店选择页扫码支持桌码（✅ 已完成）

**问题**：门店选择页的「扫码进入门店」只调 `joinStoreByScanCode`（门店邀请码专用），
用户扫桌上的**桌码**必然报「扫码结果无效，未识别到门店邀请码」——而顾客手上通常只有桌码
（门店邀请码一般贴在门口 / 海报）。

**触发场景**：新用户从「搜索 / 最近使用」进入（未扫码）→ 登录 → 绑手机号 →
落到门店选择页（空态「暂无绑定门店」）→ 自然地扫桌上那张码 → **失败**。

**修复**：把扫码落地链路抽成共享装配 `pages/scanEntry/scanEntryDeps.ts`，两个入口共用：

| 扫到什么 | 行为 |
|---|---|
| 桌码 | 识别桌台 + 建点餐会话（`ensureStoreMembership` 顺带完成入店）→ 进菜单页 |
| 门店邀请码 / 裸邀请码 | 入店并切换当前门店 → 进首页 |
| 空间码 | 解析空间会话（写 `selfOrderingStore`）→ 进自助下单菜单页（**2026-09-19 接通**：此前编排层直接返回「该入口暂未开放」） |

| 改动 | 文件 |
|---|---|
| 新增共享装配（`createScanEntryDeps` / `navigateAfterScanOutcome` / `redirectToLoginIfManuallyLoggedOut`） | `purelyClub/src/pages/scanEntry/scanEntryDeps.ts` |
| 扫码中转页改用共享装配（删掉页面内的重复实现） | `purelyClub/src/pages/scanEntry/index.tsx` |
| `enterStoreByScanCode` → `handleScannedPayload`（走完整编排，命名与行为一致） | `purelyClub/src/pages/profilePkg/storeSelect/utils.ts` |
| 5 个调用点同步改名 | `useStoreSelectController` / `useLoginPageController` / `useWechatLoginController` / `useBindPhoneController` |
| 非组件环境写桌台会话（`useTableStore` 是 hook，普通函数用不了） | `purelyClub/src/stores/tableStore.ts` 额外导出 vanilla `tableStore` |

**为什么一次改 5 个调用点**：它们全部走同一个函数（待入店消费 3 处 + 扫码按钮 + 邀请码页）。
只修「扫码按钮」会让同一条链路的其余 4 个入口继续失败——这正是本次要消除的分叉。

**测试**：新增 `pages/scanEntry/__tests__/scanEntryDeps.test.ts`（10 例，锁住
「桌码 URL → 提取 token → 建会话」这条接缝，接错会让服务端拿整条 URL 去 sha256 匹配）；
`storeSelect.utils.test.ts` 的扫码用例重写为验证「委托统一编排并按结果跳转」（含桌码回归防护）。

### 批次 6 — 启动分发页（✅ 已完成）

**问题**：没有任何可访问门店的用户（典型：搜索进入的新用户）会经历
「**先看到一次首页 → 首页请求返回 `NO_ACCESSIBLE_STORE` → 被 reLaunch 到门店选择页**」，
平白多一屏"不属于他的页面"。

**根因**：小程序启动固定落到 `pages[0]`，没有"先判断再决定去哪"的机会；
而"有没有门店"只有服务端知道。于是顺序被「信息到达顺序」决定——渲染在前、判断在后。

**修复**：把「会话 + 可访问门店」的判断提到渲染之前，由**启动分发页**决定落地页。

| 改动 | 文件 |
|---|---|
| 新增 `runAppBootstrap`（会话就绪 → 查门店数 → home / storeSelect / failed） | `purelyClub/src/pages/scanEntry/scanEntryFlow.ts` |
| 新增 `createAppBootstrapDeps` / `navigateAfterBootstrap` | `purelyClub/src/pages/scanEntry/scanEntryDeps.ts` |
| 无扫码 payload 时走启动分发；失败给出可重试提示 + 诊断串 | `purelyClub/src/pages/scanEntry/index.tsx` |
| `pages[0]` 由首页改为启动分发页 | `purelyClub/src/app.config.ts` |

**为什么复用扫码中转页而不是新建页面**：它本来就是「先完成前置动作、再决定落到哪」的那个页面，
再建一个会立刻产生第二处"决定去哪"的逻辑。职责扩展为「启动分发 + 扫码落地」。

**额外成本 ≈ 0**：分发页要查的门店列表，**首页首屏本来就要查**
（`getHomePageData` 里的 `getCurrentStore`），这里只是把请求时机提前到渲染之前。

**顺带收益**：同时缓解「首页首屏先渲染默认值（¥0 / 普通会员）再更新」的闪动——进首页时会话已就绪。

| 启动方式 | 行为 |
|---|---|
| 扫码（`q` / `scene` / 页面参数） | 走扫码落地：桌码 → 菜单页；门店邀请码 → 首页 |
| 普通启动（搜索 / 最近使用 / 分享卡片） | 会话就绪 → 查门店 → 有门店进首页，无门店进门店选择页 |
| 主动退出登录后任意启动 | 引导显式登录（不自动登录） |

**测试**：`runAppBootstrap` 6 例（含「无门店直接进门店选择页」的回归防护）、
`createAppBootstrapDeps` / `navigateAfterBootstrap` 4 例。

> 注意：`pages[0]` 不再是首页，但 **tabBar 的 `list[0]` 仍是首页**。两者没有耦合关系——
> 微信只要求 tabBar 页出现在 `pages` 数组中。

### 批次 7 — 登录后落地分发统一（✅ 已完成）

**问题**：三个登录入口各写一份「登录完成 → 去哪一页」的分发逻辑，且已经开始分叉。

| 入口 | 位置 |
|---|---|
| 手机号验证码登录 | `useLoginPageController` |
| 微信一键登录 | `useWechatLoginController.navigateAfterLogin` |
| 绑定手机号 | `useBindPhoneController`（非 confirmOrder 分支） |

三份都是同一套规则：消费待入店 payload → 查可访问门店 → 唯一营业门店则自动切换并进首页 →
否则进门店选择页。差异虽小（是否预热资料、错误如何匹配），但**分叉的代价是不同入口落到不同门店**，
而门店决定菜单、价格与会员权益。

**修复**：抽成 `landAfterAuth()`，三个入口共用；详细规则只在它身上覆盖一次。

| 改动 | 文件 |
|---|---|
| 新增 `landAfterAuth()` + `tryConsumePendingStore()`（原先各有三份） | `purelyClub/src/pages/profilePkg/storeSelect/utils.ts` |
| `STORE_SELECT_PAGE_URLS` 补 `storeSelect` 常量（原先三处硬编码路径） | `purelyClub/src/pages/profilePkg/storeSelect/constants.ts` |
| 三个 controller 改为委托 | `useLoginPageController` / `useWechatLoginController` / `useBindPhoneController` |

**测试**：`storeSelect.utils.test.ts` 新增 7 例覆盖 `landAfterAuth` 的全部规则分支
（消费 pending / 消费失败回退门店分发 / 单门店自动切换 / 多门店 / 全部停业 / 无门店清缓存 /
有当前门店不清缓存）；三个 controller 的用例改为断言「确实委托给了 `landAfterAuth`」，
具体规则不再重复覆盖。相关 7 个测试文件 186 例通过。

**效果**：三个 controller 各减少约 20 行分发代码；`navigateAfterLogin` 从 30 行缩到 7 行。
`tsc` 报错数与改造前**完全一致**（317），未引入新的类型问题。

> 顺带清理：`useWechatLoginController.test.ts` 中 4 个因逻辑迁出而变为未使用的 import。

### 批次 7.1 — 清理「未登录时暂存扫码内容」死代码（✅ 已完成）

批次 6 把 `pages[0]` 改为扫码中转页后，`app.tsx` 的 `handleScanEntry` 只在
**启动页不是 `scanEntry`** 时执行（避免同一扫码内容被消费两次），而所有已实现的扫码入口
都落在 `scanEntry` —— 于是「暂存扫码内容、待登录后消费」这条机制已不再被写入。

**关键判断**：写入方与读取方必须同时删。只删读取方，会留下一份永远无人读取的脏数据。

| 角色 | 位置 | 处理 |
|---|---|---|
| 唯一写入方 | `app.tsx`（`PENDING_SCAN_PAYLOAD_KEY`） | 改为未登录时 `reLaunch` 登录页 |
| 读取方 1 | `storeSelect/utils.ts` → `landAfterAuth` | 删除消费分支与 `tryConsumePendingStore` |
| 读取方 2 | `useStoreSelectController.initializeStoreSelectPage` | 删除消费分支（页内扫码入口不受影响） |
| 工具函数 | `storeSelect/utils.consumePendingStoreId` | 删除 |
| 常量 | `STORE_SELECT_STORAGE_KEYS.pendingStoreId` | 删除 |
| 登出清理 | `useBindPhoneController`（`[BUG-6]` 那行） | 删除该行 `removeStorageSync` |
| 测试 | 5 个测试文件的 mock 装配与用例 | 同步清理 |

> 排查时才发现有**两个**消费方：除登录后落地分发外，门店选择页 `useLoad` 也会消费它。
> 这也说明该机制在一次重构后没有留下任何"单一入口"，仍是散落的隐式约定。

**行为变化**：用户已主动退出登录后、从外部扫门店码（且启动页非 `scanEntry`）时，
原先会把扫码内容暂存并静默返回，现在改为直接 `reLaunch` 到登录页 —— 把用户送到能
解决问题的地方，而不是存下一份没有任何消费方的内容。扫码成功的各入口均不受影响。

**验证**：

| 检查 | 结果 |
|---|---|
| 受影响测试文件 | 8 个 / **199 例通过** |
| 全量测试 | 2094 例中 19 例失败 —— `git status` 确认这 4 个文件（`utils/payment`、`components/PickupNotification`、`pages/profile/useProfileHeroLayout`、`StoreSelectPage`）**均不在本次改动范围**，为既有问题 |
| `tsc` | **317 → 302**，清理掉 15 个既有类型错误，无新增 |
| 残留引用 | 全 `src/` 扫描 `consumePendingStoreId` / `pending_store_id` / `PENDING_SCAN_PAYLOAD_KEY` 等，**0 条** |

### 批次 8 — 换绑手机号（✅ 已完成）

**要解决的问题**：`bindVerifiedPhone` 有一道防御性检查——当前账号已绑手机号时直接拒绝
（`'当前账号已绑定手机号，无需重复绑定'`）。于是「一次绑定 = 终身锁死」：

| 后果 | 说明 |
|---|---|
| `users.wechat_phone` + 各门店 `MarketingCustomer.phone` + `Member.phone` 全是旧号 | 商家端联系不上用户；历史订单也一起显示旧号 |
| 用户没有任何自助途径更新 | 再走一次绑定会被上面那道检查拒绝 |

#### 先澄清概念：身份是 openid，不是手机号

这决定了实现的形态。

| 真实场景 | 是否「变成新账号」 | 实际结果 |
|---|---|---|
| 同微信号，换了手机号 | ❌ 不会 | openid 未变 → 仍是同一条 `users` 记录，只是 `wechat_phone` 停在旧号 |
| 换了微信号，用同一手机号 | 进来时是新的，但**绑同一手机号会自动合并回原账号** | `bindVerifiedPhone` 的合并分支（前提：目标账号未绑 openid） |

所以换绑不是「防止变成新账号」，而是**「换号后能把新号写进系统」**。

#### 三处必须同步，漏一处立刻出问题

| 字段 | 漏同步的后果 |
|---|---|
| `users.wechat_phone` | `needPhoneBind` 判定与后续登录的 phone 来源不更新 |
| `Member.phone` | `findAccessibleStores` 正是按它匹配门店 → 用户**立刻失去全部门店访问权**（会员页 404、余额支付失败） |
| `MarketingCustomer.phone` | 商家端仍展示、检索旧号 |

此外 JWT 的 `phone` 参与 `Member` 匹配（`resolveMemberPhone(user) → user.phone`），
因此成功后**必须重新签发 token**，否则旧 token 仍带旧号，上面那条「失去门店」照样发生。

#### 与「首次绑定」的三条边界

| | 首次绑定 | 换绑 |
|---|---|---|
| 旧值为空 | ✓ 允许 | ✗ 拒绝（提示走绑定接口） |
| 新号已被他人绑定 | **合并账号**（把 openid 并过去） | **直接拒绝，绝不合并**——合并语义属于「找回账号」，在换绑里合并会吃掉另一个账号的档案与资产 |
| 定位档案 | 可按 `phone`（占位值 `club_wechat:{openid}` 天然唯一） | **只能按 `clubUserId`**（旧号是真实号码，可能同时属于其他用户） |
| 校验 | 新号验证码 | 新号验证码（旧号可能已作废，无法校验） |
| 频率 | 无 | 30 天冷静期 |

#### 数据层的关键事实：换绑很轻，不会分裂档案

| 约束 | 含义 |
|---|---|
| `MarketingCustomer.@@unique([storeId, clubUserId])` | 每门店每用户只有一条档案 |
| `Member.customerId @unique` | Member ↔ Customer 一对一 |
| `phone` **无唯一约束**（仅普通索引） | 换号不会撞唯一键 |
| 余额 / 积分 / 消费记录挂在 `customerId` / `memberId` 上 | 恒不挂在 phone 上 → 换号后全部跟着走 |

**结论**：换绑只需改 `phone` 字段，不需要任何合并或迁移动作。
历史消费（`marketing_consumptions`）与订单（`scan_orders`）**都没有手机号字段**，
渲染时读的是顾客档案的当前值 —— 所以换绑后 purelyProfit 里该顾客的**全部行（含历史消费）
会一起显示新号**。即：手机号在这个系统里表示「当前联系方式」，不是「下单时的联系方式」。

> 全库只有 3 处存了手机号快照，且都与 C 端用户无关：
> `sale_orders.customer_phone`（仅商家手工补录单，见
> `scan-ordering-sale-order-bridge.service.ts` 的 `order.manualEntry` 分支）、
> `space_reservations/sessions.guest_phone`、`voucher_orders.guest_phone`（后两者为访客自填）。

#### 必须防住的串号风险

`findAccessibleStores` 的 `members.some({ phone })` **没有过滤 `Member.deletedAt`**。
所以只要残留一条旧号的 Member（哪怕是软删除的），之后**另一个人绑定了这个旧号**，
他就能看到前一个用户的门店与会员数据。

因此换绑必须：覆盖该用户**所有**门店档案（含软删除）、按 `clubUserId → customerId` 定位、
**绝不按 phone 更新**。这条已写成回归用例。

#### 改动清单

| 层 | 改动 | 文件 |
|---|---|---|
| 数据 | `users.phone_rebind_at`（换绑时间，用于冷静期） | `prisma/purely-profit/stores/store-accounts.prisma` + 迁移 `20260918100000_add_user_phone_rebind_at` |
| 服务 | `rebindPhone` + `syncPhoneAcrossProfiles` + `assertRebindAllowed` | `src/purely-club/auth/club-auth.service.ts` |
| 接口 | `POST /club/auth/rebind-phone`（JWT 鉴权；发码复用 `bind-phone/send-code`，服务端「无论手机号是否已注册都发送」） | `club-auth.controller.ts` + `dto/rebind-phone.dto.ts` |
| 接线 | `ClubAuthModule` 导入 `ClubStoresModule`（换绑后清可访问门店缓存） | `club-auth.module.ts`、`club-store-access.service.ts`（`invalidateAccessibleStoresCache` 转 public） |
| 前端 | `rebindPhone` API + 个人中心入口 + 换绑页 | `services/authService.ts`、`pages/profile/*`、`pages/profilePkg/rebindPhone/*` |
| 复用 | `maskPhone` 从 `ProfileHeroSection` 提到 utils（个人中心与换绑页共用） | `utils/utils.ts` |

#### 验证

| 检查 | 结果 |
|---|---|
| 后端单测 | `purely-club` + `purely-profit/auth` **510 例通过**（新增 11 例：不合并、不按 phone 更新、Member 经 customerId 同步、冷静期、清缓存、token 携带新号） |
| 后端 e2e | `club-bind-phone-migration` + `club-wechat-register` **8 例通过**；后者导入**真实 AppModule**，即顺带验证了依赖图可启动 |
| 后端 `tsc` | **0 错误** |
| 前端单测 | 换绑控制器 7 例 + `ProfileSettingsPanel` 16 例通过 |
| 前端 `tsc` | 302 → **302**（无新增） |

#### 首次验证发现的事故与修复（2026-09-19）

换绑后在真机验证中暴露两个问题。

**① 换绑后以前加入过的门店消失（功能级回归）**

根因：`syncPhoneAcrossProfiles` 按 `Member.customerId` 定位要更新的 Member：

```ts
tx.member.updateMany({ where: { customerId: { in: customerIds } }, ... })
```

但 **`members.customer_id` 在库中全为 `null`**（该列是「可选、兼容历史数据」，从未被填充）。
于是这条更新命中 **0 条**，`Member.phone` 留在旧号：

```
users.id=215      wechat_phone = 15919654010   ← 换绑成功
members.id=15     customer_id = NULL
                  phone       = 15919654011   ← 没改到
```

而新 token 的 `phone` 已是新号，`findAccessibleStores` 按 `members.some({ phone })`
匹配 → 查不到 → **0 个门店**。

**这正是本文档上一节自己写下的风险（「漏同步 `Member.phone` → 立刻失去全部门店」），
却没有防住**——因为单测断言的是我**假设的正确 WHERE 子句**（`customerId`），
而不是数据库里的真实形态。**断言自己假设的测试，不如没有测试。**

**修复**：改按「该用户有档案的门店 + 旧号」定位。

```ts
where: { storeId: { in: storeIds }, phone: previousPhone }
```

- 为什么能定位到：`Member` 既无 `clubUserId`，`customerId` 又全为 null，只能这样找；
- 为什么不串号：`storeIds` 来自该用户自己的 `MarketingCustomer`，范围限定后
  旧号不可能命中其他用户的档案。

**② 商家端展示名没变（「纯利会员4011」应为「纯利会员4010」）**

换绑只同步了 `phone`，漏了自动生成的展示名。修复：与首次绑定一致同步 `name`，
且仅当名字恰为「由旧号派生的自动名」时才改，不覆盖商家手动改过的名字。

**测试补强**：新增真实数据库 e2e `test/club-rebind-phone.e2e-spec.ts`（4 例），
**刻意把 `Member.customer_id` 造成 null** 以复现线上形态：

| 用例 | 覆盖 |
|---|---|
| `Member.phone` 必须同步 | 本次事故的直接回归；末尾按新号查门店，等价于 `findAccessibleStores` 的真实形态 |
| 多门店全部同步 | 用户在所有门店的档案都要改 |
| 同门店其他用户不受影响 | 不跨用户串改 |
| 换绑后清缓存 | 契约 |

> 该用例对修复前的实现**会失败**（Member 的 `customerId` 为 null → 更新 0 条），
> 这正是它能防住这次事故的原因。

**数据修复**：`members.id=15` 的 `phone` / `name`、`marketing_customers.id=45` 的 `name`
已就地修正，并清掉 `club:accessible-stores` 缓存。

#### ✅ 已处理：测试账号的 openid 归属异常（与换绑无关）

> **2026-09-19 更新**：下面这段曾标记为「待处理」，实际修复**已执行**，现况已复核对得上，
> 保留原文仅作背景。若要还原现场请读本段，不要按其结论重新操作一遍。

#### ~~⚠️ 待处理~~（原记录）：测试账号的 openid 归属异常（与换绑无关）

排查时发现：

| 账号 | email 前缀 | openid | 说明 |
|---|---|---|---|
| `users.id=66` | `club_phone_` | **持有** `o6Al43fTTP77c_…` | 2026-08-03 手机号注册的老账号（f0rest） |
| `users.id=215` | `club_wechat_` | **null** | 2026-09-17 扫码静默注册的账号；换绑操作的就是它 |

后果：**扫码静默登录会落到 66，永远回不到 215**。之前能操作 215，是因为小程序
Storage 里存着 215 的旧 token。

openid 被移动到 66 是历史上的账号合并所致（换绑不触碰 openid，本次改动无关）。
若要继续用 215 的测试数据（余额 ¥6450.7 / `members.id=15` / `marketing_customers.id=45`），
需把 openid 移回 215。

---

## 5. 本地开发：查看短信验证码

短信通道尚未接入（腾讯云短信凭证未配置）。当前有两条降级路径，**无需任何改码**：

### 方式 A：接口响应直接返回验证码（推荐）

```bash
AUTH_EXPOSE_CODE_IN_RESPONSE=true
```

配置项：`auth.exposeCodeInResponse`（`src/config/configuration.ts:330-336`）

生效范围：`sendRegisterCode` / `sendLoginCode` / `sendClubLoginOrRegisterCode` / **`sendBindPhoneCode`** / `sendPasswordResetCode`（`src/purely-profit/auth/auth-code.service.ts`）

开启后响应体带 `code` 字段，在 Network 面板即可直接看到。

> ⚠️ 生产 / staging / QA 禁止开启。

### 方式 B：服务端日志

不配置 `TENCENT_SMS_SECRET_ID` / `TENCENT_SMS_SECRET_KEY` 时，`AuthSmsService` 自动降级为日志模式：

```
[降级模式] 发送登录验证码到 13800138000，验证码 123456，有效期 10 分钟
```

（`src/purely-profit/auth/auth-sms.service.ts:85-98`）

---

## 6. 已知问题与待办

### ✅ P0（已修复）：`bindPhone` 手机号绑定会导致会员数据断裂

> 修复见批次 2：新增 `migrateWechatPlaceholderPhone`，在 `bindVerifiedPhone` 的
> 分支 B 事务内把 `phone = club_wechat:{openid}` 的 `Member` / `MarketingCustomer`
> 迁移为真实手机号（并为未绑定门店补上 `clubUserId`）。以下为问题原貌与风险记录。


`bindPhone` 有两条分支（`src/purely-club/auth/club-auth.service.ts:116-205`）：

| 分支 | 条件 | 是否迁移 `Member` / `MarketingCustomer` |
|---|---|---|
| A | 该手机号**已有**账号 | ✅ 迁移（`mergeWechatUserToPhoneUser`） |
| B | 该手机号**没有**账号 | ❌ **只写 `wechatPhone`，未迁移** |

而本方案的新用户 100% 走**分支 B**。后果：

- JWT 的 `phone` 由 `wechatPhone ?? buildClubWechatMemberPhone(openid)` 决定（`auth-account-lookup.service.ts:146-154`），绑手机号后变为真实手机号
- 但库里 `members.phone` / `marketing_customers.phone` 仍是 `club_wechat:{openid}`
- 下一次 `getAccessibleStores` 按真实手机号查 `Member` → **查不到**
- 用户丢失全部门店；**purelyProfit 商家端也拿不到该 C 端用户的手机号**（正是本次改造的核心目的）

**修复方案**：在分支付 B 的事务内补迁移，把该用户 `phone = club_wechat:{openid}` 的记录更新为真实手机号，并处理目标门店已存在同手机号记录时的唯一约束冲突（参照 `mergeWechatUserToPhoneUser` 的处理方式）。

> 注意：**纯手填不验证手机号是绝对不行的**。`bindPhone` 第 3 步会按手机号查找已有账号并触发合并，若不校验验证码，攻击者填入他人手机号即可把自己的 openid 绑到受害者账号上（`club-auth.service.ts:161-187`）。验证码是这条防线的全部。

### ✅ P0（2026-09-19 已修复）：账号合并会漏迁「已迁到真实手机号」的会员档案

> **修复结论**：定位改为以 `MarketingCustomer.clubUserId` 为权威桥梁，不再假设
> `Member.phone` 仍是占位值；`MarketingCustomer` 资产（储值 / 积分 / 消费次数）也一并迁移。
> 实现见 `ClubAuthService.resolveSourceMembership` + `mergeWechatUserToPhoneUser`。
>
> **验证**：`club-auth.service.spec.ts` 新增 3 例、`test/club-merge-after-bind.e2e-spec.ts`
> 新增 3 例真实库用例（覆盖「先绑号 → 再合并」）。
> 已实测过这些用例**在旧实现下会失败**（把范围查询去掉后立刻红），不是永远绿的空测试。
>
> 以下为原始问题记录，保留作背景。

`mergeWechatUserToPhoneUser` 只查找 `phone = club_wechat:{openid}` 形式的源 Member：

```ts
const sourceMembers = await tx.member.findMany({
  where: { phone: sourceWechatPhone },
  select: { id: true, storeId: true },
});
```

**若源用户的 Member 已经迁到真实手机号（先绑号、后合并），这些档案会被整体漏掉**：
合并完成后 openid 归到目标账号，但源账号的 `Member` / `MarketingCustomer`
（含储值余额、积分、纯豆、消费记录）留在源账号上，用户在新账号里看不到自己的资产。

实测印证：测试库中 `users.id=215` 的 openid 被合并到 `users.id=66` 时，
因 `members.id=15` 当时已是真实手机号（非占位值），**一条档案都没被搬走**——
这次恰好"漏掉反而保住了数据"，但换个先后顺序（先合并、后绑号）就是资产丢失。

**修复思路**（与批次 8 同类）：不要依赖"`phone` 还是占位值"这个假设，
改为按 `clubUserId` 等稳定键定位源用户档案；并补真实数据库 e2e 覆盖
「先绑号 → 再合并」的顺序。

> **与批次 8 的共同教训**：两处 bug 都是**假设某字段处于某种状态，而真实数据不满足该假设**
> （批次 8 假设 `Member.customerId` 有值；本项假设 `Member.phone` 还是占位值）。
> 单测断言了这些假设，于是双双绿灯通过。

### ✅ P1（2026-09-19 已修复）：积分回退匹配不准确

> **修复**：`findCustomerByStoreAndPhone` 增加可选 `clubUserId`，先按精确 phone 查，
> 再按 `clubUserId`（稳定键）定位；**传了 `clubUserId` 就不再走 `phone: null` 兜底**——
> 那条兜底在门店下有多个无手机号顾客时必然命中他人档案，而返回 null（前端展示空列表）
> 远比展示别人的积分 / 储值余额安全。`ClubPointsService` 与 `ClubRecordsService` 均已传入
> `currentContext.user.id`。两处实现（points / records）同步修改，避免再次漂移。
>
> 以下为原始问题描述。

### P1：积分回退匹配不准确

`club-points-query.service.ts:88-99` 对历史 `phone = null` 的 `MarketingCustomer` 有回退匹配，同门店多个无手机号老顾客时可能匹配错。新注册用户走 `club_wechat:{openid}` 精确匹配，不受影响；存量数据迁移时需注意。

### P1：`scene` 参数长度限制

微信小程序码 `scene` 上限 32 字节，桌码 token 为 43 字符（`randomBytes(32).toString('base64url')`），**塞不进 scene**。走普通链接二维码的 `q` 参数则无此限制。若将来要走小程序码，需引入短码映射表。

### P2：旧 `storeId=123` scene 格式不再兼容

该格式在旧链路本就无法被后端解析（`^[A-Z0-9]{6,32}$` 匹配不上含 `=` 的串），属于本来就失效的路径，不构成回归。

### P2：建议绑定微信开放平台

`users.wechat_unionid` 字段已建好且有唯一索引。小程序绑定微信开放平台后 `code2session` 才会返回 unionid，可显著提升账号质量（跨小程序/公众号识别同一用户），免费。

---

## 7. 二维码 URL 规划（✅ 已实现）

| 场景 | 路径 | 域名配置项 | 解析方 |
|---|---|---|---|
| 门店邀请码 | `{CLUB_PUBLIC_BASE_URL}/i/v1/{inviteCode}` | `CLUB_PUBLIC_BASE_URL` | 后端（`store-invite-code-qr.utils.ts`） |
| 扫码点餐桌码 | `{SCAN_QR_BASE_URL}/t/{qrToken}` | `SCAN_QR_BASE_URL` | 前端提取 token → 后端 |
| 空间码（呼叫服务 / 自助下单） | `{SCAN_QR_BASE_URL}/p/{spaceToken}` | `SCAN_QR_BASE_URL` | 前端提取 token → 后端 |

拼接逻辑：`src/purely-profit/operations/scan-qr-payload.utils.ts`；
域名可达性校验抽到共享层 `src/shared/qr-public-url.utils.ts`（与邀请码共用同一套 IP 段规则，避免策略漂移）。

路径段常量前后端各持一份，必须保持一致：后端 `SCAN_QR_TABLE_PATH` / `SCAN_QR_SPACE_PATH`
↔ 前端 `purelyClub/src/utils/scanPayload.ts` 的 `SCAN_PATH_KINDS`（已有单测锁住）。

### 为什么桌码域名与邀请码域名分开

「扫普通链接二维码打开小程序」是**按域名 + 路径前缀**下发规则的。若两者共用域名，
规则一旦配成整个域名前缀，会把 `{base}/i/...` 也一并唤起小程序，破坏邀请二维码到 H5 的落地。
分开配置后，只需 1 条规则：

**公众平台配置**：`{SCAN_QR_BASE_URL}/` → `pages/scanEntry/index`，由中转页按路径分发。

### 未配置域名时的行为（零回退风险）

| 场景 | 配置了 `SCAN_QR_BASE_URL` | 未配置 |
|---|---|---|
| 桌码 | `{base}/t/{token}` | **裸 token**（= 改造前行为） |
| 空间码 | `{base}/p/{token}` | **`purelyclub://space-scan?token=`**（= 改造前行为） |

生产环境（`NODE_ENV=production`）下 localhost / 内网地址会被 sanitize 拒绝并自动回退。

> **因此本次改造在不配置任何环境变量时，行为与改造前完全一致**——可以先把代码合入，
> 等域名与备案就绪后只改环境变量即可切换，无需再动代码。

---

## 8. 环境依赖清单

| 依赖 | 状态 | 阻塞批次 |
|---|---|---|
| 微信主体变更 | 🔄 审核中 | 批次 3 + 微信原生扫一扫唤起小程序 |
| 微信认证 | ⏳ 待主体变更完成 | 批次 3 |
| ICP 备案域名 | ❓ 待确认 | 普通链接二维码规则配置 |
| `SCAN_QR_BASE_URL` | ❌ 未配置（未配置则回退历史格式） | 仅影响「微信原生扫一扫」，不影响小程序内扫码 |
| 腾讯云短信凭证 | ❌ 未配置 | 批次 2 真机验证（本地可用降级方式） |
| 微信支付商户号 | ❌ 未开放 | 真实支付（当前走 `confirm-paid` 开发态兜底） |

---

## 9. 测试策略

本需求的难点是「真机扫一扫必须有微信后台配置才能带 `q` 参数」，因此按三层组织测试，
**前两层完全不依赖真机与微信后台**。

### 第 1 层：逻辑单元测试（不依赖真机）

| 测试文件 | 覆盖内容 | 用例数 |
|---|---|---|
| `purelyClub/src/utils/__tests__/scanPayload.test.ts` | payload 来源解析、路径分类、桌码 / **空间码** token 提取 | 21 |
| `purelyClub/src/services/__tests__/silentAuthService.test.ts` | 注册/登录编排、token 持久化、needPhoneBind 标志、并发去重 | 11 |
| `purelyClub/src/pages/scanEntry/__tests__/scanEntryFlow.test.ts` | **扫码落地完整编排**：来源优先级、登录前置、桌码/门店/空间码分支、异常兜底 | 16 |
| `purelyClub/src/pages/orderPkg/confirmOrder/hooks/__tests__/useConfirmOrderPage.test.tsx` | 提交前手机号拦截 | 1 |
| `purelyClub/src/pages/loginPkg/bindPhone/hooks/__tests__/useBindPhoneController.test.tsx` | `from=confirmOrder` 分支：绑定后返回原页、不去门店分发；返回不登出 | 4 |
| `purelyprofit-server/src/purely-club/auth/club-auth.service.spec.ts` | **占位手机号迁移**（P0 修复回归） | 1 |

```bash
cd purelyClub && npx vitest run src/pages/scanEntry src/services src/utils
cd purelyprofit-server && npx jest src/purely-club/auth/club-auth.service.spec.ts
```

### 第 2 层：真实数据库 E2E（后端）

单测只能断言「调用了哪些 `updateMany`、条件是什么」，**无法证明数据真的被改写，也不会暴露唯一约束冲突**。
本层用真实 PostgreSQL 落库并断言数据。

```bash
cd purelyprofit-server
npx jest --config ./test/jest-e2e.json club-bind-phone-migration
npx jest --config ./test/jest-e2e.json club-wechat-register
```

**`test/club-wechat-register.e2e-spec.ts`（5 用例）**

这是唯一验证「全新 openid 首次调用真的会建号」的自动化测试——单测里
`AuthProductAuthService` 是被 mock 的，覆盖不到真实注册链路。

装配方式：`imports: [AppModule]`（生产同款依赖图）+ `global.fetch` 拦截微信接口。
之所以不用 `ClubAuthModule`：`AuthModule` 的依赖链很深（AuditLog / Membership / Code …），
逐个补模块会持续漂移。另需注意两点：
1. 必须 `await moduleFixture.init()`——`compile()` 不触发生命周期钩子，`RedisService` 的连接是在 `onModuleInit` 里建的；
2. 必须 override `ScanOrderingGateway`——测试上下文没有 HTTP server，其 bootstrap 钩子会抛「Socket.IO server 尚未初始化」。

| 用例 | 验证点 |
|---|---|
| 全新 openid 首次调用 | 真实落库：`users` 新增记录、`email` 为 `club_wechat_{openid}@purelyprofit.local`、`wechat_phone` 为 NULL、`needPhoneBind=true` |
| JWT 的 phone 声明 | 等于 `club_wechat:{openid}`——`ClubStoreAccessService.resolveMemberPhone` 直接用这个值查 Member，错了用户就查不到门店 |
| 同一 openid 再次登录 | 命中同一 `userId`，库中只有 1 条记录（不重复建号） |
| 传入 `phoneCode` | `wechat_phone` 写入真实手机号、`needPhoneBind=false`、JWT 的 phone 切换为真实手机号（**预演批次 3**） |
| code 无效 | 透传微信错误语义，且不产生脏账号 |

**`test/club-bind-phone-migration.e2e-spec.ts`（3 用例）**

| 用例 | 验证点 |
|---|---|
| 绑定后迁移占位记录 | `members.phone` 与 `marketing_customers.phone` 真的从 `club_wechat:{openid}` 变成真实手机号；`club_user_id` 已回填；新 token 带真实手机号 |
| 同门店已绑定该用户 | 不重复写 `club_user_id`，**不触发 `uq_marketing_customers_store_club_user` 部分唯一索引冲突**（这条只有真实库才跑得出来） |
| 账号已绑定手机号 | 拒绝重复绑定，且占位记录原样保留（防御性检查在事务之前） |

两个用例集都自建临时数据并在 `afterAll` 逆序清理，不污染开发库。

> ⚠️ **真实库用例必须串行执行**（`test/jest-e2e.json` 已设 `maxWorkers: 1`）。
> 2026-09-19 实测：并行跑 4 个真实库套件时，`bindPhone` 的事务会间歇性
> `Transaction timeout`（它们共用同一个开发库、且都落在同一个门店上，互相等锁）。
> 表现为**间歇失败**——单独跑全绿、一起跑偶发红，极易被误判成业务逻辑 bug。
> 新增真实库用例时请保持串行，不要为了提速改回并行。

### 第 3 层：一键造数据 + 开发者工具模拟冷启动

#### 2.1 造测试数据

```bash
cd purelyprofit-server
node scripts/seed-scan-test-qr.mjs            # 自动挑一个餐饮门店
node scripts/seed-scan-test-qr.mjs 18         # 指定门店
node scripts/seed-scan-test-qr.mjs 18 --force-catering   # 门店业态非 catering 时强制改写
```

脚本会确保「餐饮门店 + 区域 + 桌台 + 可用桌码」就绪，并直接打印三种测试方式的参数。

**为什么脚本直接连库而不调接口**：商家端登录需要 RSA 加密密码 + 拼图 `captchaToken`，无法脚本化。因此脚本复刻了 `ScanOrderingQrService` 的落库逻辑（token 生成 + AES-256-GCM 加密 + 密钥回退派生），与线上接口写出的数据完全等价。

> 桌码在库里只存 `tokenHash` + `tokenCiphertext`，**SQL 查不出明文 token**，必须走接口生成或本脚本。

常用环境变量：

| 变量 | 说明 |
|---|---|
| `SEED_STORE_ID` / 第一个参数 | 目标门店 ID |
| `SCAN_QR_BASE_URL` | 扫码内容前缀，默认取 `CLUB_PUBLIC_BASE_URL`；都为空则回退裸 token |
| `SEED_QR_OUTPUT` | 设了就把二维码 PNG 写到该路径，便于手机/小程序内扫码 |
| `SEED_TABLE_CODE` / `SEED_TABLE_NAME` | 桌台编码 / 名称 |

幂等：区域与桌台存在则复用；每次执行会撤销该桌台现有 `active` 桌码并新建一个版本。

#### 2.2 四种注入方式

**方式 A：开发者工具「编译模式」**

| 字段 | 值 |
|---|---|
| 启动页面 | `pages/scanEntry/index` |
| 启动参数 | 脚本输出的 `q=...` 整行 |
| 场景值 | `1047` |

> ⚠️ **实测坑**：微信开发者工具部分版本下，编译模式**只应用「启动页面」**，
> 「启动参数」与「进入场景」不透传——此时中转页诊断串会显示 `scene=1001`、`query={}`
> （`1001` 是「发现栏小程序主入口」，即默认值，说明该模式的两栏未生效）。
> 遇到这种情况不要继续排查业务代码，直接改用**方式 D**。

**方式 B：页面参数**（无需编译模式，控制台直接执行，成功率最高）

```js
wx.navigateTo({ url: '/pages/scanEntry/index?payload=<脚本输出>' })
```

**方式 C：小程序内「扫码点餐」入口**

设 `SEED_QR_OUTPUT=./scan-test-qr.png` 导出二维码后用小程序扫它。

**方式 D：Storage 调试注入**（编译模式启动参数失效时的兜底；批次 1 的验收即走此路）

中转页在**非生产构建**下额外读取 storage key `purelyclub_debug_scan_payload`。
开发者工具 Console 执行一行，再点页面上的「重试」即可，无需重新编译：

```js
wx.setStorageSync('purelyclub_debug_scan_payload','http://localhost:3000/t/<qrToken>')
```

优先级：启动参数 / 页面参数 > 调试注入。
生产构建（`NODE_ENV=production`）不读取该 key，且失败态不提供重试按钮。

**方式 E：查看中转页诊断串**

未识别到扫码内容时，中转页会直接打印原始 `scene` / `query` / `pageParams`。
排查「参数为何没传进来」只看这一处即可，不必加日志或断点。

#### 2.3 先单独校验 token 是否可用

```bash
curl -s -X POST http://localhost:3000/api/club/scan-ordering/scan/resolve \
  -H 'Content-Type: application/json' -d '{"qrToken":"<token>"}' | jq
# 期望：{"store":{"id":37},"table":{...,"canOrder":true},"scanToken":"...","expiresAt":"..."}
```

该接口免鉴权；`resolve` 可重复调用（被消费的是一次性的 `scanToken`，不是桌码本身）。

#### 2.4 清理测试数据

```bash
cd purelyprofit-server
node scripts/cleanup-scan-test-data.mjs                                # dry-run：只统计
node scripts/cleanup-scan-test-data.mjs --yes                          # 执行删除
node scripts/cleanup-scan-test-data.mjs 37 --all-tables --yes          # 该门店全部桌台
node scripts/cleanup-scan-test-data.mjs 37 --all-tables --purge-areas --purge-pickup --yes
```

| 参数 | 说明 |
|---|---|
| `<storeId>` | 目标门店，也可用 `SEED_STORE_ID`；都不传则自动挑一个餐饮门店 |
| `--table-code=A,B` | 要清理的桌台编码，默认取 `SEED_TABLE_CODE` 或 `TEST-01` |
| `--all-tables` | 清理该门店所有桌台（优先于 `--table-code`） |
| `--purge-areas` | 顺带删除清理后已无桌台的区域 |
| `--purge-pickup` | 清除该门店取餐号每日计数（重置叫号从 001 开始） |
| `--yes` | 确认执行；**缺省为 dry-run，不带该参数绝不写库** |
| `--force` | 存在关联财务销售单时仍继续 |

**安全设计**：

1. 默认 dry-run；
2. 默认只清理「测试桌台编码」范围，不做整店清空（`--all-tables` 才放开）；
3. 若发现订单已生成财务销售单（`sale_orders.scan_order_id` 指向它们），默认中止并提示——
   继续删会把销售单的扫码来源置空（Prisma 默认 `SetNull`），金额与流水不受影响但会丢失追溯。

**删除顺序由外键依赖决定，不可调整**：

```
scan_order_{coupon_usages,items,payment_attempts,refund_tasks,balance_transactions,status_histories}
  → scan_orders
  → scan_ordering_cart_item_specs → scan_ordering_cart_items
  → scan_order_service_calls → scan_ordering_sessions
  → scan_ordering_table_qr_codes → scan_ordering_tables
  →（可选）scan_ordering_areas / scan_ordering_pickup_sequences
```

### 第 4 层：小程序自动化（miniprogram-automator）

真正跑小程序运行时，且**不依赖微信后台的二维码规则，也不依赖编译模式**——用页面参数注入。

```bash
cd purelyClub
pnpm dev:weapp                                   # 先产出 dist/
node scripts/e2e-scan-entry.mjs \
  --token=<qrToken> --base-url=http://localhost:3000
# 或直接给完整扫码内容
node scripts/e2e-scan-entry.mjs --payload='http://localhost:3000/t/<qrToken>'
```

脚本做的事：

1. `automator.launch({ cliPath, projectPath })` 拉起开发者工具并建立自动化连接
2. `reLaunch('/pages/scanEntry/index?payload=<编码后的扫码内容>')`
3. 轮询等待 `currentPage().path === 'pages/orderPkg/menu/index'`（中转页是异步的，不能只看首帧）
4. 通过 `callWxMethod('getStorageSync', ...)` 断言：
   - `purelyclub_access_token` 已写入 → **静默注册成功**
   - `purelyclub_need_phone_bind === true` → 确认订单页将引导绑定
5. 失败时可按 `SCREENSHOT_OUT` 输出截图

**前置条件**（缺一不可）：

| 条件 | 说明 |
|---|---|
| 开发者工具「服务端口」已开启 | 设置 → 安全设置 → 服务端口。**这是最常见的失败点** |
| `dist/` 已构建 | `pnpm dev:weapp` |
| 后端在跑且微信凭证匹配 | `WECHAT_APP_ID` 必须等于 `project.config.json` 的 `appid`，否则 `wx.login` 换不出 openid |
| 桌码已就绪 | `purelyprofit-server`: `node scripts/seed-scan-test-qr.mjs` |

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `WX_DEVTOOLS_CLI` | `/Applications/wechatwebdevtools.app/Contents/MacOS/cli` | 开发者工具 CLI 路径 |
| `LAUNCH_TIMEOUT_MS` | `60000` | 连接开发者工具的超时 |
| `TIMEOUT_MS` | `30000` | 等待落地页面的超时 |
| `EXPECT_PAGE` | `pages/orderPkg/menu/index` | 期望落地的页面 |
| `SCREENSHOT_OUT` | 空 | 失败时截图输出路径 |

> 连不上自动化端口时脚本会输出排查清单，而不是只抛一句 `Wait timed out`。

### 第 5 层：真机 + 真实数据验证

真机要点：**「真机调试」的二维码不是「普通链接二维码」**，不带 `q`；能否触发取决于开发者工具是否下发编译模式的启动参数。

- 真机看到**登录页** → 启动页面仍是首页（编译模式未生效）
- 真机看到**中转页「未识别到扫码内容」** → 启动页面生效但启动参数未下发
- 真机**直达菜单页** → 全部正常

启动参数不可用时，走第 2 层的页面参数方式（`payload`），或生成小程序码（`page` 带参）。

**P0 修复的真实数据验证**（绑定手机号后立即查库）：

```sql
-- 占位记录应已消失
SELECT id, store_id, name, phone FROM members WHERE phone LIKE 'club_wechat:%';
-- 应出现以真实手机号为 phone 的会员记录
SELECT id, store_id, name, phone FROM members WHERE phone = '13800138000';
-- 营销顾客：phone 已迁移且 club_user_id 已回填
SELECT id, store_id, club_user_id, phone, points, balance
FROM marketing_customers WHERE phone = '13800138000';
```

注意：门店列表缓存 TTL 为 60 秒（`club:accessible-stores:{userId}`），
验证「绑定后不丢门店」时需等待过期或清 Redis。

---

## 10. 参考

- 后端扫描点餐模块：`src/purely-club/scan-ordering/`
- 扫码内容解析：`purelyClub/src/utils/scanPayload.ts`
- 微信认证关键代码：`src/purely-club/auth/club-auth.service.ts`、`src/purely-profit/auth/auth-wechat-login.service.ts`
- 无手机号用户机制：`CLUB_WECHAT_PHONE_PREFIX`（`club-auth.service.ts:20`）、`buildClubWechatMemberPhone`（`auth.utils.ts:237`）
