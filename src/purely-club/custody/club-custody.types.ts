/**
 * 客存 C 端读投影：只声明会员视角真正消费的列。
 *
 * 为什么单独成文件而不是写在 service 里：
 * 投影必须与 `club-custody.mapper.ts` 的读取字段严格一一对应，
 * 两边放在一起（types 定义投影、mapper 只接受投影类型）能让
 * 「mapper 多读一列」在编译期就报错，而不是等到线上才发现白拉了几列。
 *
 * 注意：客存单没有大 JSON 快照列，但仍有 orderNo / memberNameSnapshot /
 * stockMode / sourceOrderId / voidedAt 等 B 端与审计列，会员端一个都不用。
 */
import type { Prisma } from '@prisma/client';

/**
 * 会员视角存单投影。
 *
 * `createdAt` 不在 DTO 里，但列表游标是 `(createdAt, id)` 复合键
 * （见 `custody.query.ts` 的 `encodeCursor`），缺它无法为下一页编码游标，
 * 因此它属于「必须保留」的字段而非冗余。
 */
export const CLUB_CUSTODY_ORDER_VIEW_SELECT = {
  id: true,
  storeId: true,
  createdAt: true,
  productName: true,
  specName: true,
  unit: true,
  totalQty: true,
  remainingQty: true,
  location: true,
  storedAt: true,
  expireAt: true,
  status: true,
  note: true,
  image: true,
} as const satisfies Prisma.CustodyOrderSelect;

/** 会员视角存单记录（= 上述投影的查询返回类型） */
export type ClubCustodyOrderViewRecord = Prisma.CustodyOrderGetPayload<{
  select: typeof CLUB_CUSTODY_ORDER_VIEW_SELECT;
}>;

/**
 * 取出流水投影：对齐 `mapClubPickupRecord`。
 *
 * 核销店员 / 关联消费单 / 幂等键属于 B 端审计口径，会员端不展示也不透出。
 */
export const CLUB_CUSTODY_PICKUP_VIEW_SELECT = {
  id: true,
  custodyOrderId: true,
  qty: true,
  pickedAt: true,
} as const satisfies Prisma.CustodyPickupSelect;

/** 会员视角取件流水记录（= 上述投影的查询返回类型） */
export type ClubCustodyPickupViewRecord = Prisma.CustodyPickupGetPayload<{
  select: typeof CLUB_CUSTODY_PICKUP_VIEW_SELECT;
}>;
