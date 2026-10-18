// 团购券订单退款服务：pending / used-未开台 可退；按支付渠道原路退回（微信/储值余额）+ 积分退回 + 库存回补（幂等）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { queryCustomerTierThresholds } from '../../purely-profit/marketing/marketing.query';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { ClubWechatRefundService } from '../payments/club-wechat-refund.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE,
  CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
  CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
} from './club-voucher-orders.constants';

/** 退款结果 */
export interface ClubVoucherRefundResult {
  orderNo: string;
  status: 'refunded';
  refundAt: string;
  refundAmountFen: number;
}

/** 商家端拒绝结果（与退款同链路，额外携带拒绝时间与券码） */
export interface ClubVoucherMerchantRejectResult {
  orderNo: string;
  /** 团购券码（广播 status_changed 事件使用） */
  voucherCode: string;
  status: 'refunded';
  refundAt: string;
  refundAmountFen: number;
  rejectedAt: string;
}

/** 退款/拒绝回补所需订单字段 */
type RefundRestoreOrder = {
  id: number;
  /** 业务订单号（异常留痕用） */
  orderNo: string;
  storeId: number;
  customerId: number | null;
  productId: number;
  productName: string;
  pointsUsed: number;
  quantity: number;
  /** 实付金额（分）；余额支付退款时原路退回该金额 */
  paidAmountFen: number;
  /** 结算时赠送的积分个数快照（退款时按此回收） */
  pointsAwarded: number;
};

@Injectable()
export class ClubVoucherOrderRefundService {
  private readonly logger = new Logger(ClubVoucherOrderRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubWechatRefundService: ClubWechatRefundService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /** 用户端退款：pending / used-未开台 可退；used-已开台 禁止；幂等（已退款直接返回） */
  async refundVoucherOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherRefundResult> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId: currentContext.user.id },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }

    // 幂等：已退款直接返回
    if (order.status === 'refunded') {
      return {
        orderNo: order.orderNo,
        status: 'refunded',
        refundAt: this.formatDateTime(order.refundAt ?? new Date()),
        refundAmountFen: order.refundAmountFen ?? order.paidAmountFen,
      };
    }
    // 可退状态：pending（待使用）、used-未开台（已核销但未绑定开台会话）
    if (order.status === 'used' && order.usedSessionId !== null) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE);
    }
    if (order.status !== 'pending' && order.status !== 'used') {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE);
    }
    // 过期校验：expiresAt 已到但尚未被惰性翻转的单（用户从未打开过列表/详情）不能退，
    // 否则同一张券会「看过详情页就不能退、没看过就能退」，退款资格不确定。
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE);
    }

    // 退款单号由订单号确定性派生（微信 out_refund_no 即幂等键）：并发两笔或失败重试
    // 都复用同一 refundNo，微信侧认定为同一笔退款，不会重复出款。
    const refundNo = this.buildRefundNo(order.orderNo);
    // 原路退回：余额支付退回储值余额，微信支付走微信退款
    const refundByBalance = order.paymentChannel === 'balance';

    // 微信支付订单先发起微信退款（幂等键 refundNo；开发态降级直接成功）
    const refundId = refundByBalance
      ? null
      : (
          await this.clubWechatRefundService.requestRefund({
            storeId: order.storeId,
            orderNo: order.orderNo,
            refundNo,
            totalFen: order.paidAmountFen,
            refundFen: order.paidAmountFen,
            reason: '用户主动退款',
          })
        ).refundId;

    // 落库：置 refunded + 退款信息 + 积分退回 + 库存回补（同一事务）
    await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.clubVoucherOrder.updateMany({
          where: {
            id: order.id,
            status: { in: ['pending', 'used'] },
            usedSessionId: null,
          },
          data: {
            status: 'refunded',
            refundAt: new Date(),
            refundAmountFen: order.paidAmountFen,
            refundChannel: refundByBalance ? 'balance' : 'wechat',
            refundNo,
          },
        });
        if (updated.count !== 1) {
          // 走到这里时微信退款已被发起（占位在落库之前），必须留痕：出现「钱已退、
          // 订单未变更」时按 refundNo 到微信商户平台核对。用户重试会命中同一 refundNo，
          // 微信侧幂等不再重复出款，可直接把状态补齐。
          if (!refundByBalance) {
            this.logger.error(
              `团购券退款落库失败，微信侧可能已出款，请人工核对: orderNo=${order.orderNo}, refundNo=${refundNo}`,
            );
          }
          throw new BadRequestException(
            CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
          );
        }
        // 积分退回：实际扣减的积分回补到顾客积分账户，并记录流水（与扣减时 spend 流水对称，保证可审计）
        // 库存回补：释放占用的商品库存
        await this.restorePointsAndStock(tx, order);
        // 余额退回：储值余额回补 + 累计消费回退（与余额支付结算对称）
        if (refundByBalance) {
          await this.restoreBalance(tx, order);
        }
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      `团购券退款成功: orderNo=${order.orderNo}, refundNo=${refundNo}, 金额=${order.paidAmountFen}分, 渠道=${refundByBalance ? 'balance' : 'wechat'}${refundId ? `, 微信退款单=${refundId}` : ''}`,
    );
    // 事务提交成功后才广播退款事件：store 房间（商家端查看订单页实时刷新）+ voucher-order 房间与 native 订阅者（purelyClub 详情页）
    this.realtimeService.publishVoucherOrderStatusChanged({
      storeId: order.storeId,
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? '',
      status: 'refunded',
      refundAt: new Date().toISOString(),
    });
    return {
      orderNo: order.orderNo,
      status: 'refunded',
      refundAt: this.formatDateTime(new Date()),
      refundAmountFen: order.paidAmountFen,
    };
  }

  /**
   * 商家端拒绝接单：pending（无论是否已确认）与 used-未开台（已核销未绑定开台会话）可拒；
   * 微信原路退回 + 积分返还 + 库存回补 + 记录拒绝信息（幂等：已退款直接返回）。
   */
  async rejectVoucherOrderByMerchant(params: {
    storeId: number;
    orderNo: string;
    rejectedByStaffName: string | null;
    rejectedByStaffRole: 'owner' | 'manager' | 'staff' | null;
  }): Promise<ClubVoucherMerchantRejectResult> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo: params.orderNo, storeId: params.storeId },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }

    // 幂等：已退款直接返回
    if (order.status === 'refunded') {
      return {
        orderNo: order.orderNo,
        voucherCode: order.voucherCode ?? '',
        status: 'refunded',
        refundAt: this.formatDateTime(order.refundAt ?? new Date()),
        refundAmountFen: order.refundAmountFen ?? order.paidAmountFen,
        rejectedAt: this.formatDateTime(order.rejectedAt ?? new Date()),
      };
    }
    // 可拒状态：pending、used-未开台（已核销但未绑定开台会话）
    if (order.status === 'used' && order.usedSessionId !== null) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE);
    }
    if (order.status !== 'pending' && order.status !== 'used') {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE);
    }
    // 过期校验：与用户端退款同一口径（过期券不可再退款）
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE);
    }

    const refundNo = this.buildRefundNo(order.orderNo);
    // 原路退回：余额支付退回储值余额，微信支付走微信退款
    const refundByBalance = order.paymentChannel === 'balance';

    // 微信支付订单先发起微信退款（幂等键 refundNo；开发态降级直接成功）
    const refundId = refundByBalance
      ? null
      : (
          await this.clubWechatRefundService.requestRefund({
            storeId: order.storeId,
            orderNo: order.orderNo,
            refundNo,
            totalFen: order.paidAmountFen,
            refundFen: order.paidAmountFen,
            reason: '商家拒绝接单',
          })
        ).refundId;

    // 落库：置 refunded + 拒绝信息 + 积分退回 + 库存回补（同一事务）
    await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.clubVoucherOrder.updateMany({
          where: {
            id: order.id,
            status: { in: ['pending', 'used'] },
            usedSessionId: null,
          },
          data: {
            status: 'refunded',
            refundAt: new Date(),
            refundAmountFen: order.paidAmountFen,
            refundChannel: refundByBalance ? 'balance' : 'wechat',
            refundNo,
            rejectedAt: new Date(),
            rejectedByStaffName: params.rejectedByStaffName,
            rejectedByStaffRole: params.rejectedByStaffRole,
          },
        });
        if (updated.count !== 1) {
          if (!refundByBalance) {
            this.logger.error(
              `商家拒绝接单落库失败，微信侧可能已出款，请人工核对: orderNo=${order.orderNo}, refundNo=${refundNo}`,
            );
          }
          throw new BadRequestException(
            CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
          );
        }
        await this.restorePointsAndStock(tx, order);
        // 余额退回：储值余额回补 + 累计消费回退（与余额支付结算对称）
        if (refundByBalance) {
          await this.restoreBalance(tx, order);
        }
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      `商家拒绝团购券订单成功: orderNo=${order.orderNo}, refundNo=${refundNo}, 金额=${order.paidAmountFen}分, 渠道=${refundByBalance ? 'balance' : 'wechat'}${refundId ? `, 微信退款单=${refundId}` : ''}`,
    );
    return {
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? '',
      status: 'refunded',
      refundAt: this.formatDateTime(new Date()),
      refundAmountFen: order.paidAmountFen,
      rejectedAt: this.formatDateTime(new Date()),
    };
  }

  /** 积分退回 + 库存回补（退款与商家拒绝共用，保证两侧链路一致） */
  private async restorePointsAndStock(
    tx: Prisma.TransactionClient,
    order: RefundRestoreOrder,
  ): Promise<void> {
    // 积分退回：实际扣减的积分回补到顾客积分账户，并记录流水（与扣减时 spend 流水对称，保证可审计）
    if (order.pointsUsed > 0 && order.customerId !== null) {
      await tx.marketingCustomer.update({
        where: { id: order.customerId },
        data: { points: { increment: order.pointsUsed } },
      });
      await tx.marketingPointsRecord.create({
        data: {
          storeId: order.storeId,
          customerId: order.customerId,
          amount: order.pointsUsed,
          type: 'earn' as const,
          description: `团购券退款返还积分（${order.productName}）`,
        },
      });
    }
    // 库存回补
    await tx.marketingProduct.update({
      where: { id: order.productId },
      data: { stock: { increment: order.quantity } },
    });
  }

  /**
   * 余额退回：储值余额回补 + 累计消费/到店次数回退 + 回收结算时赠送的积分 + 等级重算，
   * 与 settleVoucherBalancePayment 完全对称。
   *
   * 说明：lastVisitAt 不回退。它是「最近一次消费发生的时间」这一既成事实记录，
   * 而 totalSpent / visitCount / 积分属于账目额度，取消消费后必须账面回滚。
   */
  private async restoreBalance(
    tx: Prisma.TransactionClient,
    order: RefundRestoreOrder,
  ): Promise<void> {
    if (order.customerId === null || order.paidAmountFen <= 0) return;

    const customer = await tx.marketingCustomer.findFirst({
      where: { id: order.customerId, storeId: order.storeId, deletedAt: null },
      select: { id: true, totalSpent: true, visitCount: true, points: true },
    });
    if (!customer) return;

    // 回收结算时赠送的积分（与 awardPointsForSettlement 对称）。
    // 顾客可能已把赠送的积分花掉，此时按「现有积分」为上限回收，绝不扣成负数，差额留痕跟进。
    if (order.pointsAwarded > 0) {
      const refundablePoints = Math.min(order.pointsAwarded, customer.points);
      if (refundablePoints > 0) {
        const deducted = await tx.marketingCustomer.updateMany({
          where: { id: customer.id, points: { gte: refundablePoints } },
          data: { points: { decrement: refundablePoints } },
        });
        if (deducted.count === 1) {
          await tx.marketingPointsRecord.create({
            data: {
              storeId: order.storeId,
              customerId: customer.id,
              amount: -refundablePoints,
              type: 'spend' as const,
              description: `团购券退款回收赠送积分（${order.productName}）`,
            },
          });
        }
      }
      if (refundablePoints < order.pointsAwarded) {
        this.logger.error(
          `团购券退款赠送积分未能足额回收（顾客积分已被使用），请人工核对: ` +
            `orderNo=${order.orderNo}, customerId=${customer.id}, 应回收=${order.pointsAwarded}, 实回收=${refundablePoints}`,
        );
      }
    }

    // totalSpent / visitCount 用绝对赋值避免历史数据异常导致负数；
    // visitCount 与结算时 increment: 1 对称回退——本笔消费既已取消，累计次数必须回滚，
    // 否则会与已回退的 totalSpent 形成账实偏差（次数虚高、等级门槛失真）。
    const newTotalSpent = Math.max(
      customer.totalSpent - order.paidAmountFen,
      0,
    );
    const newVisitCount = Math.max(customer.visitCount - 1, 0);
    // 与消费落账同源：读门店会员等级设置的可配置阈值
    const thresholds = await queryCustomerTierThresholds(tx, order.storeId);
    await tx.marketingCustomer.update({
      where: { id: customer.id },
      data: {
        balance: { increment: order.paidAmountFen },
        totalSpent: newTotalSpent,
        visitCount: newVisitCount,
        tier: calcCustomerTier(newTotalSpent, thresholds) as never,
      },
    });
  }

  /**
   * 生成退款单号：RF + 订单号（微信 out_refund_no，同一订单恒定不变）。
   * 必须由订单号确定性派生——随机值会让并发的两笔退款或失败重试在微信侧被当成多笔
   * 不同退款：只有一笔能落到 DB，其余要么重复出款，要么「钱已退而订单状态未变更」。
   */
  private buildRefundNo(orderNo: string): string {
    return `RF${orderNo.replace(/[^A-Za-z0-9_-]/g, '')}`;
  }

  private formatDateTime(date: Date): string {
    const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return [
      shanghai.getUTCFullYear(),
      '-',
      pad(shanghai.getUTCMonth() + 1),
      '-',
      pad(shanghai.getUTCDate()),
      ' ',
      pad(shanghai.getUTCHours()),
      ':',
      pad(shanghai.getUTCMinutes()),
    ].join('');
  }
}

/** 导出类型供测试使用 */
export type VoucherRefundTx = Prisma.TransactionClient;
