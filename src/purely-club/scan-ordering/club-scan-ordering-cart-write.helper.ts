import { Prisma } from '@prisma/client';

/**
 * 扫码点餐购物车「加购」的原子写入 SQL。
 *
 * 原实现用交互式事务包 `findFirst → create/update → 规格 create`：单次加购要付
 * 5 次数据库往返（BEGIN / SELECT / 写行 / 写规格 / COMMIT），并发首购同一规格时
 * 还会撞 `uq_scan_ordering_cart_item_active` 抛 P2002，只能靠捕获异常后重试收敛。
 *
 * 这里压成一条语句：CTE 内对部分唯一索引做 `ON CONFLICT DO UPDATE`，再把返回的 id
 * 作为规格行的来源做第二次 upsert。行与规格在同一语句内完成 → 天然原子；并发首购由
 * 数据库排队后走 UPDATE 分支，不会抛唯一冲突。
 *
 * 注意（改动此处前务必确认）：
 *  - `ON CONFLICT` 的推断谓词必须与索引定义逐字一致
 *    （`status = 'active'::"CartItemStatus" AND deleted_at IS NULL`），
 *    否则 PostgreSQL 无法推断出该部分索引，会直接报错而不是静默降级；
 *  - `updated_at` 在 Prisma 里由 `@updatedAt` 在客户端赋值、库无默认值，
 *    原始 SQL 必须显式写入；
 *  - `line_total_amount` 必须按「累加后的数量 × 本次单价」重算，不能直接用
 *    EXCLUDED 的值——加购时单价可能因规格改价而变化。
 */
export interface ClubCartItemUpsertParams {
  sessionId: number;
  menuProductId: number;
  /** 规格组合签名（specOptionIds 排序后 sha256），部分唯一索引的第三列 */
  specSignature: string;
  /** 本次加购数量（累加量） */
  quantity: number;
  /** 本次加购的最新单价（分） */
  unitPriceAmount: number;
  specs: ReadonlyArray<{ specOptionId: number; extraPriceSnapshot: number }>;
}

/** 构造加购语句：无规格商品只 upsert 行，有规格商品联写规格行。 */
export const buildClubCartItemUpsertQuery = (
  params: ClubCartItemUpsertParams,
): Prisma.Sql => {
  const { sessionId, menuProductId, specSignature } = params;
  const { quantity, unitPriceAmount, specs } = params;
  const lineTotalAmount = quantity * unitPriceAmount;

  const upsertItem = Prisma.sql`
    INSERT INTO "scan_ordering_cart_items" (
      "session_id", "menu_product_id", "spec_signature",
      "quantity", "unit_price_amount", "line_total_amount",
      "version", "status", "created_at", "updated_at"
    ) VALUES (
      ${sessionId}, ${menuProductId}, ${specSignature},
      ${quantity}, ${unitPriceAmount}, ${lineTotalAmount},
      1, 'active'::"CartItemStatus", now(), now()
    )
    ON CONFLICT ("session_id", "menu_product_id", "spec_signature")
      WHERE "status" = 'active'::"CartItemStatus" AND "deleted_at" IS NULL
    DO UPDATE SET
      "quantity" = "scan_ordering_cart_items"."quantity" + EXCLUDED."quantity",
      "unit_price_amount" = EXCLUDED."unit_price_amount",
      "line_total_amount" =
        ("scan_ordering_cart_items"."quantity" + EXCLUDED."quantity")
        * EXCLUDED."unit_price_amount",
      "version" = "scan_ordering_cart_items"."version" + 1,
      "updated_at" = now()
  `;

  if (specs.length === 0) {
    return upsertItem;
  }

  const specValues = Prisma.join(
    specs.map(
      (spec) =>
        Prisma.sql`(${spec.specOptionId}::int, ${spec.extraPriceSnapshot}::int)`,
    ),
  );

  return Prisma.sql`
    WITH "upserted" AS (
      ${upsertItem}
      RETURNING "id"
    )
    INSERT INTO "scan_ordering_cart_item_specs" (
      "cart_item_id", "spec_option_id", "extra_price_snapshot", "created_at"
    )
    SELECT upserted."id", spec_source."spec_option_id",
           spec_source."extra_price_snapshot", now()
    FROM "upserted" CROSS JOIN (
      VALUES ${specValues}
    ) AS spec_source ("spec_option_id", "extra_price_snapshot")
    ON CONFLICT ("cart_item_id", "spec_option_id")
    DO UPDATE SET "extra_price_snapshot" = EXCLUDED."extra_price_snapshot"
  `;
};
