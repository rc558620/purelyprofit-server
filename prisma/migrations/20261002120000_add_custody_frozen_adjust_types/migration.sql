/*
 * 客存冻结台账补齐：此前只有「取出解冻」会落库 inventory_adjustment_logs，
 * 「存入占用」与「作废解冻」都没有留痕，门店在盘点时对不上「为什么这件商品
 * 突然不能卖 / 又能卖了」。新增两个系统产生的调整类型，补齐冻结侧台账。
 *
 * Postgres 的 ALTER TYPE ... ADD VALUE 不能在同一事务里使用新值，
 * 本迁移只扩展枚举、不写入任何数据行，因此是安全的。
 */
ALTER TYPE "InventoryAdjustType" ADD VALUE 'custody_freeze';
ALTER TYPE "InventoryAdjustType" ADD VALUE 'custody_release';
