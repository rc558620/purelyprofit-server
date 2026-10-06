/*
 * 把历史「平台运营调整」流水从 grant / clear 纠正为 admin_adjust。
 *
 * 为什么必须单独一条迁移：
 * Postgres 的 ALTER TYPE ... ADD VALUE 新值不能在**同一事务**里使用，
 * 因此上一条迁移（20261006000000）只扩枚举，回填只能放在它提交之后执行。
 *
 * 识别依据是 description 前缀。该文案唯一由
 * `PurelyPulse membership-admin-new-customer-quota.service.ts` 生成
 * （`平台运营调整新客额度` 或 `平台运营调整新客额度：{reason}`），
 * 不存在其它写入方，故不会误伤商家自付充值或会员赠送。
 *
 * 效果：商家端「累计会员赠送」回归「月50 / 季100 / 年300」的真实口径，
 * 流水列表也不再把平台调整显示成「会员赠送 / 清零」。
 */
UPDATE store_new_customer_quota_logs
   SET type = 'admin_adjust'
 WHERE type IN ('grant', 'clear')
   AND description LIKE '平台运营调整新客额度%';
