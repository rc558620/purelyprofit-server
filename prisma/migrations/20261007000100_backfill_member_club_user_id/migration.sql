/*
 * 回填 members.club_user_id。
 *
 * 为什么单独一条迁移：DDL 与数据修正是两类操作，分开后任一步失败都便于定位；
 * 与 20261006000100_backfill_new_customer_quota_admin_adjust 的组织方式一致。
 *
 * 只回填**歧义为零**的行，宁可留 NULL 也不挂错人：
 *
 * 1. 该 (store_id, phone) 在 marketing_customers 里只对应一个 club_user_id ——
 *    多个不同 club 用户共用同一号码时无法判断归属，跳过；
 * 2. 该 (store_id, phone) 在 members 里只有一条记录 ——
 *    多条时回填会撞 uq_members_store_club_user 部分唯一索引。
 *
 * 回填不上的记录保留 NULL：后续由建档流程自然写入，或交人工核对。
 */
UPDATE "members" m
   SET "club_user_id" = src."club_user_id"
  FROM (
       SELECT mc."store_id",
              mc."phone",
              MIN(mc."club_user_id") AS "club_user_id"
         FROM "marketing_customers" mc
        WHERE mc."club_user_id" IS NOT NULL
          AND mc."deleted_at" IS NULL
          AND COALESCE(mc."phone", '') <> ''
        GROUP BY mc."store_id", mc."phone"
       HAVING COUNT(DISTINCT mc."club_user_id") = 1
       ) src
 WHERE m."club_user_id" IS NULL
   AND m."phone" = src."phone"
   AND m."store_id" = src."store_id"
   AND (
        SELECT COUNT(*)
          FROM "members" x
         WHERE x."store_id" = m."store_id"
           AND x."phone" = m."phone"
       ) = 1;
