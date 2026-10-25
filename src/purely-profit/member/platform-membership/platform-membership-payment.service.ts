// 平台会员的真实支付编排：下单换码 / 回调生效 / 状态轮询
//
// 从 PlatformMembershipOrderService 拆出来的原因：接入真实支付后这里多了
// 「下单 → 二维码 → 回调 → 生效」一整套编排，与「算价 + 测试模式直接生效」
// 混在一个文件里会让该文件远超 400 行，且两条链路的生命周期完全不同。
//
// 生效规则本身不在这里：扣豆、更新档期、写流水统一由
// PlatformMembershipActivationService 负责，两条路径共用同一份实现。
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { PlatformPaymentQrCodeService } from '../../payments/platform-payment-qrcode.service';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { assertRenewalPlanPurchasable } from './membership-renewal-policy.shared';
import { PlatformMembershipActivationService } from './platform-membership-activation.service';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { calcMemberPlanPayment } from './platform-membership-ledger.domain';
import {
  ensureMembershipProfile,
  findCurrentStorePartner,
  requirePlan,
} from './platform-membership.query';
import type { PurchaseMembershipResult } from './platform-membership-order.service';
import type { PrismaExecutor } from './platform-membership.types';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type { PurchasePlatformMembershipOrderDto } from './dto/platform-membership-query.dto';
import { NewCustomerQuotaService } from '../new-customer-quota/new-customer-quota.service';

@Injectable()
export class PlatformMembershipPaymentService {
  private readonly logger = new Logger(PlatformMembershipPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly activationService: PlatformMembershipActivationService,
    private readonly promoService: PlatformMembershipPromoService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly nativeService: PlatformWechatNativeService,
    private readonly qrCodeService: PlatformPaymentQrCodeService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}
  /** 支付单号 → 会员订单 ID 的反查（回调生效时使用） */
  async findOrderIdByPaymentOrderNo(
    paymentOrderNo: string,
  ): Promise<{ orderId: number; storeId: number; amountFen: number } | null> {
    const order = await this.prisma.storeMembershipOrder.findFirst({
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
   * 真实模式购买：只落待支付订单与支付单，权益等支付回调再生效。
   *
   * 积分与纯利豆在**这一刻不扣**（只在下单时校验可用额度）：
   * 一旦下单即扣，支付失败或超时就需要补一套回滚，而回滚与并发重试叠加
   * 极易出现「扣了没退 / 退了又扣」。放在回调里扣则天然幂等——
   * 支付单保证生效只会执行一次。
   */
  async createMembershipPaymentOrder(
    userId: number,
    storeId: number,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<Extract<PurchaseMembershipResult, { mode: 'live' }>> {
    const draft = await this.prisma.$transaction(async (tx) => {
      const plan = await requirePlan(tx, dto.planId);
      const profile = await ensureMembershipProfile(tx, storeId);
      const partner = await findCurrentStorePartner(tx, storeId);
      const availableBeans = partner?.beanBalance ?? 0;
      // 待支付订单已经占用了这部分积分，算价时不能再算成可用，
      // 否则同一批积分可以连开多笔待支付订单，回调第二笔时才发现扣不动
      const occupiedPoints = await this.sumPendingOccupiedPoints(
        tx,
        profile.id,
      );
      const usablePoints = Math.max(
        0,
        profile.availablePoints - occupiedPoints,
      );

      const pricingContext =
        await this.lockedPriceService.loadRenewalPricingContext(storeId, tx);
      assertRenewalPlanPurchasable({
        planId: dto.planId,
        subAccountFeatureOwned: pricingContext.subAccountFeatureOwned,
        throwWith: (message) => {
          throw new ConflictException(message);
        },
      });
      const { price: planPrice } = this.lockedPriceService.resolvePlanPrice({
        plan,
        context: pricingContext,
      });

      const payment = calcMemberPlanPayment({
        planPrice,
        requestedPoints: dto.usePoints ?? 0,
        availablePoints: usablePoints,
        requestedBeans: dto.useBeans ?? 0,
        availableBeans,
      });

      this.assertDeductionUsable(payment, dto, partner, {
        availablePoints: usablePoints,
      });

      // 先拿支付单号再建订单：paymentOrderId 是唯一键，回调要靠它反查订单
      const paymentOrder = await this.paymentOrderService.createOrder({
        bizType: 'membership',
        storeId,
        operatorUserId: userId,
        amountFen: payment.finalAmount,
        payMode: 'live',
        executor: tx,
      });

      await tx.storeMembershipOrder.create({
        data: {
          storeId,
          profileId: profile.id,
          planId: plan.id,
          planName: plan.name,
          originalAmount: planPrice,
          pointsUsed: payment.actualPointsUsed,
          beansUsed: payment.actualBeansUsed,
          amount: payment.finalAmount,
          status: 'pending',
          paymentChannel: 'wechat',
          paymentOrderId: paymentOrder.orderNo,
        },
        select: { id: true },
      });

      return {
        orderNo: paymentOrder.orderNo,
        amountFen: payment.finalAmount,
        expiresAt: paymentOrder.expiresAt,
      };
    });

    return this.attachNativeCodeUrl(draft, dto.planId);
  }

  /** 换取微信二维码并挂到支付单上；下单失败要留下 failed 痕迹而非悬空 pending */
  private async attachNativeCodeUrl(
    draft: { orderNo: string; amountFen: number; expiresAt: Date },
    planId: string,
  ): Promise<Extract<PurchaseMembershipResult, { mode: 'live' }>> {
    try {
      const { codeUrl } = await this.nativeService.createNativeOrder({
        orderNo: draft.orderNo,
        amountFen: draft.amountFen,
        description: '平台会员订阅',
        notifyUrl: this.getPlatformNotifyUrl(),
      });

      await this.paymentOrderService.attachCodeUrl(draft.orderNo, codeUrl);

      return {
        mode: 'live',
        orderNo: draft.orderNo,
        codeUrl,
        qrCodeImageUrl: await this.qrCodeService.renderPaymentQrCode(codeUrl),
        amountFen: draft.amountFen,
        expiresAt: draft.expiresAt,
      };
    } catch (error: unknown) {
      await this.paymentOrderService.markFailed(draft.orderNo);
      this.logger.error(
        `[会员支付] ${draft.orderNo} 微信下单失败 planId=${planId}`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
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
    const orderId = await this.findOrderIdByPaymentOrderNo(
      params.paymentOrderNo,
    );
    if (!orderId) {
      throw new ConflictException('支付单对应的会员订单不存在');
    }

    const settled = await this.paymentOrderService.settleWithBusinessWrite(
      params.paymentOrderNo,
      params.transactionId,
      async (tx) => {
        const order = await tx.storeMembershipOrder.findUnique({
          where: { id: orderId.orderId },
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

        return {
          ...order,
          operatorUserId: paymentOrder?.operatorUserId ?? null,
        };
      },
    );

    // 已处理过（重复回调）或金额校验失败都不会走到这里
    if (!settled) {
      return;
    }

    await this.afterMembershipActivated({
      userId: settled.operatorUserId,
      storeId: settled.storeId,
      planId: settled.planId,
      amount: settled.amount,
    });
  }

  /** 生效后的副作用：失效缓存 → 赠送新客额度 → 发放推广奖励（失败只告警） */
  private async afterMembershipActivated(params: {
    /** 支付单上的发起人；缺失时无法确定归属人，跳过推广奖励而不是猜 */
    userId: number | null;
    storeId: number;
    planId: PlatformMembershipPlanId;
    amount: number;
  }): Promise<void> {
    await this.cacheInvalidatorService.invalidateMembershipDerived(
      params.storeId,
    );

    try {
      await this.quotaService.grantByPlan(params.storeId, params.planId);
    } catch (err: unknown) {
      // 额度赠送失败不阻断已生效的订单：会员权益已落库，只告警
      this.logger.warn(
        `新用户额度赠送失败（不影响订单）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (params.userId === null) {
      this.logger.warn(
        `[会员支付] 支付单缺少发起人，跳过推广奖励发放 storeId=${params.storeId}`,
      );
      return;
    }

    try {
      await this.promoService.tryAwardPromoReward({
        userId: params.userId,
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

  /** 轮询会员支付单状态（超时惰性置 closed） */
  async getMembershipPaymentStatus(
    orderNo: string,
  ): Promise<{ status: string; paidAt: Date | null }> {
    return this.paymentOrderService.getStatus(orderNo);
  }

  /**
   * 待支付订单已占用的积分合计。
   *
   * 真实模式下下单不预扣积分（避免为未支付的单子先扣一笔），
   * 因此必须在算价时把 pending 订单占用的额度扣掉，否则可重复透支。
   */
  private async sumPendingOccupiedPoints(
    tx: PrismaExecutor,
    profileId: number,
  ): Promise<number> {
    const result = await tx.storeMembershipOrder.aggregate({
      where: { profileId, status: 'pending' },
      _sum: { pointsUsed: true },
    });
    return result._sum.pointsUsed ?? 0;
  }

  /** 校验积分 / 纯利豆的可用性（下单时只校验，不扣减） */
  private assertDeductionUsable(
    payment: ReturnType<typeof calcMemberPlanPayment>,
    dto: PurchasePlatformMembershipOrderDto,
    partner: { beanBalance: number } | null,
    profile: { availablePoints: number },
  ): void {
    if ((dto.usePoints ?? 0) > 0 && payment.actualPointsUsed === 0) {
      throw new ConflictException('当前无可抵扣积分');
    }
    if ((dto.useBeans ?? 0) > 0 && payment.actualBeansUsed === 0) {
      throw new ConflictException('当前无可抵扣纯利豆');
    }
    // 只校验余额：真正的扣减发生在生效时，避免为「未支付的购买」先扣一笔
    if (
      payment.actualBeansUsed > 0 &&
      (!partner || partner.beanBalance < payment.actualBeansUsed)
    ) {
      throw new ConflictException('纯利豆余额不足，请刷新后重试');
    }
    if (payment.actualPointsUsed > profile.availablePoints) {
      throw new ConflictException('积分余额不足，请刷新后重试');
    }
  }

  /** 平台收款统一回调地址（缺失时不回落其它链路地址） */
  private getPlatformNotifyUrl(): string {
    const configured = this.configService
      .get<string>('profit.wechatPayNotifyUrl')
      ?.trim();
    if (configured) {
      return configured;
    }
    throw new InternalServerErrorException(
      '环境变量 PROFIT_WECHAT_PAY_NOTIFY_URL 未配置，无法发起平台收款',
    );
  }
}
