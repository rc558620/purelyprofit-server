import type { ClubMemberHeldLevelValue } from '../dto/club-member-account.dto';

/**
 * 空结果哨兵。
 *
 * 用显式对象而非 `null` 表达「已确认无档案」：`getJson` 返回 null 同时覆盖
 * 「key 不存在」与「缓存了 null」两种语义，选 null 就得多跑一次 EXISTS 兜底。
 * 换成 `{ found: false }` 后可单次 GET 判定，每次未命中少一次 RTT。
 */
export const MISS_SENTINEL = { found: false } as const;

/** 快照缓存值：正常快照或空结果哨兵。 */
export type ClubMemberSnapshotCacheValue =
  | ClubMemberSnapshot
  | typeof MISS_SENTINEL;

/** 会员记录（member 表）投影字段。 */
export interface ClubMemberAccountRecord {
  id: number;
  createdAt: Date;
}

/** 顾客档案（marketing_customer 表）投影字段。 */
export interface ClubMarketingCustomerRecord {
  id: number;
  balance: number;
  points: number;
  tier: string;
  createdAt: Date;
}

export interface ClubMemberSnapshot {
  /**
   * 关联 MarketingCustomer.id（顾客档案 ID）。
   *
   * 顾客本人链路（护理档案等挂 customerId 的业务）必须以此为唯一入口：
   * 由本服务的两层锚定推导出来，禁止调用方自行按手机号再查一次——
   * 那会绕过「无主档案」限定，拿到同号他人的档案。
   * 无顾客档案（有 Member 无 MarketingCustomer）时为 null；
   * Redis 里可能残留本次发布前的旧快照，该字段为 undefined，按 null 处理。
   */
  customerId: number | null;
  memberId: number;
  storeId: number;
  balance: number;
  level: ClubMemberHeldLevelValue;
  points: number;
  memberCode: string;
  joinDate: string;
  totalConsume: number;
}
