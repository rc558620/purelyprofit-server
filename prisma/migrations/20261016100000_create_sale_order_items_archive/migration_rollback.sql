/* 回滚：删除归档表
 * 注意：回滚前需确认归档表中的数据已迁回 sale_order_items 或已备份，
 * 因为 DROP TABLE 会永久删除归档数据。
 */

DROP TABLE IF EXISTS "sale_order_items_archive";
