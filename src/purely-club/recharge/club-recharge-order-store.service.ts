import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusValue } from '../orders/club-order.types';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';

/** Prisma 唯一约束冲突错误码 */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * 订单已进入终态时前端不会再发起支付，这里给出明确不可用的占位参数，
 * 避免调用方误以为恢复出来的草稿仍可支付。
 */
const buildUnusablePaymentParams = (): ClubWechatPaymentParamsDto => ({
  timeStamp: '',
  nonceStr: '',
  package: '',
  signType: 'RSA',
  paySign: '',
});

const toDateTime = (value: number | null | undefined): Date | null =>
  typeof value === 'number' && Number.isFinite(value) ? new Date(value) : null;

/**
 * 会员充值订单表读写服务。
 *
 * 职责：把充值订单从「只存在 Redis」收敛为「DB 事实源 + Redis 加速层」：
 * - 下单落库，保证订单不会因 Redis 重启 / 淘汰 / 过期而消失；
 * - 落账以订单表的条件更新作为幂等闸门，挡住重复回调导致的重复加余额；
 * - Redis 草稿丢失时可按订单号还原出等价草稿，让查单与回调继续可用。
 */
@Injectable()
export class ClubRechargeOrderStoreService {
  private readonly logger = new Logger(ClubRechargeOrderStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 下单成功后写入待支付订单记录。
   * 与 Redis 草稿使用同一个订单号（微信 out_trade_no）。
   */
  async createPendingRecord(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): Promise<void> {
    try {
      await this.prisma.clubRechargeOrder.create({
        data: {
          orderNo: draft.orderNo,
          storeId: draft.storeId,
          userId: draft.userId,
          customerId: draft.customerId,
          packageId: draft.metadata.packageId,
          promotionId: draft.metadata.promotionId,
          amountFen: draft.amountFen,
          customAmountFen: draft.metadata.customAmountFen,
          bonusAmountFen: draft.metadata.bonusAmountFen,
          paymentChannel: draft.paymentChannel,
          status: 'pending',
          expiresAt: new Date(draft.expiresAtMs),
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('订单已存在，请勿重复提交');
      }
      throw error;
    }
  }

  /**
   * 在事务内抢占「该订单已支付」这一事实，是充值落账的幂等闸门。
   *
   * @returns true 表示本次抢占成功、调用方应继续落账；false 表示订单此前已落账，
   *          调用方必须跳过余额与流水写入，避免重复到账。
   */
  async claimPaid(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    meta?: ClubOrderPaidObservationOptions,
  ): Promise<boolean> {
    const existing = await tx.clubRechargeOrder.findUnique({
      where: { orderNo: draft.orderNo },
      select: { status: true },
    });

    // 订单表缺失（历史单或写入异常）：按草稿快照补建并直接标记已支付。
    // 宁可补单也不能吞掉用户已经真实完成的付款。
    if (!existing) {
      this.logger.warn(
        `充值订单 ${draft.orderNo} 在订单表中缺失，按草稿快照补建后落账`,
      );
      await tx.clubRechargeOrder.create({
        data: {
          orderNo: draft.orderNo,
          storeId: draft.storeId,
          userId: draft.userId,
          customerId: draft.customerId,
          packageId: draft.metadata.packageId,
          promotionId: draft.metadata.promotionId,
          amountFen: draft.amountFen,
          customAmountFen: draft.metadata.customAmountFen,
          bonusAmountFen: draft.metadata.bonusAmountFen,
          paymentChannel: draft.paymentChannel,
          status: 'paid',
          transactionId: meta?.paymentTransactionId ?? null,
          paymentConfirmationSource: meta?.paymentConfirmationSource ?? null,
          expiresAt: new Date(draft.expiresAtMs),
          paidAt: toDateTime(meta?.paidAtMs) ?? new Date(),
          callbackReceivedAt: toDateTime(meta?.callbackReceivedAtMs),
        },
      });
      return true;
    }

    if (existing.status === 'paid') {
      this.logger.warn(
        `充值订单 ${draft.orderNo} 已落账，忽略本次重复支付确认`,
      );
      return false;
    }

    const updated = await tx.clubRechargeOrder.updateMany({
      where: { orderNo: draft.orderNo, status: { not: 'paid' } },
      data: {
        status: 'paid',
        // 已有值优先，防止重复回调覆盖首次回调的精确流水信息
        transactionId: meta?.paymentTransactionId ?? undefined,
        paymentConfirmationSource: meta?.paymentConfirmationSource ?? undefined,
        paidAt: toDateTime(meta?.paidAtMs) ?? new Date(),
        callbackReceivedAt: toDateTime(meta?.callbackReceivedAtMs),
      },
    });

    return updated.count > 0;
  }

  /**
   * 按订单号还原等价的 Redis 草稿，用于 Redis 草稿丢失（重启 / 淘汰 / 过期）后的
   * 查单与回调兜底。查不到返回 null，由调用方按原逻辑抛订单不存在。
   */
  async findDraftSnapshot(
    orderNo: string,
  ): Promise<ClubOrderDraftPayload<
    ClubRechargeOrderMetadata,
    'recharge'
  > | null> {
    const order = await this.prisma.clubRechargeOrder.findUnique({
      where: { orderNo },
    });

    if (!order) {
      return null;
    }

    const [store, user] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: order.storeId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: order.userId },
        select: { wechatPhone: true },
      }),
    ]);

    const status = order.status as ClubOrderStatusValue;

    return {
      id: order.orderNo,
      orderNo: order.orderNo,
      orderType: 'recharge',
      status,
      storeId: order.storeId,
      storeName: store?.name ?? '',
      userId: order.userId,
      phone: user?.wechatPhone ?? '',
      customerId: order.customerId,
      title: '会员充值',
      amountFen: order.amountFen,
      paymentChannel: 'wechat',
      createdAtMs: order.createdAt.getTime(),
      expiresAtMs: order.expiresAt.getTime(),
      paidAtMs: order.paidAt ? order.paidAt.getTime() : null,
      paymentTransactionId: order.transactionId,
      callbackReceivedAtMs: order.callbackReceivedAt
        ? order.callbackReceivedAt.getTime()
        : null,
      paymentConfirmationSource: this.toConfirmationSource(
        order.paymentConfirmationSource,
      ),
      failureReason: status === 'expired' ? '订单超时未支付，已自动关闭' : null,
      paymentParams: buildUnusablePaymentParams(),
      metadata: {
        packageId: order.packageId,
        promotionId: order.promotionId,
        rechargeAmountFen: order.amountFen,
        bonusAmountFen: order.bonusAmountFen,
        customAmountFen: order.customAmountFen,
      },
    };
  }

  private toConfirmationSource(
    value: string | null,
  ): 'wechat_callback' | 'manual_confirm_paid' | null {
    if (value === 'wechat_callback' || value === 'manual_confirm_paid') {
      return value;
    }
    return null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
    );
  }
}
