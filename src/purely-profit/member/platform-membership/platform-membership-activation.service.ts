// 平台会员购买「生效」：扣纯利豆 → 更新会员档期与积分 → 写积分流水 → 订单置 paid → 锁价
//
// 从 purchaseOrder 的事务体里抽出来的原因：接入真实支付后，「生效」发生的时间点
// 从「下单瞬间」变成「支付回调时」，但生效规则必须只有一份实现——
// 两份实现必然漂移，表现为「同一笔购买在不同模式下权益结果不同」。
//
// 入参里的金额一律由调用方用后端算价结果传入（分），本服务不做任何金额计算。
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DAY_MS, PURCHASE_BONUS_POINTS } from './platform-membership.constants';
import { resolveEffectivePlanId } from './membership-plan-resolver';
import {
  buildPlanExpiryAt,
  resolveMembershipExpiry,
} from './membership-expiry.utils';
import { requirePlan } from './platform-membership.query';
import type {
  PrismaExecutor,
  StoreMembershipOrderRecord,
  StoreMembershipProfileRecord,
} from './platform-membership.types';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';

/** 订单回写后统一返回的字段，保证两条生效路径（下单 / 回调）拿到同样结构 */
const ORDER_SELECT = {
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
} as const;

export interface ActivateMembershipPurchaseParams {
  storeId: number;
  profileId: number;
  planId: PlatformMembershipPlanId;
  /** 档位原价（分），用于锁价与订单落库 */
  planPrice: number;
  /** 本次实际抵扣的纯利豆数量 */
  actualBeansUsed: number;
  /** 本次实际抵扣的积分数量 */
  actualPointsUsed: number;
  /** 实付金额（分） */
  finalAmount: number;
  /** 已预建的待支付订单 ID；传入则更新该单，否则新建 */
  orderId?: number;
  /**
   * 当前合伙人（含豆余额）。
   *
   * 由调用方在自己的事务里查好传入，而不是在这里再查一次：
   * 「下单校验余额」与「生效时扣减」必须看到同一份余额快照，
   * 否则中间发生其它扣减时会出现「校验通过但扣不到」的幽灵失败。
   */
  partner: { id: number; beanBalance: number } | null;
  /**
   * 生效前的会员档案快照。
   *
   * 由调用方在自己的事务里读取并传入：下单路径复用算价时已经读到的档案，
   * 回调路径在事务内读一次。刻意不在本服务里再查一次——
   * 「算价用的档案」与「生效用的档案」必须是同一份快照，否则中间若有其它写入，
   * 积分余额会按旧值算出 NaN / 负数。
   */
  profile: Pick<
    StoreMembershipProfileRecord,
    | 'availablePoints'
    | 'totalPoints'
    | 'currentPlanId'
    | 'startsAt'
    | 'expiresAt'
  >;
  /** 外部支付单号（真实支付为平台支付单号） */
  paymentOrderId: string;
}

/** 生效后回写的会员档案（字段与响应组装所需的快照一致） */
export type ActivatedMembershipProfileRecord = StoreMembershipProfileRecord;

/**
 * 生效后回写的订单记录。
 *
 * 直接复用响应组装用的记录类型：两条生效路径（下单 / 回调）拿到完全相同的结构，
 * 组装层不会因来源不同而分支。
 */
export type ActivatedMembershipOrderRecord = StoreMembershipOrderRecord;

export interface ActivateMembershipPurchaseResult {
  /** 生效后的订单记录：直接用于响应组装，避免写完再回查 */
  order: ActivatedMembershipOrderRecord;
  /** 生效后的会员档案：由 update 直接返回，不二次回查 */
  profile: ActivatedMembershipProfileRecord;
  grantedPoints: number;
}

@Injectable()
export class PlatformMembershipActivationService {
  private readonly logger = new Logger(
    PlatformMembershipActivationService.name,
  );

  /** 执行生效（调用方必须已在同一事务里） */
  async activate(
    tx: PrismaExecutor,
    params: ActivateMembershipPurchaseParams,
  ): Promise<ActivateMembershipPurchaseResult> {
    const plan = await requirePlan(tx, params.planId);
    const now = new Date();

    await this.deductBeans(tx, params, plan.name);

    const bonusPoints = PURCHASE_BONUS_POINTS[plan.id] ?? 0;
    const updatedProfile = await this.applyMembershipPeriod(
      tx,
      params,
      plan,
      bonusPoints,
      now,
    );

    await this.writePointsLogs(tx, params, bonusPoints, plan.name);

    const order = await this.writeOrder(tx, params, plan.name, now);

    this.logger.log(
      `[会员生效] storeId=${params.storeId} planId=${plan.id} orderId=${order.id} amountFen=${params.finalAmount}`,
    );

    return {
      order,
      profile: updatedProfile,
      grantedPoints: bonusPoints,
    };
  }

  /** 原子扣减纯利豆：条件更新保证并发下不会扣成负数 */
  private async deductBeans(
    tx: PrismaExecutor,
    params: ActivateMembershipPurchaseParams,
    planName: string,
  ): Promise<void> {
    if (params.actualBeansUsed <= 0) {
      return;
    }

    const partner = params.partner;

    if (!partner || partner.beanBalance < params.actualBeansUsed) {
      throw new ConflictException('纯利豆余额不足，请刷新后重试');
    }

    const updated = await tx.storePartner.updateMany({
      where: {
        id: partner.id,
        storeId: params.storeId,
        status: 'approved',
        beanBalance: { gte: params.actualBeansUsed },
      },
      data: { beanBalance: { decrement: params.actualBeansUsed } },
    });

    if (updated.count !== 1) {
      throw new ConflictException('纯利豆余额不足，请刷新后重试');
    }

    await tx.storePartnerBeanLog.create({
      data: {
        storeId: params.storeId,
        partnerId: partner.id,
        source: 'deduct_payment',
        changeAmount: -params.actualBeansUsed,
        description: `纯利豆抵扣 · 订阅${planName}`,
        relatedPlanType: params.planId,
      },
    });
  }

  /** 计算并写入新的会员档期与积分余额 */
  private async applyMembershipPeriod(
    tx: PrismaExecutor,
    params: ActivateMembershipPurchaseParams,
    plan: Awaited<ReturnType<typeof requirePlan>>,
    bonusPoints: number,
    now: Date,
  ): Promise<StoreMembershipProfileRecord> {
    const profile = params.profile;

    // 积分按「相对增减」写入：并发生效的两笔订单如果各自拿快照做减法，
    // 后写入的会把先写入的扣减整体覆盖（丢更新），最终余额比实际多。
    const pointsDelta = bonusPoints - params.actualPointsUsed;

    const isLegacyLifetimeMembership =
      profile.currentPlanId === 'yearly' && profile.expiresAt === null;
    const currentExpiryMs =
      resolveMembershipExpiry(profile).expiresAt?.getTime() ?? 0;
    const baseMs =
      currentExpiryMs > now.getTime() ? currentExpiryMs : now.getTime();
    const nextExpiresAt = buildPlanExpiryAt(plan, baseMs);
    const currentActivePlanId =
      currentExpiryMs > now.getTime() ? profile.currentPlanId : null;
    const nextPlanId = isLegacyLifetimeMembership
      ? 'yearly'
      : resolveEffectivePlanId(currentActivePlanId, params.planId);
    const nextStartsAt = isLegacyLifetimeMembership
      ? new Date(nextExpiresAt.getTime() - 730 * DAY_MS)
      : (profile.startsAt ?? now);

    try {
      return await tx.storeMembershipProfile.update({
        where: {
          id: params.profileId,
          // 并发 / 非负保护：余额不足时更新命中 0 行（抛 P2025），绝不能扣成负数
          availablePoints: { gte: params.actualPointsUsed },
        },
        data: {
          currentPlanId: nextPlanId,
          // 下单成功后 currentPlanId 就是最新的续费依据，清掉降级时转存的原档位
          previousPlanId: null,
          startsAt: nextStartsAt,
          expiresAt: isLegacyLifetimeMembership ? null : nextExpiresAt,
          totalPoints: { increment: pointsDelta },
          availablePoints: { increment: pointsDelta },
        },
        select: {
          id: true,
          storeId: true,
          currentPlanId: true,
          previousPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('积分余额不足，会员无法生效，请刷新后重试');
      }
      throw error;
    }
  }

  /** 写积分抵扣与赠送流水 */
  private async writePointsLogs(
    tx: PrismaExecutor,
    params: ActivateMembershipPurchaseParams,
    bonusPoints: number,
    planName: string,
  ): Promise<void> {
    if (params.actualPointsUsed > 0) {
      await tx.storeMembershipPointsLog.create({
        data: {
          storeId: params.storeId,
          profileId: params.profileId,
          source: 'deduct_payment',
          changeType: 'decrease',
          changeAmount: params.actualPointsUsed,
          description: `订阅${planName}抵扣`,
        },
      });
    }

    if (bonusPoints > 0) {
      await tx.storeMembershipPointsLog.create({
        data: {
          storeId: params.storeId,
          profileId: params.profileId,
          source: 'purchase_bonus',
          changeType: 'increase',
          changeAmount: bonusPoints,
          description: `购买${planName}赠积分`,
        },
      });
    }
  }

  /** 写入订单：已预建则置 paid，否则新建；返回完整记录供响应组装 */
  private async writeOrder(
    tx: PrismaExecutor,
    params: ActivateMembershipPurchaseParams,
    planName: string,
    now: Date,
  ): Promise<ActivatedMembershipOrderRecord> {
    if (params.orderId !== undefined) {
      return tx.storeMembershipOrder.update({
        where: { id: params.orderId },
        data: {
          status: 'paid',
          paymentChannel: 'wechat',
          paymentOrderId: params.paymentOrderId,
          paidAt: now,
        },
        select: ORDER_SELECT,
      });
    }

    const created = await tx.storeMembershipOrder.create({
      data: {
        storeId: params.storeId,
        profileId: params.profileId,
        planId: params.planId,
        planName,
        originalAmount: params.planPrice,
        pointsUsed: params.actualPointsUsed,
        beansUsed: params.actualBeansUsed,
        amount: params.finalAmount,
        status: 'paid',
        paymentChannel: 'wechat',
        paymentOrderId: params.paymentOrderId,
        paidAt: now,
      },
      select: ORDER_SELECT,
    });

    return created;
  }
}
