/*
 * 新客额度流水新增「平台运营调整」类型。
 *
 * 此前 purelyPulse 代商家发放 / 回收额度时，增加按 `grant` 记、减少按 `clear` 记，
 * 导致商家端 purelyProfit 额度页出现两处口径错误：
 *   1. 概览「累计会员赠送」把运营发放的量也统计进去，与页面宣称的
 *      「月度 50 / 季度 100 / 年度 300」对不上；
 *   2. 流水列表把这些记录显示成「会员赠送 / 清零」，商家无法分辨到底是谁动的额度。
 * 拆出独立的 admin_adjust 类型后，grant 回归「会员赠送」的单一语义。
 *
 * Postgres 的 ALTER TYPE ... ADD VALUE 不能在同一事务里使用新值，
 * 本迁移只扩展枚举、不写入任何数据行，因此是安全的。
 */
ALTER TYPE "StoreNewCustomerQuotaLogType" ADD VALUE 'admin_adjust';
