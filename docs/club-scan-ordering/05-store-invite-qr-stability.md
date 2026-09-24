# 进店二维码（门店邀请码）防改版失效加固

> 背景与协议总览见 `03-scan-first-login-plan.md` 第 7 节。
> 本文只写「进店码」这条线特有的加固，桌码 / 空间码的四条线不在本文范围内。

核心原则与桌码 / 空间码一致：**载荷只放标识，业务语义全在服务端查表；
解析端多形态兼容；配置缺失自动回退历史格式；域名与入口路径一经印刷即视为永久资产。**

载荷格式：`{CLUB_PUBLIC_BASE_URL}/{entrySegment}/v1/{inviteCode}`
（渠道码追加 `?t={issueToken}`），未配置域名时回退裸邀请码 `AB23CD45`。

---

## 1. 入口路径段是 env 可配项 —— 必须收白名单（P0-1）

桌码 / 空间码的路径段（`t` / `p`）是**代码常量**，改了要过 review；
进店码的入口段是 env（`CLUB_STORE_INVITE_QR_ENTRY_PATH`，默认 `/i`），**改起来毫无阻力**：

- 生成侧 `sanitizeEntryPath()` 原样接受任意值 → 产出 `/join/v1/CODE`；
- 解析侧 `V1_PATH_PATTERN` 与前端 `SCAN_PATH_KINDS.storeInvite` 只认 `i` / `invite`；
- 结果：已印刷物料全部失效，**且不报错**，只能等顾客扫不出来才发现。

因此：

1. 具名常量 `STORE_INVITE_QR_ENTRY_SEGMENTS = ['i', 'invite']` +
   `STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT = 'i'`（`src/purely-profit/stores/store-invite-code-qr.utils.ts`）；
   `V1_PATH_PATTERN`、`ENTRY_VERSION_SEGMENT_PATTERN`、`sanitizeEntryPath` 全部由它派生，
   生成侧与解析侧不可能再分叉。
2. `sanitizeEntryPath()` **拒绝白名单外的取值**：回退 `i` 并记 error（按取值去重，不刷日志）。
3. 跨仓契约：后端常量 ↔ 前端 `SCAN_PATH_KINDS.storeInvite` / `STORE_INVITE_SEGMENTS`，
   由 `npm run scan:qr:contract:check` 守住（新增「进店码入口段白名单」「进店码默认入口段」两组）。
4. 新增入口段是**不可逆的物料级变更**：必须后端常量、前端常量、微信公众平台
   「扫普通链接二维码」前缀规则一起改，并跑契约脚本。

## 2. 空载荷拒绝出图（P0-2）

`buildStoreInviteQrPayload()` 在邀请码形态非法时返回 `''`。出图前不拦会怎样：

- `qrcode.toDataURL('')` 抛 `No input text` → 接口 500，商家端只看到「服务器错误」，
  不知道要重新轮换；
- 调用方用 `payload !== inviteCode` 判断协议版本，空载荷会**先被误判成 v1**。

三处出图点统一走 `assertUsableStoreInviteQrPayload()`，空载荷抛
`InternalServerErrorException('进店码内容生成失败，请重新轮换邀请码')`：

| 出图点 | 文件 |
|---|---|
| 邀请码查询 / 轮换 | `marketing-invite-code.service.ts` |
| 营销概览 | `marketing-overview.service.ts` |
| 渠道码创建 / 列表 | `marketing-invite-qr-issue.service.ts` |

## 3. 启动期域名告警（P0-3）

`CLUB_PUBLIC_BASE_URL` 此前**完全没有启动期告警**：只有渠道码创建时会运行期拒绝，
通用进店码静默回退裸码，运维无从察觉。现在由
`reportStoreInviteQrBaseUrlStatus()`（`src/shared/store-invite-qr-base-url-status.utils.ts`，
`MarketingInviteCodeService.onModuleInit` 调用）播报三种状态：

| 状态 | 级别 | 说明 |
|---|---|---|
| 未配置 | warn | 进店码回退裸码，微信原生扫一扫无法唤起小程序 |
| 配了但被 `sanitizePublicBaseUrl` 拒绝 | **error** | 静默回退最危险，运维会以为已生效 |
| 生效 | log | 同时提示「一经印刷即永久资产」 |

实现方式照搬桌码 / 空间码的 `reportScanQrBaseUrlStatus`：**按域名取值去重**，
后续 `MarketingOverviewService` / `MarketingInviteQrIssueService` 再接入也不会刷两遍日志。
两套域名（`CLUB_PUBLIC_BASE_URL` 与 `SCAN_QR_BASE_URL`）是独立配置，因此分开播报。

## 4. 商家端第三方兜底（P1-4）

`MarketingHeroCard.buildFallbackQrImageUrl()` 用第三方 `api.qrserver.com` 在线出图。
评估结论：**保留，但只作最后兜底，长期应删除、统一由后端出图。**

- 后端只要返回了 `inviteCodeQrCodeImageUrl`（data URL）就永远走后端 —— 正常情况下
  该兜底**不可达**（后端现在必然返回图，否则抛错）；
- 触发条件收窄为「后端没给图 + 载荷是 legacy 裸码」；
- 消费方必须给出失败提示：`MarketingEntryQrPosterModal` 对二维码 `<img>` 加了
  `onError` → 显示「二维码图片加载失败，请刷新页面重试（不要打印空白图）」，
  不再静默显示空白。

## 5. 轮换 / 停用的失效语义（P1-5）

后端 `rotateInviteCode()`（旧码立即失效）、`deactivateInviteCode()`（全部失效）
都是**不可逆的物料作废**，没有历史版本表可回滚。

约定（商家端两个 `ConfirmModal` 已按此写清文案）：

1. **轮换 / 停用前必须确认新物料已到位**，先下载替换，再执行；
2. 文案必须明确写出「已印刷物料立即失效」（模板沿用空间码：
   「轮换后，{空间} 内已张贴的旧二维码会立即失效。请下载并替换新二维码。」）；
3. **优先用渠道码的单张撤销，而不是整体轮换**：
   `StoreInviteQrIssue` 支持按张 `revoke`（`status='revoked'` + `revokedAt`），
   作废某一张物料时只影响那一张，整体轮换会连坐所有渠道码 —— 这是现有优势，
   改造中不要破坏；
4. 不要为了「刷新一下」而轮换。

## 6. 明文存库：不做 hash 迁移（P2-6，结论）

`StoreInviteCode.code` 仍是明文 unique。**明确不做**空间码那套 hash 查表，理由：

- **低熵**：邀请码是 8 位大写字母数字（36^8），存 hash 也能被离线暴力枚举，
  安全收益远低于空间码的高熵 UUID；
- **语义不同**：邀请码在设计上就是要可复制、可口头传播、可印在海报上的
  **公开标识**，不是「凭证」；hash 化会破坏「商家口头报码 / 客服抄码」的场景；
- **正确的防枚举方向是使用次数 / 有效期 / 风控限流**（`usedCount` 字段已在），
  不是 hash。

> 若将来出于口径统一仍要做，最小成本是照抄空间码的双读迁移模板
> （`20260927093000_add_space_qr_token_hash` + `20260928093000_drop_space_qr_token_plaintext`
> + `src/shared/space-qr-token-codec.utils.ts`），但**必须在文档里写明这不构成实际安全提升**，
> 避免产生虚假安全感。默认不做。

## 7. 验收

```bash
cd purelyprofit-server
npx tsc --noEmit -p tsconfig.json
npx jest src/purely-profit/marketing src/purely-profit/stores src/purely-club/stores
npm run scan:qr:contract:check          # 含进店码入口段两组；漂移时 exit 1
node scripts/check-f0rest-rules.mjs <改动文件>

cd ../purelyClub
npx vitest run src/utils/__tests__/scanPayload.test.ts

cd ../purelyProfit
npx vitest run src/pages/main/marketing
```

契约脚本的失败验证（不要改真实前端文件，用临时副本）：

```bash
TMP=$(mktemp -d) && mkdir -p "$TMP/src/utils"
cp ../purelyClub/src/utils/scanPayload.ts "$TMP/src/utils/"
sed -i '' "s/storeInvite: 'i'/storeInvite: 'x'/" "$TMP/src/utils/scanPayload.ts"
PURELY_CLUB_ROOT="$TMP" npm run scan:qr:contract:check   # 期望 exit 1
```
