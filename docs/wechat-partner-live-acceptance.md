# 服务商模式上线验收手册（1 分钱真实联调）

> 配套：`docs/wechat-pay-setup.md`（配置口径）、`scripts/verify-wechat-partner-live.mjs`（自动自检）。
> 本文是**执行步骤**：每一步都有命令、预期结果与失败时的处理方向。
> 未打勾的项目未完成前，不要对全量商家开放。

---

## 阶段 A：静态自检（不需要真实交易）

```bash
pnpm wechat:partner:live-check                      # 环境 + 数据库
pnpm wechat:partner:live-check --store-id=123       # 只看某个门店
```

- [ ] `① 环境变量自检` 全部为 ✅（开关未开时脚本只告警不失败）
- [ ] `② 数据库自检` 五张表的列全部到位（迁移已应用）
- [ ] 目标门店已填 `sub_mch_id`，且没有「未填子商户号」告警

判定：开关**已开启**时脚本会检查豁免与原因留档，缺任一项以 exit 1 结束。

---

## 阶段 B：绑定校验（第一次真实调用微信）

**方式一（推荐，走后端接口）**：商家端页面点「重新校验」。
**方式二（命令行）**：

```bash
pnpm wechat:partner:live-check \
  --api-base=https://api.你的域名.com \
  --token=商家端JWT
```

- [ ] 返回 `bindStatus=verified`、`configured=true`
- [ ] 若返回 `failed`：按 `bindFailReason` 处理——
  - `NO_AUTH` → 该商户号未在本服务商后台完成特约商户绑定授权（商家侧动作）
  - `MCH_NOT_EXISTS` → 子商户号填错
  - 其它/空错误码 → 结果为 `pending`，**不算通过**，稍后重试；连续 pending 需查 `wechat.partner.apiV3Key` 与私钥是否匹配
- [ ] 接口限频 10 次 / 5 分钟，反复点击会收到 429，等待即可（前端不做自动重试）

---

## 阶段 C：1 分钱真实下单 + 回调（**必须人工**）

1. purelyClub 小程序对目标门店发起 **1 分钱**充值或下单；
2. 真实完成支付；
3. 立即核对：

```sql
-- 充值单：确认商户号已落库且与回调一致
SELECT order_no, status, sp_mch_id, sub_mch_id, transaction_id, amount_fen, paid_at
FROM club_recharge_orders
ORDER BY created_at DESC LIMIT 5;

-- 门店配置：确认绑定状态
SELECT store_id, mch_id, sub_mch_id, bind_status, bind_checked_at, bind_fail_reason
FROM store_wechat_pay_configs;

-- 死信：正常应为空；有记录说明回调处理失败
SELECT order_no, stage, reason, status FROM club_payment_callback_failures;
```

- [ ] 订单 `status=paid`
- [ ] `sp_mch_id` = 配置的服务商商户号
- [ ] `sub_mch_id` = 该门店配置的子商户号
- [ ] `transaction_id` 非空（微信流水号，对账主键）
- [ ] 应用日志中**没有**「资金归属异常」「所有已配置 APIv3Key 均无法解密」字样
- [ ] `club_payment_callback_failures` 无新增

**失败对照**：

| 现象 | 方向 |
|------|------|
| 小程序拉不起支付 / 报签名错误 | paySign 用的 appId 与下单 appid 不一致 → 检查 `WECHAT_PARTNER_SP_APP_ID` |
| 下单返回 `NO_AUTH` | 子商户未绑定授权 → 回阶段 B |
| 下单返回 `APPID_MCHID_NOT_MATCH` | AppID 未绑定到该服务商商户号 |
| 支付成功但订单未入账 | 看解密/验签日志；最常见是漏配 `WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT` 或 `WECHAT_PARTNER_API_V3_KEY` |
| 日志「资金归属异常」并拒绝入账 | 回调里的 `sp_mchid`/`sub_mch_id` 与配置不一致，核对是否换绑过子商户 |

---

## 阶段 D：查单 / 关单 / 退款（**必须人工**）

- [ ] **查单**：小程序端触发「结果未知」核对（或管理端补单入口），确认能取到微信真实状态
- [ ] **关单**：造一个超时未付订单，确认关单后微信侧不可再付、本地翻转 `expired`
- [ ] **退款 1 分钱**：对阶段 C 的订单发起退款
  - [ ] 退款成功，本地与微信侧状态一致
  - [ ] 日志中 `settleMchId` 与订单记录一致（走的是订单原收款主体）
  - [ ] 若日志出现「订单未记录原收款子商户号，回落到门店当前配置」→ 说明该订单类型未接入落库，需人工核对（见已知限制）

---

## 阶段 E：回归旧链路（开关关闭态）

- [ ] `WECHAT_PARTNER_ENABLED=false` 重启，短信钱包充值（b）做一次 1 分钱下单 + 回调 + 退款
- [ ] 同上，平台会员 / 新客额度（c）做一次
- [ ] 确认这两条链路与改造前行为一致（这是「可回滚」的实证）

---

## 阶段 F：灰度与放量

- [ ] 先开单个试点门店，观察一个完整对账周期
- [ ] 再按门店逐步放量（当前开关粒度是**环境级**；门店白名单未实现，见遗留项）
- [ ] 监控：`club_payment_callback_failures`、回调解密失败日志、退款失败率

---

## 回滚（任何阶段出问题都可执行）

1. `WECHAT_PARTNER_ENABLED=false` 并重启 → 立即回到旧直连逻辑；
2. 需要撤表时再执行 `prisma/rollback/20261029120000_add_wechat_partner_payment_fields.rollback.sql`；
3. 数据回填可重跑：`pnpm wechat:partner:sub-mchid:backfill`（dry-run 默认，`--apply` 写库，幂等）。

---

## 已知限制（验收时要心里有数）

1. **SF 自助下单**：已接入归属校验与落库（门店 ID 经 `SelfOrder` 关联取得），与其他订单类型同口径。
2. **SV 服务购买单**：**能做归属校验，但商户号无法落库** —— 它只有 Redis 草稿、没有订单表。
   校验通过即入账（不因存不下商户号而拒收），日志会明确告警「无法落库」；
   将来若发生 SV 退款会回落到门店当前配置，**需人工核对**。草稿已过期/不存在时跳过比对并放行。
2. **退款查单接口未实现**：本轮验收用微信商户平台人工核对退款状态。
3. **跨商家越权未做真实 e2e**：边界由「门店取自 JWT、接口不收 storeId」保证。
4. **`pnpm build` 在本机被 dist 删除保护拦截**：交付前需在允许清理 dist 的环境补跑一次完整构建。
