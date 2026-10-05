import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

export const clubAccessibleStoreSelect = {
  id: true,
  name: true,
  address: true,
  businessMode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreSelect;

/**
 * 可访问门店记录。
 *
 * 该结构会被整体写入 Redis（club:accessible-stores 缓存，TTL 60s），
 * JSON 反序列化回读后日期字段是 **ISO 字符串**，但 TS 类型无法表达这一点。
 * 因此这里显式标注 `Date | string`：需要比较 / 格式化时先走
 * `@shared/date-coerce.utils` 的 toTimestamp，禁止直接调 Date 实例方法。
 */
export type ClubAccessibleStoreRecord = Omit<
  Prisma.StoreGetPayload<{
    select: typeof clubAccessibleStoreSelect;
  }>,
  'createdAt' | 'updatedAt'
> & {
  /** 创建时间：缓存命中回读后为 ISO 字符串 */
  createdAt: Date | string;
  /** 更新时间：缓存命中回读后为 ISO 字符串（列表查询按此字段排序，排序在 SQL 侧完成） */
  updatedAt: Date | string;
};

export interface ClubCurrentContext {
  user: AuthenticatedUser;
  store: ClubAccessibleStoreRecord;
}
