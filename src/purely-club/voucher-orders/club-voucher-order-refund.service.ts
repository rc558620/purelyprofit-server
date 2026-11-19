// 团购券订单退款服务：pending / used-未开台 可退；按支付渠道原路退回（微信/储值余额）+ 积分退回 + 库存回补（幂等）
//
// 职责边界：本文件只裁决「能不能退」与「退款编排（占位 → 出款 → 终态）」；
// 事务落库在 club-voucher-order-refund-settlement.helper.ts，
// 账目回补（积分 / 库存 / 余额 / 等级）在 club-voucher-order-refund-restore.helper.ts。
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  CLUB_VOUCHER_ERROR_CODE,
  clubVoucherError,
  type ClubVoucherErrorPayload,
} from './club-voucher-orders.errors';
import type { ClubVoucherOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isBalancePaymentChannel } from '../payments/club-payment-channels.constants';
import { formatShanghaiDateTime } from '../../shared/shanghai-time.utils';
import {
  ClubWechatRefundService,
  type WechatRefundResult,
} from '../payments/club-wechat-refund.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  claimRefundSlot,
  releaseRefundSlot,
  settleRefundTerminal,
  type RefundOperator,
} from './club-voucher-order-refund-settlement.helper';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE,
  CLUB_VOUCHER_REFUND_FAILED_MESSAGE,
  CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
  CLUB_VOUCHER_REFUND_PROCESSING_MESSAGE,
  CLUB_VOUCHER_REFUND_UNKNOWN_MESSAGE,
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
  /** 以数据库为准的拒绝时间；顾客自行退款（无拒单记录）时为 null */
  rejectedAt: string | null;
  /** 以数据库为准的拒单经办人；顾客自行退款时为 null，不伪造成当前操作人 */
  rejectedByStaffName: string | null;
}

/** 落库结果快照：所有对外字段一律从数据库回读，不做本地拼装 */
interface SettledOrderSnapshot {
  orderNo: string;
  voucherCode: string | null;
  paidAmountFen: number;
  refundAt: Date | null;
  refundAmountFen: number | null;
  rejectedAt: Date | null;
  rejectedByStaffName: string | null;
}

/** 退款编排共用参数：只有文案与拒绝信息在两条链路之间不同 */
interface RefundSettlementOptions {
  /** 微信退款单备注 */
  reason: string;
  /** 成功日志前缀 */
  logLabel: string;
  /** 并发抢占失败时抛给前端的业务异常载荷（文案 + 稳定业务码） */
  conflict: ClubVoucherErrorPayload;
  /** 商家拒绝接单时写入的经办人信息 */
  rejectBy?: RefundOperator;
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
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
        ),
      );
    }

    // 幂等：已退款直接返回数据库中的退款结果
    if (order.status === 'refunded') {
      return this.toRefundResult(this.toSnapshot(order));
    }

    await this.runRefund(order, {
      reason: '用户主动退款',
      logLabel: '团购券退款成功',
      conflict: clubVoucherError(
        CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_USED_SESSION,
        CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
      ),
    });

    const latest = await this.reloadOrder(order.id);
    // 事务提交成功后才广播退款事件：store 房间（商家端订单页实时刷新）+ voucher-order 房间与 native 订阅者（purelyClub 详情页）
    this.realtimeService.publishVoucherOrderStatusChanged({
      storeId: order.storeId,
      orderNo: latest.orderNo,
      voucherCode: latest.voucherCode ?? '',
      status: 'refunded',
      refundAt: (latest.refundAt ?? new Date()).toISOString(),
    });
    return this.toRefundResult(latest);
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
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
        ),
      );
    }

    // 幂等：已退款直接返回数据库中的拒单/退款信息，不再用当前操作人补归因
    if (order.status === 'refunded') {
      return this.toRejectResult(this.toSnapshot(order));
    }

    await this.runRefund(order, {
      reason: '商家拒绝接单',
      logLabel: '商家拒绝团购券订单成功',
      conflict: clubVoucherError(
        CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_NOT_ALLOWED,
        CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
      ),
      rejectBy: {
        name: params.rejectedByStaffName,
        role: params.rejectedByStaffRole,
      },
    });

    return this.toRejectResult(await this.reloadOrder(order.id));
  }

  // ─── 退款编排：占位 → 出款 → 终态 ─────────────────────────────────────────

  /**
   * 退款编排入口。
   *
   * 顺序固定为「先占位、再出款、最后落终态」：
   * 反过来的话，微信已出款而本地占位失败时，券仍可开台/核销，钱券两失。
   */
  private async runRefund(
    order: ClubVoucherOrder,
    options: RefundSettlementOptions,
  ): Promise<void> {
    const refundNo = this.buildRefundNo(order.orderNo);

    // 上次退款中断（占位已写入但未落终态）：先按渠道终态补齐。
    // 这里刻意不看有效期——钱可能已经出款，拒绝补齐会让订单永远停在「退款中」。
    if (order.refundNo !== null) {
      await this.resumeRefund(order, refundNo, options);
      return;
    }

    this.assertRefundable(order);

    // 余额支付没有远程出款，占位与终态可以合并在一个事务里，失败即整体回滚
    if (isBalancePaymentChannel(order.paymentChannel)) {
      await settleRefundTerminal(this.prisma, order, {
        orderId: order.id,
        orderNo: order.orderNo,
        paidAmountFen: order.paidAmountFen,
        channel: 'balance',
        refundNo,
        rejectBy: options.rejectBy,
        slotClaimed: false,
        conflict: options.conflict,
      });
      this.logger.log(
        `${options.logLabel}: orderNo=${order.orderNo}, refundNo=${refundNo}, 金额=${order.paidAmountFen}分, 渠道=balance`,
      );
      return;
    }

    await this.startWechatRefund(order, refundNo, options);
  }

  /**
   * 微信渠道：占位成功后才发起退款。
   *
   * - SUCCESS：落终态
   * - PROCESSING：保持占位，不落终态，等待重试时查单补齐
   * - ABNORMAL / CLOSED / UNKNOWN：确认未出款，释放占位后允许重试
   * - 请求异常：结果未知，保持占位（宁可券不可用，也不能钱券两失）
   */
  private async startWechatRefund(
    order: ClubVoucherOrder,
    refundNo: string,
    options: RefundSettlementOptions,
  ): Promise<void> {
    const claimed = await claimRefundSlot(this.prisma, order.id, refundNo);
    if (!claimed) {
      throw new BadRequestException(options.conflict);
    }

    let result: WechatRefundResult;
    try {
      result = await this.clubWechatRefundService.requestRefund({
        storeId: order.storeId,
        orderNo: order.orderNo,
        refundNo,
        totalFen: order.paidAmountFen,
        refundFen: order.paidAmountFen,
        reason: options.reason,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `团购券退款请求结果未知，保留退款占位等待核对: orderNo=${order.orderNo}, refundNo=${refundNo}, ${detail}`,
      );
      throw new InternalServerErrorException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.STATUS_ORDER_PROCESSING,
          CLUB_VOUCHER_REFUND_UNKNOWN_MESSAGE,
        ),
      );
    }

    if (result.status === 'SUCCESS') {
      await settleRefundTerminal(this.prisma, order, {
        orderId: order.id,
        orderNo: order.orderNo,
        paidAmountFen: order.paidAmountFen,
        channel: 'wechat',
        refundNo,
        rejectBy: options.rejectBy,
        slotClaimed: true,
        conflict: options.conflict,
      });
      this.logger.log(
        `${options.logLabel}: orderNo=${order.orderNo}, refundNo=${refundNo}, 金额=${order.paidAmountFen}分, 渠道=wechat, 微信退款单=${result.refundId}`,
      );
      return;
    }

    if (result.status === 'PROCESSING') {
      this.logger.warn(
        `团购券退款受理未完成，保持占位等待查单: orderNo=${order.orderNo}, refundNo=${refundNo}, 微信退款单=${result.refundId}`,
      );
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.STATUS_ORDER_PROCESSING,
          CLUB_VOUCHER_REFUND_PROCESSING_MESSAGE,
        ),
      );
    }

    await releaseRefundSlot(this.prisma, order.id, refundNo);
    this.logger.error(
      `团购券退款未成功，已释放占位: orderNo=${order.orderNo}, refundNo=${refundNo}, 渠道状态=${result.status}`,
    );
    throw new BadRequestException(
      clubVoucherError(
        CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_NOT_ALLOWED,
        CLUB_VOUCHER_REFUND_FAILED_MESSAGE,
      ),
    );
  }

  /** 中断恢复：占位已存在时，先查单确认终态，只有 SUCCESS 才落「已退款」 */
  private async resumeRefund(
    order: ClubVoucherOrder,
    refundNo: string,
    options: RefundSettlementOptions,
  ): Promise<void> {
    // 余额渠道无外部出款，占位残留只会来自历史数据，直接补齐终态即可
    const channel = isBalancePaymentChannel(order.paymentChannel)
      ? 'balance'
      : 'wechat';

    if (channel === 'wechat') {
      const current = await this.clubWechatRefundService.queryRefund({
        storeId: order.storeId,
        orderNo: order.orderNo,
        refundNo,
      });

      if (
        current.status === 'ABNORMAL' ||
        current.status === 'CLOSED' ||
        current.status === 'NOT_FOUND'
      ) {
        await releaseRefundSlot(this.prisma, order.id, refundNo);
        this.logger.error(
          `中断退款确认未成功，已释放占位: orderNo=${order.orderNo}, refundNo=${refundNo}, 渠道状态=${current.status}`,
        );
        throw new BadRequestException(
          clubVoucherError(
            CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_NOT_ALLOWED,
            CLUB_VOUCHER_REFUND_FAILED_MESSAGE,
          ),
        );
      }

      if (current.status !== 'SUCCESS') {
        throw new BadRequestException(
          clubVoucherError(
            CLUB_VOUCHER_ERROR_CODE.STATUS_ORDER_PROCESSING,
            CLUB_VOUCHER_REFUND_PROCESSING_MESSAGE,
          ),
        );
      }
    }

    await settleRefundTerminal(this.prisma, order, {
      orderId: order.id,
      orderNo: order.orderNo,
      paidAmountFen: order.paidAmountFen,
      channel,
      refundNo,
      rejectBy: options.rejectBy,
      slotClaimed: true,
      conflict: options.conflict,
    });
    this.logger.log(
      `${options.logLabel}（中断补齐）: orderNo=${order.orderNo}, refundNo=${refundNo}, 渠道=${channel}`,
    );
  }

  // ─── 可退校验 ─────────────────────────────────────────────────────────────

  /**
   * 可退状态校验。
   *
   * 过期券不可退：expiresAt 已到但尚未被惰性翻转的单（用户从未打开过列表/详情）同样拒绝，
   * 否则同一张券会「看过详情页就不能退、没看过就能退」，退款资格不确定。
   */
  private assertRefundable(order: ClubVoucherOrder): void {
    // 可退状态：pending（待使用）、used-未开台（已核销但未绑定开台会话）
    if (order.status === 'used' && order.usedSessionId !== null) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_USED_SESSION,
          CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE,
        ),
      );
    }
    if (order.status !== 'pending' && order.status !== 'used') {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_NOT_ALLOWED,
          CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE,
        ),
      );
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RULE_REFUND_EXPIRED,
          CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE,
        ),
      );
    }
  }

  // ─── 结果回读与工具 ───────────────────────────────────────────────────────

  /** 从数据库回读落库结果：对外字段一律以持久化值为准，不做本地推测 */
  private async reloadOrder(orderId: number): Promise<SettledOrderSnapshot> {
    const latest = await this.prisma.clubVoucherOrder.findUnique({
      where: { id: orderId },
      select: {
        orderNo: true,
        voucherCode: true,
        paidAmountFen: true,
        refundAt: true,
        refundAmountFen: true,
        rejectedAt: true,
        rejectedByStaffName: true,
      },
    });
    if (!latest) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
        ),
      );
    }
    return latest;
  }

  /** 已有订单行转快照（幂等分支复用，避免为一次返回再查库） */
  private toSnapshot(order: ClubVoucherOrder): SettledOrderSnapshot {
    return {
      orderNo: order.orderNo,
      voucherCode: order.voucherCode,
      paidAmountFen: order.paidAmountFen,
      refundAt: order.refundAt,
      refundAmountFen: order.refundAmountFen,
      rejectedAt: order.rejectedAt,
      rejectedByStaffName: order.rejectedByStaffName,
    };
  }

  private toRefundResult(
    snapshot: SettledOrderSnapshot,
  ): ClubVoucherRefundResult {
    return {
      orderNo: snapshot.orderNo,
      status: 'refunded',
      refundAt: this.formatDateTime(snapshot.refundAt ?? new Date()),
      refundAmountFen: snapshot.refundAmountFen ?? snapshot.paidAmountFen,
    };
  }

  private toRejectResult(
    snapshot: SettledOrderSnapshot,
  ): ClubVoucherMerchantRejectResult {
    return {
      orderNo: snapshot.orderNo,
      voucherCode: snapshot.voucherCode ?? '',
      status: 'refunded',
      refundAt: this.formatDateTime(snapshot.refundAt ?? new Date()),
      refundAmountFen: snapshot.refundAmountFen ?? snapshot.paidAmountFen,
      // 以数据库为准：没有拒单记录（顾客自行退款）就返回 null，
      // 否则前端会把退款时间当成「商家拒单」渲染成当前员工的操作
      rejectedAt: snapshot.rejectedAt
        ? this.formatDateTime(snapshot.rejectedAt)
        : null,
      rejectedByStaffName: snapshot.rejectedByStaffName,
    };
  }

  /**
   * 生成退款单号：RF + 订单号（微信 out_refund_no，同一订单恒定不变）。
   * 必须由订单号确定性派生——随机值会让并发的两笔退款或失败重试在微信侧被当成多笔
   * 不同退款：只有一笔能落到 DB，其余要么重复出款，要么「钱已退而订单状态未变更」。
   */
  private buildRefundNo(orderNo: string): string {
    return `RF${orderNo.replace(/[^A-Za-z0-9_-]/g, '')}`;
  }

  /** 上海墙钟 `YYYY-MM-DD HH:mm`，与核销链路共用同一份共享工具。 */
  private formatDateTime(date: Date): string {
    return formatShanghaiDateTime(date.getTime());
  }
}
