// 扫码点餐「当场扣款」两条链路共用的收尾动作
//
// 余额支付与开发态确认虽然落账路径不同，但事务提交后要做的事完全一致：
// 失效营销衍生缓存、广播带取餐号的订单状态、按归属校验读回订单。
// 抽成纯函数而不是基类，是为了让两条链路互不继承、各自只声明需要的依赖。
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CacheInvalidatorService } from '../../redis/invalidator';
import type { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import type { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

/** 落账后需要回给实时网关的订单行（含取餐号与乐观锁版本） */
export type PaidScanOrder = Awaited<
  ReturnType<Prisma.TransactionClient['scanOrders']['findUniqueOrThrow']>
>;

/** 下单时写入的积分抵扣快照（缺省按 0 处理） */
export interface ScanOrderPointsSnapshot {
  pointsUsed: number;
  pointsDeductAmount: number;
}

/** 事务提交后广播所需的协作方 */
export interface ScanOrderPaidPublishDeps {
  cacheInvalidatorService: CacheInvalidatorService;
  realtimeService: ScanOrderingRealtimeService;
  pickupNumberService: ScanOrderingPickupNumberService;
}

/** 读取订单上的积分抵扣快照：老订单可能没有该字段，一律按 0 兜底 */
export function readScanOrderPointsSnapshot(
  snapshot: unknown,
): ScanOrderPointsSnapshot {
  const pointsSnapshot = (snapshot ?? {}) as {
    pointsUsed?: number;
    pointsDeductAmount?: number;
  };
  return {
    pointsUsed: pointsSnapshot.pointsUsed ?? 0,
    pointsDeductAmount: pointsSnapshot.pointsDeductAmount ?? 0,
  };
}

/**
 * 落账成功后的副作用：先失效营销衍生缓存，再广播订单状态。
 *
 * 缓存必须先失效再广播：商家端收到事件后会立刻拉列表，
 * 顺序反了就会读到旧概览/旧顾客数据。
 */
export async function publishScanOrderPaid(
  deps: ScanOrderPaidPublishDeps,
  order: PaidScanOrder,
): Promise<void> {
  // 余额/积分已落账：失效营销衍生缓存（概览 / 顾客列表 / 顾客详情），
  // 否则商家端要等 TTL（概览 120s、列表 60s、详情 15s）才看得到变化
  await deps.cacheInvalidatorService.invalidateMarketingCustomerDerived(
    order.storeId,
  );

  deps.realtimeService.publishOrderStatusChanged({
    storeId: order.storeId,
    orderId: order.id,
    sessionId: order.sessionId,
    // 支付成功会推进乐观锁版本：不带 version 时商家端列表项版本会一直是旧的，
    // 接单/拒单首次请求必然 409（表现为「要点两次才能接单」）
    version: order.version,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    pickupNumber: order.pickupNumber,
    pickupNumberLabel: deps.pickupNumberService.formatPickupNumber(
      order.pickupNumber,
    ),
    pickupNumberStatus: order.pickupNumberStatus,
    pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
    pickupCompletedAt: order.pickupCompletedAt?.toISOString() ?? null,
  });
}

/** 按「本人 + 未删除」读回订单，作为支付接口的响应体 */
export async function loadOwnedScanOrder(
  prisma: PrismaService,
  user: AuthenticatedUser,
  orderId: number,
): Promise<unknown> {
  const order = await prisma.scanOrders.findFirst({
    where: { id: orderId, clubUserId: user.id, deletedAt: null },
    include: {
      items: { include: { specs: true }, orderBy: { sortOrder: 'asc' } },
      paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!order) throw new NotFoundException('订单不存在');
  return order;
}
