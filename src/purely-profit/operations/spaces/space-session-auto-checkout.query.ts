import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  type GrouponVoucherFacts,
  toGrouponVoucherFacts,
} from './space-care-record-snapshot.shared';

/** 自动结账扫描所需的最小 DB 读取面，便于单元测试注入 */
type AutoCheckoutScanStore = Pick<PrismaService, 'spaceSession'>;
type VoucherFactsStore = Pick<PrismaService, 'clubVoucherOrder'>;
type AutoCheckoutDueIdStore = Pick<PrismaService, '$queryRaw'>;

/**
 * 单轮单门店最多处理的到期会话数。
 *
 * 自动结账持有门店级分布式锁，一轮扫描不能无限延长锁持有时间；
 * 超出的到期会话留给下一轮（60s 后），避免一次把上千条会话连同子表读进内存。
 */
export const AUTO_CHECKOUT_SESSION_BATCH_SIZE = 200;

/**
 * 在数据库侧精确筛出「已到期」的倒计时会话 ID。
 *
 * 到期时间 = start_time + countdown_minutes（与 resolveAutoCheckoutAt 同一口径，
 * countdownMinutes 是续费累加后的累计值）。Prisma 不支持列间比较，这里用
 * raw SQL 把判断下推，避免先把全店倒计时会话（含 sessionItems / renewRecords
 * 两个子表）读回应用层再逐条算到期。
 *
 * 时间口径：space_sessions.start_time 是 `timestamp(3)`（存 UTC 墙钟），
 * 参数显式 `AT TIME ZONE 'UTC'` 转成同样的墙钟，避免依赖数据库会话时区。
 */
export async function findDueAutoCheckoutSessionIds(
  db: AutoCheckoutDueIdStore,
  storeId: number,
  now: number,
  limit: number = AUTO_CHECKOUT_SESSION_BATCH_SIZE,
): Promise<number[]> {
  const rows = await db.$queryRaw<Array<{ id: number }>>`
    SELECT id
    FROM space_sessions
    WHERE store_id = ${storeId}
      AND status::text = 'active'
      AND end_time IS NULL
      AND billing_mode::text = 'countdown'
      AND auto_checkout = true
      AND countdown_minutes > 0
      AND start_time + (countdown_minutes * interval '1 minute')
          <= (${new Date(now)}::timestamptz AT TIME ZONE 'UTC')
    ORDER BY start_time ASC, id ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}

/**
 * 找出存在「可能到期」倒计时会话的门店。
 *
 * 到期时间 = startTime + countdownMinutes（见 resolveAutoCheckoutAt），两者都是表字段，
 * 因此 startTime < now 且 countdownMinutes > 0 是可下推的必要非充分条件：
 * 先在 SQL 侧裁掉未来开台与非法倒计时会话，避免每 60s 全平台搬运未到期数据。
 * 门店去重交给 DISTINCT ON，不再把全部会话行拉回应用层做 Set。
 * 仍保留「标量条件 / 续费记录半连接」两条形态简单的查询，避免计划器退化。
 */
export async function findStoresWithPendingAutoCheckoutSessions(
  db: AutoCheckoutScanStore,
  now: number,
): Promise<number[]> {
  const baseWhere = {
    status: PrismaSpaceSessionStatus.active,
    endTime: null,
    billingMode: PrismaSpaceBillingMode.countdown,
    autoCheckout: true,
    countdownMinutes: { gt: 0 },
    startTime: { lt: new Date(now) },
  } satisfies Prisma.SpaceSessionWhereInput;

  const [prepaidOrRatedSessions, renewedSessions] = await Promise.all([
    db.spaceSession.findMany({
      where: {
        ...baseWhere,
        OR: [
          { prepaidPaymentMethod: { not: null } },
          { prepaidCustomerPaymentMethod: { not: null } },
          { prepaidVoucherFaceAmount: { not: null } },
          { hourlyRate: { gt: 0 } },
        ],
      },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
    db.spaceSession.findMany({
      where: {
        ...baseWhere,
        sessionRenewRecords: { some: {} },
      },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
  ]);

  return Array.from(
    new Set([
      ...prepaidOrRatedSessions.map((session) => session.storeId),
      ...renewedSessions.map((session) => session.storeId),
    ]),
  ).sort((left, right) => left - right);
}

/**
 * 批量反查团购券商品名与成本快照。
 * voucher_code 在数据库侧唯一，一次 IN 查询与逐条 findFirst 等价；
 * 用于替代自动结账循环内每条会话各发一条 SQL 的 N+1。
 */
export async function loadVoucherFactsByCode(
  db: VoucherFactsStore,
  storeId: number,
  voucherCodes: Array<string | null | undefined>,
): Promise<Map<string, GrouponVoucherFacts>> {
  const codes = [
    ...new Set(
      voucherCodes
        .map((code) => code?.trim())
        .filter((code): code is string => !!code),
    ),
  ];
  const factsByCode = new Map<string, GrouponVoucherFacts>();
  if (codes.length === 0) {
    return factsByCode;
  }

  const orders = await db.clubVoucherOrder.findMany({
    where: { storeId, voucherCode: { in: codes } },
    select: {
      voucherCode: true,
      productName: true,
      productPrice: true,
      productCostPrice: true,
    },
  });
  for (const order of orders) {
    const code = order.voucherCode?.trim();
    if (code) {
      factsByCode.set(code, toGrouponVoucherFacts(order));
    }
  }
  return factsByCode;
}
