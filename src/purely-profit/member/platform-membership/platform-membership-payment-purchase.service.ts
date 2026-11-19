// 平台会员真实支付的下单编排：算价 → 幂等复用 → 落待支付订单 → 换微信二维码
//
// 从 platform-membership-payment.service.ts 拆出：下单是一段完整的事务编排，
// 与「回调生效 / 补偿自愈」的生命周期完全不同，混在一个文件里会远超 400 行。
//
// 生效规则本身不在这里：扣豆、更新档期、写流水统一由
// PlatformMembershipActivationService 负责，两条购买路径共用同一份实现。
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { PlatformPaymentQrCodeService } from '../../payments/platform-payment-qrcode.service';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { assertRenewalPlanPurchasable } from './membership-renewal-policy.shared';
import { calcMemberPlanPayment } from './platform-membership-ledger.domain';
import {
  ensureMembershipProfile,
  findCurrentStorePartner,
  requirePlan,
} from './platform-membership.query';
import type { PurchaseMembershipResult } from './platform-membership-order.service';
import type { PurchasePlatformMembershipOrderDto } from './dto/platform-membership-query.dto';
import {
  closeExpiredPendingOrders,
  lockStorePartnerBeanBalance,
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

@Injectable()
export class PlatformMembershipPaymentPurchaseService {
  private readonly logger = new Logger(
    PlatformMembershipPaymentPurchaseService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly nativeService: PlatformWechatNativeService,
    private readonly qrCodeService: PlatformPaymentQrCodeService,
  ) {}

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

        // 与提现申请抢同一把合伙人余额行锁：下单只算占用不扣豆，
        // 不加锁时提现会把「已被待支付订单承诺出去」的豆提走，
        // 回调生效时才发现扣不动（钱已收、权益无法落地）
        if (partner) {
          await lockStorePartnerBeanBalance(tx, partner.id);
        }

        // 超时未支付的订单必须先关掉：订单本身没有过期字段，
        // 而额度占用按「未过期待支付单」计算，残留一笔就会永久占住额度
        await closeExpiredPendingOrders(tx, profile.id);

        // 幂等复用必须先于算价：原单已把额度占满时，按「扣除占用后的可用额度」
        // 算价会得到 0，重试不但拿不回原二维码，还会误报「无可抵扣」。
        const lookup = await resolvePendingOrderForReuse(tx, profile.id);
        if (lookup.kind === 'paid_awaiting_settlement') {
          // 钱已经收到了，只是权益还没落地：此时再开一张新单等于让用户付第二次
          throw new ConflictException(
            '上一笔会员订单已支付成功，权益正在生效中，请刷新订单状态后再操作',
          );
        }
        if (
          lookup.kind === 'reusable' &&
          this.matchesRequest(lookup.order, plan.id, dto)
        ) {
          const reusable = lookup.order;
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

        if (lookup.kind === 'reusable') {
          // 同一张待支付单存在但抵扣组合与本次请求不同：不能另开新单，
          // 也不能把旧单改成新组合（微信侧金额已经下过单）
          throw new ConflictException(
            '存在未完成的会员订单，请先完成支付或等待超时后再试',
          );
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

  /**
   * 待支付订单是否就是本次请求的同一份抵扣组合（幂等复用的前提）。
   *
   * 必须用「请求值」而不是「重新算价的结果」比较：原单已经把额度占满后，
   * 可用余额会被算成 0，用算价结果比较永远不会相等，重试就拿不回原二维码。
   */
  private matchesRequest(
    reusable: ReusablePendingOrder,
    planId: string,
    dto: PurchasePlatformMembershipOrderDto,
  ): boolean {
    return (
      reusable.planId === planId &&
      reusable.pointsUsed === (dto.usePoints ?? 0) &&
      reusable.beansUsed === (dto.useBeans ?? 0)
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
