import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { ProfitPaymentModeService } from '../../payments/profit-payment-mode.service';
import { PlatformMembershipActivationService } from './platform-membership-activation.service';
import { PlatformMembershipPaymentService } from './platform-membership-payment.service';

import {
  isRenewalPlanPurchasable,
  SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE,
} from './membership-renewal-policy.shared';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { buildProfileResponse } from './membership-profile.mapper';
import {
  buildOrdersOverview,
  calcMemberPlanPayment,
  calcPreviewResult,
  mapOrder,
} from './platform-membership-ledger.domain';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import {
  PreviewPlatformMembershipOrderDto,
  PurchasePlatformMembershipOrderDto,
} from './dto/platform-membership-query.dto';
import {
  PreviewPlatformMembershipOrderResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from './dto/platform-membership-response.dto';
import {
  ensureMembershipProfile,
  ensurePlatformMembershipStoreOwner,
  findCurrentStorePartner,
  requirePlan,
} from './platform-membership.query';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { NewCustomerQuotaService } from '../new-customer-quota/new-customer-quota.service';
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
const SKIP_PAYMENT_DEDUP_WINDOW_MS = 30 * 1000;

/**
 * 购买会员的结果。
 *
 * 两种模式共用入口，前端按 `mode` 分支：
 * - `test`：权益已生效，直接拿订单与资料（历史行为不变）；
 * - `live`：只返回支付信息，权益要等支付回调生效，前端凭 `orderNo` 轮询。
 */
export type PurchaseMembershipResult =
  | ({ mode: 'test' } & PurchasePlatformMembershipOrderResponseDto)
  | {
      mode: 'live';
      /** 平台支付单号，用于轮询 */
      orderNo: string;
      /** 微信 Native 二维码链接（协议串，不可直接当图片展示） */
      codeUrl: string;
      /** 由 codeUrl 渲染出的 PNG data URL，前端可直接 <img src> 展示 */
      qrCodeImageUrl: string;
      /** 应付金额（分），由后端算价得出 */
      amountFen: number;
      /** 支付单过期时间 */
      expiresAt: Date;
    };

@Injectable()
export class PlatformMembershipOrderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformMembershipOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly promoService: PlatformMembershipPromoService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly quotaService: NewCustomerQuotaService,
    private readonly activationService: PlatformMembershipActivationService,
    private readonly membershipPaymentService: PlatformMembershipPaymentService,
    private readonly configService: ConfigService,
    private readonly paymentModeService: ProfitPaymentModeService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly nativeService: PlatformWechatNativeService,
  ) {}

  /** 服务启动后自动修复历史未充值推广记录（在 Redis 就绪后执行） */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.promoService.backfillUnchargedPromoRecords();
    } catch (err: unknown) {
      this.logger.warn(
        `[promo-init] 历史推广记录修复失败: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 真实模式下的兜底：支付成功但回调入账失败（豆 / 积分被别处消耗）的单子
    // 微信重试耗尽后会永久停在待确认，必须在启动时捞回来补生效
    try {
      await this.membershipPaymentService.backfillPendingPaidOrders();
    } catch (err: unknown) {
      this.logger.warn(
        `[会员支付] 已付款未生效补偿扫描失败: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async previewOrder(
    userId: number,
    storeId: number,
    dto: PreviewPlatformMembershipOrderDto,
  ): Promise<PreviewPlatformMembershipOrderResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const plan = await requirePlan(this.prisma, dto.planId);
    const profile = await ensureMembershipProfile(this.prisma, storeId);
    const partner = await findCurrentStorePartner(this.prisma, storeId);

    // 预览与实际下单必须同口径：待支付订单占用的额度不算可用，
    // 否则预览显示可抵扣、下单时却被拒
    const occupied = await sumPendingOccupiedDeductions(
      this.prisma,
      profile.id,
    );
    const usablePoints = Math.max(
      0,
      profile.availablePoints - occupied.points,
    );
    const usableBeans = Math.max(
      0,
      (partner?.beanBalance ?? 0) - occupied.beans,
    );

    const pricingContext =
      await this.lockedPriceService.loadRenewalPricingContext(storeId);
    this.assertRenewalPlanAllowed(
      dto.planId,
      pricingContext.subAccountFeatureOwned,
    );

    const { price: planPrice } = this.lockedPriceService.resolvePlanPrice({
      plan,
      context: pricingContext,
    });

    const preview = calcPreviewResult({
      planPrice,
      requestedPoints,
      availablePoints: usablePoints,
      requestedBeans,
      availableBeans: usableBeans,
    });

    return {
      planPrice,
      beanDeductAmount: preview.beanDeductAmount,
      actualBeansUsed: preview.actualBeansUsed,
      pointsDeductAmount: preview.pointsDeductAmount,
      actualPointsUsed: preview.actualPointsUsed,
      finalAmount: preview.finalAmount,
      maxBeanDeductAmount: preview.maxBeanDeductAmount,
      maxPointsDeductAmount: preview.maxPointsDeductAmount,
      canUsePoints: preview.canUsePoints,
      canUseBeans: preview.canUseBeans,
    };
  }

  /**
   * 购买会员。
   *
   * 按支付模式分两条路径，但**生效规则只有一份实现**（activationService）：
   * - 测试模式：下单即生效（历史行为不变），同时落一条 paid 的 test 支付单保证对账一致；
   * - 真实模式：先落待支付订单 + 支付单，拿到二维码，等支付回调再生效。
   */
  async purchaseOrder(
    userId: number,
    storeId: number,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchaseMembershipResult> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const skipPayment = await this.paymentModeService.isSkipPaymentAllowed();
    if (!skipPayment) {
      return this.membershipPaymentService.createMembershipPaymentOrder(
        userId,
        storeId,
        dto,
      );
    }

    return this.purchaseWithSkippedPayment(userId, storeId, dto);
  }

  /** 测试模式：与原行为一致，下单即生效 */
  private async purchaseWithSkippedPayment(
    userId: number,
    storeId: number,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<Extract<PurchaseMembershipResult, { mode: 'test' }>> {
    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const response = await this.prisma.$transaction(async (tx) => {
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
        this.logger.warn(
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
      const usablePoints = Math.max(
        0,
        profile.availablePoints - occupied.points,
      );
      const usableBeans = Math.max(0, availableBeans - occupied.beans);

      // 曾开通子账号功能的门店按首购锁定价结算；月 / 季会被直接拒绝，避免误降级
      // （会员到期后实时能力会被归零，故必须用「曾开通」口径，否则到期即可降级）
      const pricingContext =
        await this.lockedPriceService.loadRenewalPricingContext(storeId, tx);
      this.assertRenewalPlanAllowed(
        dto.planId,
        pricingContext.subAccountFeatureOwned,
      );
      const { price: planPrice } = this.lockedPriceService.resolvePlanPrice({
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
      const paymentOrder = await this.paymentOrderService.createOrder({
        bizType: 'membership',
        storeId,
        operatorUserId: userId,
        amountFen: payment.finalAmount,
        payMode: 'test',
        executor: tx,
      });

      // 生效（扣豆 / 更新档期与积分 / 写流水 / 建单）统一走激活服务，
      // 与支付回调路径同源，避免两条路径的权益结果漂移
      const activated = await this.activationService.activate(tx, {
        storeId,
        profileId: profile.id,
        planId: plan.id,
        planPrice,
        actualBeansUsed: payment.actualBeansUsed,
        actualPointsUsed: payment.actualPointsUsed,
        finalAmount: payment.finalAmount,
        paymentOrderId: paymentOrder.orderNo,
        partner: partner
          ? { id: partner.id, beanBalance: availableBeans }
          : null,
        profile: {
          availablePoints: profile.availablePoints,
          totalPoints: profile.totalPoints,
          currentPlanId: profile.currentPlanId,
          startsAt: profile.startsAt,
          expiresAt: profile.expiresAt,
        },
      });

      await this.paymentOrderService.markPaid({
        orderNo: paymentOrder.orderNo,
        transactionId: `manual-test-${paymentOrder.orderNo}`,
        executor: tx,
      });

      // 订单与会员档案都由生效服务直接回传，避免写完再回查一次
      const order = activated.order;
      const updatedProfile = activated.profile;

      // 首次成交价快照：已存在则不覆盖（锁定语义）
      await this.lockedPriceService.lockPriceOnFirstDeal({
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
    });

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

    // 提取内部字段，返回干净的响应
    const { _planId, _amount, ...cleanResponse } = response;

    // 测试模式：权益已生效，带上 mode 让前端知道无需轮询
    const testResult = { mode: 'test' as const, ...cleanResponse };

    // 新用户额度：购买 / 续费成功后按档位一次性叠加（失败只告警，不影响订单结果）
    try {
      await this.quotaService.grantByPlan(storeId, _planId);
    } catch (err: unknown) {
      this.logger.warn(
        `新用户额度赠送失败（不影响订单）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 首次充值推广奖励：必须在订单响应返回前同步完成。
    //
    // 原实现是 void 异步（fire-and-forget），导致前端支付成功后立刻回源拉取
    // 推广中心数据时，后端可能还没发完豆 —— 推广人会短暂看到「未发豆」的旧数据，
    // 必须手动刷新才正常。同步化后响应即代表发豆结果已落库。
    //
    // 失败不阻断订单：订单事务此时已提交、会员权益已生效，
    // 绝不能因发豆失败让已支付的订单报错。仅记录告警，
    // 由 onApplicationBootstrap 的 backfillUnchargedPromoRecords 兜底补发。
    try {
      await this.promoService.tryAwardPromoReward({
        userId,
        storeId,
        planId: _planId,
        amount: _amount,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `推广奖励发放失败（不影响订单，等待启动补偿）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return testResult;
  }

  /**
   * 曾开通子账号功能的门店禁止购买月度 / 季度（否则子账号能力会被配额归零而失效）。
   *
   * 用「曾开通」口径而非实时能力：会员到期后实时能力会被归零，
   * 若按实时能力判断，到期门店可下单降级到月 / 季，直接丢掉子账号与首购锁定价。
   */
  private assertRenewalPlanAllowed(
    planId: PlatformMembershipPlanId,
    subAccountFeatureOwned: boolean,
  ): void {
    if (!isRenewalPlanPurchasable({ planId, subAccountFeatureOwned })) {
      throw new ConflictException(SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE);
    }
  }
}
