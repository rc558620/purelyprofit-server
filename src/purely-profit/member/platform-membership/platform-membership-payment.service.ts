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
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
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
import { DAY_MS } from './platform-membership.constants';
import {
  closeExpiredPendingOrders,
  resolvePendingOrderForReuse,
  sumPendingOccupiedDeductions,
} from './membership-pending-occupancy.shared';
import type { ReusablePendingOrder } from './membership-pending-occupancy.shared';

/** 下单事务内产生的支付草稿（事务外再去换二维码） */
interface MembershipPaymentDraft {
  orderId: number;
  orderNo: string;
  amountFen: number;
  expiresAt: Date;
  /** 幂等命中时已有的二维码，非空则无需重新下单 */
  reusableCodeUrl: string | null;
}

/** 生效完成后交给副作用处理的摘要 */
interface ActivatedMembershipSummary {
  storeId: number;
  planId: PlatformMembershipPlanId;
  amount: number;
  operatorUserId: number | null;
}

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
    const draft = await this.prisma.$transaction(
      async (tx) => {
        const plan = await requirePlan(tx, dto.planId);
        const profile = await ensureMembershipProfile(tx, storeId);
        const partner = await findCurrentStorePartner(tx, storeId);

        // 超时未支付的订单必须先关掉：订单本身没有过期字段，
        // 而额度占用按「未过期待支付单」计算，残留一笔就会永久占住额度
        await closeExpiredPendingOrders(tx, profile.id);

        // 待支付订单已经占用了这部分额度，算价时不能再算成可用，
        // 否则同一批积分 / 纯利豆可以连开多笔待支付订单，
        // 回调第二笔时才发现扣不动 —— 那时钱已经收了
        const occupied = await sumPendingOccupiedDeductions(tx, profile.id);
        const usablePoints = Math.max(
          0,
          profile.availablePoints - occupied.points,
        );
        const usableBeans = Math.max(
          0,
          (partner?.beanBalance ?? 0) - occupied.beans,
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
          availableBeans: usableBeans,
        });

        this.assertDeductionUsable(payment, dto, usableBeans);

        // 幂等：同一份抵扣组合已有未过期的待支付单时直接复用，
        // 避免连点 / 网络重试生成多笔真实支付单（两笔都付款就会重复开通、重复扣减）
        const lookup = await resolvePendingOrderForReuse(tx, profile.id);
        if (lookup.kind === 'paid_awaiting_settlement') {
          // 钱已经收到了，只是权益还没落地：此时再开一张新单等于让用户付第二次
          throw new ConflictException(
            '上一笔会员订单已支付成功，权益正在生效中，请刷新订单状态后再操作',
          );
        }
        if (lookup.kind === 'reusable') {
          const reusable = lookup.order;
          if (!this.isSameComposition(reusable, plan.id, payment)) {
            throw new ConflictException(
              '存在未完成的会员订单，请先完成支付或等待超时后再试',
            );
          }
          if (!reusable.codeUrl) {
            throw new ConflictException('订单正在生成支付二维码，请稍后重试');
          }
          return {
            orderId: reusable.orderId,
            orderNo: reusable.orderNo,
            amountFen: reusable.amountFen,
            expiresAt: reusable.expiresAt,
            reusableCodeUrl: reusable.codeUrl,
          };
        }

        // 先拿支付单号再建订单：paymentOrderId 是唯一键，回调要靠它反查订单
        const paymentOrder = await this.paymentOrderService.createOrder({
          bizType: 'membership',
          storeId,
          operatorUserId: userId,
          amountFen: payment.finalAmount,
          payMode: 'live',
          executor: tx,
        });

        const createdOrder = await tx.storeMembershipOrder.create({
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
          orderId: createdOrder.id,
          orderNo: paymentOrder.orderNo,
          amountFen: payment.finalAmount,
          expiresAt: paymentOrder.expiresAt,
          reusableCodeUrl: null,
        };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    if (draft.reusableCodeUrl) {
      return this.buildLivePaymentResult({
        orderNo: draft.orderNo,
        codeUrl: draft.reusableCodeUrl,
        amountFen: draft.amountFen,
        expiresAt: draft.expiresAt,
      });
    }

    return this.attachNativeCodeUrl(draft, dto.planId);
  }

  /** 待支付订单与本次算价是否为同一份抵扣组合（幂等复用的前提） */
  private isSameComposition(
    reusable: ReusablePendingOrder,
    planId: string,
    payment: ReturnType<typeof calcMemberPlanPayment>,
  ): boolean {
    return (
      reusable.planId === planId &&
      reusable.pointsUsed === payment.actualPointsUsed &&
      reusable.beansUsed === payment.actualBeansUsed &&
      reusable.amountFen === payment.finalAmount
    );
  }

  /** 换取微信二维码并挂到支付单上；下单失败要留下 failed 痕迹而非悬空 pending */
  private async attachNativeCodeUrl(
    draft: MembershipPaymentDraft,
    planId: string,
  ): Promise<Extract<PurchaseMembershipResult, { mode: 'live' }>> {
    // 微信单一旦创建成功，后续任何一步（含二维码出图）失败都必须把它关掉：
    // 微信侧二维码 2 小时有效，只把本地单标 failed 会留下「本地失败、微信仍可支付」的悬空单
    let wechatOrderCreated = false;

    try {
      const { codeUrl } = await this.nativeService.createNativeOrder({
        orderNo: draft.orderNo,
        amountFen: draft.amountFen,
        description: '平台会员订阅',
        notifyUrl: this.getPlatformNotifyUrl(),
        bizType: 'membership',
      });
      wechatOrderCreated = true;

      await this.paymentOrderService.attachCodeUrl(draft.orderNo, codeUrl);

      return await this.buildLivePaymentResult({
        orderNo: draft.orderNo,
        codeUrl,
        amountFen: draft.amountFen,
        expiresAt: draft.expiresAt,
      });
    } catch (error: unknown) {
      if (wechatOrderCreated) {
        // 关单失败只记日志，不能覆盖下面要抛出的原始错误
        await this.paymentOrderService.closeWechatOrderQuietly(
          draft.orderNo,
          'membership',
        );
      }

      // 支付单与会员订单必须同时置失败：只关支付单会让会员订单永久 pending，
      // 进而永久占住该门店的积分 / 纯利豆额度
      await this.markDraftFailed(draft);
      this.logger.error(
        `[会员支付] ${draft.orderNo} 微信下单失败 planId=${planId}`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** 下单失败时把支付单与会员订单一起置失败（清理异常不覆盖原始错误） */
  private async markDraftFailed(draft: MembershipPaymentDraft): Promise<void> {
    try {
      await this.paymentOrderService.markFailed(draft.orderNo);
      await this.prisma.storeMembershipOrder.updateMany({
        where: { id: draft.orderId, status: 'pending' },
        data: { status: 'failed' },
      });
    } catch (cleanupError: unknown) {
      this.logger.error(
        `[会员支付] ${draft.orderNo} 失败清理异常`,
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
      );
    }
  }

  /** 组装真实模式的支付响应（二维码图片按需渲染） */
  private async buildLivePaymentResult(params: {
    orderNo: string;
    codeUrl: string;
    amountFen: number;
    expiresAt: Date;
  }): Promise<Extract<PurchaseMembershipResult, { mode: 'live' }>> {
    return {
      mode: 'live',
      orderNo: params.orderNo,
      codeUrl: params.codeUrl,
      qrCodeImageUrl: await this.qrCodeService.renderPaymentQrCode(
        params.codeUrl,
      ),
      amountFen: params.amountFen,
      expiresAt: params.expiresAt,
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
  private async applyActivationInTx(
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

    return {
      storeId: order.storeId,
      planId: order.planId,
      amount: order.amount,
      operatorUserId: paymentOrder?.operatorUserId ?? null,
    };
  }

  /** 生效后的副作用：失效缓存 → 赠送新客额度 → 发放推广奖励（失败只告警） */
  private async afterMembershipActivated(
    summary: ActivatedMembershipSummary,
  ): Promise<void> {
    const params = summary;

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

  /**
   * 轮询会员支付单状态（超时惰性置 closed）。
   *
   * 必须带上门店归属校验：只凭单号就能查状态会让任意登录用户枚举他人支付单。
   */
  async getMembershipPaymentStatus(params: {
    orderNo: string;
    storeId: number;
  }): Promise<{ status: string; paidAt: Date | null }> {
    const paymentOrder = await this.paymentOrderService.findByOrderNo(
      params.orderNo,
    );
    if (!paymentOrder || paymentOrder.storeId !== params.storeId) {
      throw new NotFoundException('支付单不存在');
    }

    const status = await this.paymentOrderService.getStatus(
      params.orderNo,
      params.storeId,
    );

    if (status.status === 'paid') {
      // 已付款但权益未落地（回调入账失败 / 回调未及时到达）时顺手补生效：
      // 用户停留在支付页轮询期间就能自愈，不必等微信重试耗尽后丢单
      try {
        await this.retryActivateIfPaid(params.orderNo);
      } catch (err: unknown) {
        this.logger.warn(
          `[会员支付] ${params.orderNo} 轮询补生效失败: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return status;
  }

  /**
   * 用户主动放弃支付：关闭微信侧支付单，防止二维码在有效期内被事后扫码付款。
   *
   * 归属校验由支付单服务内部完成（只认本门店的 pending 单）。
   */
  async closeMembershipPaymentOrder(params: {
    orderNo: string;
    storeId: number;
  }): Promise<{ status: string; paidAt: Date | null }> {
    return this.paymentOrderService.closeOrder(params.orderNo, params.storeId);
  }

  /**
   * 补偿：支付单已 paid 但会员权益尚未落地时补生效。
   *
   * 触发点：前端轮询、服务启动扫描。覆盖「回调入账失败（豆 / 积分在支付窗口内
   * 被别处消耗）→ 微信重试耗尽 → 已付款未开通」这一类静默丢单。
   */
  async retryActivateIfPaid(paymentOrderNo: string): Promise<boolean> {
    const paymentOrder =
      await this.paymentOrderService.findByOrderNo(paymentOrderNo);
    if (
      !paymentOrder ||
      paymentOrder.bizType !== 'membership' ||
      paymentOrder.status !== 'paid'
    ) {
      return false;
    }

    const awaiting = await this.prisma.storeMembershipOrder.findFirst({
      where: {
        paymentOrderId: paymentOrderNo,
        status: { in: ['pending', 'failed'] },
      },
      select: { id: true },
    });
    if (!awaiting) {
      return false;
    }

    // 走与回调相同的入账入口：内部会先锁支付单行，避免补偿重试与微信回调并发时
    // 两条链路同时判定「订单还没生效」而重复扣积分 / 纯利豆
    const activated = await this.paymentOrderService.settleWithBusinessWrite(
      paymentOrderNo,
      paymentOrder.transactionId ?? '',
      async (tx) =>
        this.applyActivationInTx(tx, {
          paymentOrderNo,
          amountFen: paymentOrder.amountFen,
        }),
    );

    if (!activated) {
      return false;
    }

    await this.afterMembershipActivated(activated);
    return true;
  }

  /** 启动补偿：扫描近期「已付款但权益未落地」的会员订单并补生效 */
  async backfillPendingPaidOrders(): Promise<void> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const candidates = await this.prisma.storeMembershipOrder.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        paymentOrderId: { not: null },
        createdAt: { gte: since },
      },
      select: { paymentOrderId: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (candidates.length === 0) {
      return;
    }

    let repaired = 0;
    for (const candidate of candidates) {
      if (!candidate.paymentOrderId) {
        continue;
      }
      try {
        const done = await this.retryActivateIfPaid(candidate.paymentOrderId);
        if (done) {
          repaired += 1;
        }
      } catch (err: unknown) {
        this.logger.error(
          `[会员支付] 启动补偿失败 ${candidate.paymentOrderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(
      `[会员支付] 启动补偿扫描 ${candidates.length} 笔待确认订单，补生效 ${repaired} 笔`,
    );
  }

  /** 校验积分 / 纯利豆的可用性（下单时只校验，不扣减） */
  private assertDeductionUsable(
    payment: ReturnType<typeof calcMemberPlanPayment>,
    dto: PurchasePlatformMembershipOrderDto,
    usableBeans: number,
  ): void {
    if ((dto.usePoints ?? 0) > 0 && payment.actualPointsUsed === 0) {
      throw new ConflictException('当前无可抵扣积分');
    }
    if ((dto.useBeans ?? 0) > 0 && payment.actualBeansUsed === 0) {
      throw new ConflictException('当前无可抵扣纯利豆');
    }
    // 真正的扣减发生在生效时；这里只保证「扣掉其它待支付订单占用后」够用，
    // 否则会把同一批纯利豆承诺给两笔订单，第二笔回调时才发现扣不动
    if (payment.actualBeansUsed > usableBeans) {
      throw new ConflictException('纯利豆余额不足，请刷新后重试');
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
