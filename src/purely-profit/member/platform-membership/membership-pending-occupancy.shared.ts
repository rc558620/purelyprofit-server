// 待支付会员订单的额度占用与幂等口径
//
// 真实模式下单不预扣积分 / 纯利豆（避免为未支付的单子先扣一笔再补一套回滚），
// 改为「算价时把未过期待支付订单占用的额度扣掉」。测试模式与真实模式必须共用
// 这一份口径，否则切换模式后会把已经承诺出去的额度重复算成可用。
import type { PrismaExecutor } from './platform-membership.types';

/** 待支付会员订单的占用有效期：与平台支付单 TTL 一致（15 分钟） */
export const MEMBERSHIP_PENDING_TTL_MS = 15 * 60 * 1000;

/** 占用统计 / 过期清理的时间下界 */
export function resolvePendingOccupancyCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - MEMBERSHIP_PENDING_TTL_MS);
}

/**
 * 把超时未支付的会员订单置为 failed。
 *
 * 会员订单自身没有过期字段，而额度占用按「未过期待支付单」计算：
 * 不清理过期单，一次下单失败就会永久占住该门店的积分 / 纯利豆额度。
 */
export async function closeExpiredPendingOrders(
  tx: PrismaExecutor,
  profileId: number,
  now: Date = new Date(),
): Promise<number> {
  const closed = await tx.storeMembershipOrder.updateMany({
    where: {
      profileId,
      status: 'pending',
      createdAt: { lt: resolvePendingOccupancyCutoff(now) },
    },
    data: { status: 'failed' },
  });

  return closed.count;
}

/** 未过期待支付订单已占用的积分 / 纯利豆合计 */
export async function sumPendingOccupiedDeductions(
  tx: PrismaExecutor,
  profileId: number,
  now: Date = new Date(),
): Promise<{ points: number; beans: number }> {
  const result = await tx.storeMembershipOrder.aggregate({
    where: {
      profileId,
      status: 'pending',
      createdAt: { gte: resolvePendingOccupancyCutoff(now) },
    },
    _sum: { pointsUsed: true, beansUsed: true },
  });

  return {
    points: result._sum.pointsUsed ?? 0,
    beans: result._sum.beansUsed ?? 0,
  };
}

/** 可复用的待支付订单 */
export interface ReusablePendingOrder {
  orderId: number;
  orderNo: string;
  amountFen: number;
  planId: string;
  pointsUsed: number;
  beansUsed: number;
  expiresAt: Date;
  /** 已生成过的二维码；为空说明上一笔还在出码中 */
  codeUrl: string | null;
}

/**
 * 待支付订单的复用判定结果。
 *
 * 单独分出「钱已经收到、只是权益还没落地」这一态：这种情况下既不能复用
 * 二维码（用户已经付过款），也不能像过期单那样直接置 failed 再开新单 ——
 * 否则用户会为同一档会员付第二次钱。
 */
export type PendingOrderReuseResult =
  | { kind: 'reusable'; order: ReusablePendingOrder }
  | { kind: 'paid_awaiting_settlement'; orderNo: string }
  | { kind: 'none' };

/**
 * 判定当前是否还能复用未过期的待支付订单。
 *
 * - 支付单已结束（closed / failed / 已过期）而会员订单仍停在 pending：顺手置 failed，
 *   只关支付单会让订单永久占住额度。
 * - 支付单已 paid：交给调用方提示「已支付、生效中」，绝不再开新单。
 */
export async function resolvePendingOrderForReuse(
  tx: PrismaExecutor,
  profileId: number,
  now: Date = new Date(),
): Promise<PendingOrderReuseResult> {
  const order = await tx.storeMembershipOrder.findFirst({
    where: {
      profileId,
      status: 'pending',
      paymentOrderId: { not: null },
      createdAt: { gte: resolvePendingOccupancyCutoff(now) },
    },
    select: {
      id: true,
      planId: true,
      pointsUsed: true,
      beansUsed: true,
      amount: true,
      paymentOrderId: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!order || !order.paymentOrderId) {
    return { kind: 'none' };
  }

  const paymentOrder = await tx.platformPaymentOrder.findUnique({
    where: { orderNo: order.paymentOrderId },
    select: { status: true, codeUrl: true, expiresAt: true },
  });

  if (!paymentOrder) {
    await tx.storeMembershipOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'failed' },
    });
    return { kind: 'none' };
  }

  if (paymentOrder.status === 'paid') {
    // 钱已收、权益未落地：保留订单让补偿任务继续生效，绝不置 failed 后另开新单
    return { kind: 'paid_awaiting_settlement', orderNo: order.paymentOrderId };
  }

  // 状态已是 pending 但仍可能刚刚过期（惰性关单只在前端轮询时触发），
  // 复用一张过期二维码会让用户扫到「订单已过期」的报错
  if (
    paymentOrder.status !== 'pending' ||
    paymentOrder.expiresAt.getTime() <= now.getTime()
  ) {
    await tx.storeMembershipOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'failed' },
    });
    return { kind: 'none' };
  }

  return {
    kind: 'reusable',
    order: {
      orderId: order.id,
      orderNo: order.paymentOrderId,
      amountFen: order.amount,
      planId: order.planId,
      pointsUsed: order.pointsUsed,
      beansUsed: order.beansUsed,
      expiresAt: paymentOrder.expiresAt,
      codeUrl: paymentOrder.codeUrl,
    },
  };
}
