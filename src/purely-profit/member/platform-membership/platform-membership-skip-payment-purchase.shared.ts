// 测试模式（跳过支付）购买会员的事务体：算价、去重、落支付单与生效统一在此收口
import { ConflictException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import type { PlatformMembershipActivationService } from './platform-membership-activation.service';
import {
  isRenewalPlanPurchasable,
  SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE,
} from './membership-renewal-policy.shared';
import type { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { buildProfileResponse } from './membership-profile.mapper';
import {
  buildOrdersOverview,
  calcMemberPlanPayment,
  mapOrder,
} from './platform-membership-ledger.domain';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type { PurchasePlatformMembershipOrderDto } from './dto/platform-membership-query.dto';
import {
  ensureMembershipProfile,
  findCurrentStorePartner,
  requirePlan,
} from './platform-membership.query';
import {
  closeExpiredPendingOrders,
  sumPendingOccupiedDeductions,
} from './membership-pending-occupancy.shared';

/**
 * 测试模式（跳过支付）的重复提交判定窗口。
 *
 * 真实模式靠「未过期待支付单直接复用」挡住连点；测试模式下单即生效，
 * 没有可复用的待支付态，必须靠时间窗 + 同档案同档位把连点收成一次。
 */
export const SKIP_PAYMENT_DEDUP_WINDOW_MS = 30 * 1000;

/** 事务体内需要的外部能力（服务实例与日志） */
export interface SkipPaymentPurchaseDeps {
  logger: Logger;
  lockedPriceService: StoreMembershipLockedPriceService;
  paymentOrderService: PlatformPaymentOrderService;
  activationService: PlatformMembershipActivationService;
}

/** 事务体内需要的上下文（当前操作人、门店与入参） */
export interface SkipPaymentPurchaseParams {
  tx: Prisma.TransactionClient;
  userId: number;
  storeId: number;
  dto: PurchasePlatformMembershipOrderDto;
}

/**
 * 事务体返回值：`_planId` / `_amount` 供事务后异步发放推广奖励与额度使用，
 * 由调用方剥离后再返回前端，避免内部字段外泄。
 */
export interface SkipPaymentPurchaseOutcome {
  order: ReturnType<typeof mapOrder>;
  profile: ReturnType<typeof buildProfileResponse>;
  overview: ReturnType<typeof buildOrdersOverview>;
  _planId: PlatformMembershipPlanId;
  _amount: number;
}

export const purchaseWithSkippedPaymentInTransaction = async (
  deps: SkipPaymentPurchaseDeps,
  params: SkipPaymentPurchaseParams,
): Promise<SkipPaymentPurchaseOutcome> => {
  const { logger, lockedPriceService, paymentOrderService, activationService } =
    deps;
  const { tx, userId, storeId, dto } = params;
  const requestedPoints = dto.usePoints ?? 0;
  const requestedBeans = dto.useBeans ?? 0;

  const plan = await requirePlan(tx, dto.planId);
  const profile = await ensureMembershipProfile(tx, storeId);

  // 测试模式下单即生效，没有「待支付单复用」这层天然去重：
  // 连点 / 网络重试会各扣一次积分与纯利豆、各开一次会员档期。
  // 窗口内同档案同档位的已支付订单视为同一次操作，直接拒绝而不是再扣一笔。
  const duplicated = await tx.storeMembershipOrder.findFirst({
    where: {
      storeId,
      profileId: profile.id,
      planId: plan.id,
      status: 'paid',
      createdAt: {
        gte: new Date(Date.now() - SKIP_PAYMENT_DEDUP_WINDOW_MS),
      },
    },
    select: { id: true },
  });
  if (duplicated) {
    logger.warn(
      `[会员购买] 测试模式重复提交已拦截 orderId=${duplicated.id} storeId=${storeId} planId=${plan.id}`,
    );
    throw new ConflictException('订单正在处理，请勿重复提交');
  }

  const partner = await findCurrentStorePartner(tx, storeId);
  // 真实余额：生效时扣减要基于它，不能用扣掉占用后的额度
  const availableBeans = partner?.beanBalance ?? 0;

  // 与真实模式下单共用同一份占用口径：待支付订单已承诺出去的额度不能再算可用
  await closeExpiredPendingOrders(tx, profile.id);
  const occupied = await sumPendingOccupiedDeductions(tx, profile.id);
  const usablePoints = Math.max(0, profile.availablePoints - occupied.points);
  const usableBeans = Math.max(0, availableBeans - occupied.beans);

  // 曾开通子账号功能的门店按首购锁定价结算；月 / 季会被直接拒绝，避免误降级
  // （会员到期后实时能力会被归零，故必须用「曾开通」口径，否则到期即可降级）
  const pricingContext = await lockedPriceService.loadRenewalPricingContext(
    storeId,
    tx,
  );
  if (
    !isRenewalPlanPurchasable({
      planId: dto.planId,
      subAccountFeatureOwned: pricingContext.subAccountFeatureOwned,
    })
  ) {
    throw new ConflictException(SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE);
  }
  const { price: planPrice } = lockedPriceService.resolvePlanPrice({
    plan,
    context: pricingContext,
  });

  const payment = calcMemberPlanPayment({
    planPrice,
    requestedPoints,
    availablePoints: usablePoints,
    requestedBeans,
    availableBeans: usableBeans,
  });

  if (requestedPoints > 0 && payment.actualPointsUsed === 0) {
    throw new ConflictException('当前无可抵扣积分');
  }

  if (requestedBeans > 0 && payment.actualBeansUsed === 0) {
    throw new ConflictException('当前无可抵扣纯利豆');
  }

  // 测试模式也必须落一条支付单：否则「跳过支付」的订单在对账里完全不可见，
  // 真实单与测试单就无从区分（与额度充值链路同口径）
  const paymentOrder = await paymentOrderService.createOrder({
    bizType: 'membership',
    storeId,
    operatorUserId: userId,
    amountFen: payment.finalAmount,
    payMode: 'test',
    executor: tx,
  });

  // 生效（扣豆 / 更新档期与积分 / 写流水 / 建单）统一走激活服务，
  // 与支付回调路径同源，避免两条路径的权益结果漂移
  const activated = await activationService.activate(tx, {
    storeId,
    profileId: profile.id,
    planId: plan.id,
    planPrice,
    actualBeansUsed: payment.actualBeansUsed,
    actualPointsUsed: payment.actualPointsUsed,
    finalAmount: payment.finalAmount,
    paymentOrderId: paymentOrder.orderNo,
    partner: partner ? { id: partner.id, beanBalance: availableBeans } : null,
    profile: {
      availablePoints: profile.availablePoints,
      totalPoints: profile.totalPoints,
      currentPlanId: profile.currentPlanId,
      startsAt: profile.startsAt,
      expiresAt: profile.expiresAt,
    },
  });

  await paymentOrderService.markPaid({
    orderNo: paymentOrder.orderNo,
    transactionId: `manual-test-${paymentOrder.orderNo}`,
    executor: tx,
  });

  // 订单与会员档案都由生效服务直接回传，避免写完再回查一次
  const order = activated.order;
  const updatedProfile = activated.profile;

  // 首次成交价快照：已存在则不覆盖（锁定语义）
  await lockedPriceService.lockPriceOnFirstDeal({
    storeId,
    planId: plan.id,
    price: planPrice,
    source: 'purchase',
    executor: tx,
  });

  const [latestPartner, allOrders, inviteCodeRecord] = await Promise.all([
    findCurrentStorePartner(tx, storeId),
    tx.storeMembershipOrder.findMany({
      where: { storeId },
      select: {
        id: true,
        planId: true,
        planName: true,
        amount: true,
        pointsUsed: true,
        beansUsed: true,
        status: true,
        paymentChannel: true,
        paymentOrderId: true,
        createdAt: true,
      },
    }),
    tx.storeInviteCode.findFirst({
      where: { storeId, isActive: true },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    order: mapOrder(order),
    profile: buildProfileResponse(
      updatedProfile,
      latestPartner,
      inviteCodeRecord?.code ?? null,
    ),
    overview: buildOrdersOverview(allOrders),
    // 用于事务后异步触发推广奖励
    _planId: plan.id as PlatformMembershipPlanId,
    _amount: payment.finalAmount,
  };
};
