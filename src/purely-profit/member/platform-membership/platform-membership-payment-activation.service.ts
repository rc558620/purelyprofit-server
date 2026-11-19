// 平台会员支付回调侧的权益生效编排：会员订单置 paid + 权益生效 + 首购锁价 + 副作用
//
// 从 platform-membership-payment.service.ts 拆出。与「下单换码」相比，这条链路的
// 关键约束是**幂等**：微信重复回调、前端轮询补生效、启动补偿可能同时打到同一笔单，
// 必须由支付单的「带状态条件更新」与事务内的行锁兜住，绝不能重复开通或重复扣豆。
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { PlatformMembershipActivationService } from './platform-membership-activation.service';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import {
  ensureMembershipProfile,
  findCurrentStorePartner,
} from './platform-membership.query';
import type { PrismaExecutor } from './platform-membership.types';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { NewCustomerQuotaService } from '../new-customer-quota/new-customer-quota.service';

/** 生效完成后交给副作用处理的摘要 */
interface ActivatedMembershipSummary {
  storeId: number;
  planId: PlatformMembershipPlanId;
  amount: number;
  operatorUserId: number | null;
}

@Injectable()
export class PlatformMembershipPaymentActivationService {
  private readonly logger = new Logger(
    PlatformMembershipPaymentActivationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly activationService: PlatformMembershipActivationService,
    private readonly promoService: PlatformMembershipPromoService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}

  /** 支付单号 → 会员订单 ID 的反查（回调生效时使用） */
  async findOrderIdByPaymentOrderNo(
    paymentOrderNo: string,
    executor: PrismaExecutor = this.prisma,
  ): Promise<{ orderId: number; storeId: number; amountFen: number } | null> {
    const order = await executor.storeMembershipOrder.findFirst({
      where: { paymentOrderId: paymentOrderNo },
      select: { id: true, storeId: true, amount: true },
    });
    if (!order) return null;
    return {
      orderId: order.id,
      storeId: order.storeId,
      amountFen: order.amount,
    };
  }

  /**
   * 支付回调生效：把待支付订单置为已生效（扣豆 / 更新档期 / 写流水 / 锁价）。
   *
   * 幂等由支付单的「带状态条件更新」保证：重复回调不会重复开通或重复扣豆。
   */
  async activateByPaymentOrderNo(params: {
    paymentOrderNo: string;
    transactionId: string;
    amountFen: number;
  }): Promise<void> {
    const activated = await this.paymentOrderService.settleWithBusinessWrite(
      params.paymentOrderNo,
      params.transactionId,
      async (tx) =>
        this.applyActivationInTx(tx, {
          paymentOrderNo: params.paymentOrderNo,
          amountFen: params.amountFen,
        }),
    );

    // 已处理过（重复回调）或金额校验失败都不会走到这里
    if (!activated) {
      return;
    }

    await this.afterMembershipActivated(activated);
  }

  /**
   * 在给定事务里执行「会员订单置 paid + 权益生效 + 锁价」。
   *
   * 回调与补偿两条路径共用：区别只在调用方是否先做过 markPaid。
   * 生效失败的常见原因是纯利豆 / 积分在支付窗口内被别处消耗，
   * 此时必须整笔回滚（支付单不能单独留在 paid），由补偿路径重试。
   */
  async applyActivationInTx(
    tx: PrismaExecutor,
    params: { paymentOrderNo: string; amountFen: number },
  ): Promise<ActivatedMembershipSummary | null> {
    const located = await this.findOrderIdByPaymentOrderNo(
      params.paymentOrderNo,
      tx,
    );
    if (!located) {
      throw new ConflictException('支付单对应的会员订单不存在');
    }

    const order = await tx.storeMembershipOrder.findUnique({
      where: { id: located.orderId },
      select: {
        id: true,
        storeId: true,
        profileId: true,
        planId: true,
        planName: true,
        originalAmount: true,
        amount: true,
        pointsUsed: true,
        beansUsed: true,
        status: true,
      },
    });

    if (!order) {
      throw new ConflictException('会员订单不存在，无法生效');
    }

    if (order.status === 'paid') {
      return null;
    }

    // 已退款的订单不能再被回调激活：否则会绕过人工退款决策
    if (order.status === 'refunded') {
      throw new ConflictException('会员订单已退款，不再生效');
    }

    // 资金安全：回调金额必须与落单金额一致
    if (order.amount !== params.amountFen) {
      throw new ConflictException('支付金额与订单金额不一致，已拒绝生效');
    }

    // 推广奖励要按「实际付款的用户」归属，只能取支付单上的发起人；
    // 会员订单本身没有 userId，此前误用 storeId 会查错人（或查不到人）
    const paymentOrder = await tx.platformPaymentOrder.findUnique({
      where: { orderNo: params.paymentOrderNo },
      select: { operatorUserId: true },
    });

    // 生效时才读一次档案与合伙人：与扣减在同一事务内，
    // 避免「算价时的快照」与「生效时的实际值」不一致
    const profile = await ensureMembershipProfile(tx, order.storeId);
    const partner = await findCurrentStorePartner(tx, order.storeId);

    await this.activationService.activate(tx, {
      storeId: order.storeId,
      profileId: order.profileId,
      planId: order.planId,
      planPrice: order.originalAmount,
      actualBeansUsed: order.beansUsed,
      actualPointsUsed: order.pointsUsed,
      finalAmount: order.amount,
      orderId: order.id,
      paymentOrderId: params.paymentOrderNo,
      partner: partner
        ? { id: partner.id, beanBalance: partner.beanBalance }
        : null,
      profile: {
        availablePoints: profile.availablePoints,
        totalPoints: profile.totalPoints,
        currentPlanId: profile.currentPlanId,
        startsAt: profile.startsAt,
        expiresAt: profile.expiresAt,
      },
    });

    await this.lockedPriceService.lockPriceOnFirstDeal({
      storeId: order.storeId,
      planId: order.planId,
      price: order.originalAmount,
      source: 'purchase',
      executor: tx,
    });

    // 新客额度赠送必须与权益生效同事务：只告警的话，订单已 paid 后重复回调
    // 不会再执行副作用，赠送失败就永久丢额度，补偿也只捞 pending / failed。
    // 并入事务后失败会整笔回滚，由补偿路径按支付单号重试（幂等靠事务回滚）。
    await this.quotaService.grantByPlan(order.storeId, order.planId, 1, tx);

    return {
      storeId: order.storeId,
      planId: order.planId,
      amount: order.amount,
      operatorUserId: paymentOrder?.operatorUserId ?? null,
    };
  }

  /**
   * 生效后的副作用：失效缓存 → 发放推广奖励（失败只告警）。
   *
   * 新客额度赠送不在这里：它已并入 applyActivationInTx 的事务，
   * 避免订单 paid 后副作用失败却无法自动补发。
   */
  async afterMembershipActivated(
    summary: ActivatedMembershipSummary,
  ): Promise<void> {
    const params = summary;

    await this.cacheInvalidatorService.invalidateMembershipDerived(
      params.storeId,
    );

    if (params.operatorUserId === null) {
      this.logger.warn(
        `[会员支付] 支付单缺少发起人，跳过推广奖励发放 storeId=${params.storeId}`,
      );
      return;
    }

    try {
      await this.promoService.tryAwardPromoReward({
        userId: params.operatorUserId,
        storeId: params.storeId,
        planId: params.planId,
        amount: params.amount,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `推广奖励发放失败（不影响订单，等待启动补偿）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
