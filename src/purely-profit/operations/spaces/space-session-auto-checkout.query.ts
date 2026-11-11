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
