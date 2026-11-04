// 团购券订单退款服务：pending / used-未开台 可退；按支付渠道原路退回（微信/储值余额）+ 积分退回 + 库存回补（幂等）
//
// 职责边界：本文件只裁决「能不能退」与「退款发起 + 状态回写」；
// 账目回补（积分 / 库存 / 余额 / 等级）在 club-voucher-order-refund-restore.helper.ts，
// 两条退款链路共用同一份回补逻辑。
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ClubVoucherOrder } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { isBalancePaymentChannel } from '../payments/club-payment-channels.constants';
import { ClubWechatRefundService } from '../payments/club-wechat-refund.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  restorePointsAndStock,
  restoreVoucherBalance,
} from './club-voucher-order-refund-restore.helper';
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

/** 退款落库共用参数：只有文案与拒绝信息在两条链路之间不同 */
interface RefundSettlementOptions {
  /** 微信退款单备注 */
  reason: string;
  /** 成功日志前缀 */
  logLabel: string;
  /** 落库失败日志前缀（此时微信侧可能已出款，必须留痕） */
  failureLabel: string;
  /** 并发抢占失败时抛给前端的既有文案 */
  conflictMessage: string;
  /** 商家拒绝接单时写入的经办人信息 */
  rejectBy?: {
    name: string | null;
    role: 'owner' | 'manager' | 'staff' | null;
  };
}

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
    this.assertRefundable(order);

    await this.settleRefund(order, {
      reason: '用户主动退款',
      logLabel: '团购券退款成功',
      failureLabel: '团购券退款落库失败，微信侧可能已出款，请人工核对',
      conflictMessage: CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
    });

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
    this.assertRefundable(order);

    await this.settleRefund(order, {
      reason: '商家拒绝接单',
      logLabel: '商家拒绝团购券订单成功',
      failureLabel: '商家拒绝接单落库失败，微信侧可能已出款，请人工核对',
      conflictMessage: CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
      rejectBy: {
        name: params.rejectedByStaffName,
        role: params.rejectedByStaffRole,
      },
    });

    return {
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? '',
      status: 'refunded',
      refundAt: this.formatDateTime(new Date()),
      refundAmountFen: order.paidAmountFen,
      rejectedAt: this.formatDateTime(new Date()),
    };
  }

  // ─── 共用的可退校验与落库 ─────────────────────────────────────────────────

  /**
   * 可退状态校验。
   *
   * 过期券不可退：expiresAt 已到但尚未被惰性翻转的单（用户从未打开过列表/详情）同样拒绝，
   * 否则同一张券会「看过详情页就不能退、没看过就能退」，退款资格不确定。
   */
  private assertRefundable(order: ClubVoucherOrder): void {
    // 可退状态：pending（待使用）、used-未开台（已核销但未绑定开台会话）
    if (order.status === 'used' && order.usedSessionId !== null) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE);
    }
    if (order.status !== 'pending' && order.status !== 'used') {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE);
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new BadRequestException(CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE);
    }
  }

  /**
   * 退款/拒单共用链路：发起原路退款 → 状态回写 + 账目回补（同一事务）→ 留痕。
   *
   * ⚠️ 微信退款刻意放在事务之前：事务里做远程调用会拉长持锁时间；代价是
   * 出现「钱已退、订单未变更」的窗口，因此落库失败必须按 refundNo 留痕。
   * 用户重试会命中同一 refundNo，微信侧幂等不再重复出款，可直接把状态补齐。
   */
  private async settleRefund(
    order: ClubVoucherOrder,
    options: RefundSettlementOptions,
  ): Promise<void> {
    // 退款单号由订单号确定性派生（微信 out_refund_no 即幂等键）：并发两笔或失败重试
    // 都复用同一 refundNo，微信侧认定为同一笔退款，不会重复出款。
    const refundNo = this.buildRefundNo(order.orderNo);
    // 原路退回：余额支付退回储值余额，微信支付走微信退款
    const refundByBalance = isBalancePaymentChannel(order.paymentChannel);
    const refundId = refundByBalance
      ? null
      : await this.requestWechatRefund(order, refundNo, options.reason);

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
            ...(options.rejectBy
              ? {
                  rejectedAt: new Date(),
                  rejectedByStaffName: options.rejectBy.name,
                  rejectedByStaffRole: options.rejectBy.role,
                }
              : {}),
          },
        });
        if (updated.count !== 1) {
          // 走到这里时微信退款已被发起（占位在落库之前），必须留痕：出现「钱已退、
          // 订单未变更」时按 refundNo 到微信商户平台核对。
          if (!refundByBalance) {
            this.logger.error(
              `${options.failureLabel}: orderNo=${order.orderNo}, refundNo=${refundNo}`,
            );
          }
          throw new BadRequestException(options.conflictMessage);
        }

        // 积分退回 + 库存回补，余额支付再回补储值余额与累计消费
        await restorePointsAndStock(tx, order);
        if (refundByBalance) {
          await restoreVoucherBalance(tx, order);
        }
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      `${options.logLabel}: orderNo=${order.orderNo}, refundNo=${refundNo}, 金额=${order.paidAmountFen}分, 渠道=${refundByBalance ? 'balance' : 'wechat'}${refundId ? `, 微信退款单=${refundId}` : ''}`,
    );
  }

  /**
   * 发起微信原路退款，返回微信退款单号。
   *
   * 金额口径固定为「全额退回实付」：团购券不支持部分退款，
   * 拆成可配置项只会让「退了但券还能用」这类账实偏差有机会出现。
   */
  private async requestWechatRefund(
    order: ClubVoucherOrder,
    refundNo: string,
    reason: string,
  ): Promise<string> {
    const { refundId } = await this.clubWechatRefundService.requestRefund({
      storeId: order.storeId,
      orderNo: order.orderNo,
      refundNo,
      totalFen: order.paidAmountFen,
      refundFen: order.paidAmountFen,
      reason,
    });
    return refundId;
  }

  // ─── 工具 ─────────────────────────────────────────────────────────────────

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
