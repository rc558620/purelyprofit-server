// 平台会员真实支付的统一入口（对外门面）
//
// 接入真实支付后这条链路变成「下单 → 二维码 → 回调 → 生效 → 补偿」，
// 生命周期差异很大，因此按阶段拆成三个子服务，本文件只保留对外契约与状态查询：
// - 下单换码：PlatformMembershipPaymentPurchaseService
// - 回调生效：PlatformMembershipPaymentActivationService
// - 补偿自愈：PlatformMembershipPaymentRecoveryService
//
// 保留门面的原因：支付回调分发、对账结算、订单服务都只依赖这一层，
// 拆分不应把内部阶段扩散成跨模块依赖。
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformMembershipPaymentActivationService } from './platform-membership-payment-activation.service';
import { PlatformMembershipPaymentPurchaseService } from './platform-membership-payment-purchase.service';
import { PlatformMembershipPaymentRecoveryService } from './platform-membership-payment-recovery.service';
import type { PurchaseMembershipResult } from './platform-membership-order.service';
import type { PurchasePlatformMembershipOrderDto } from './dto/platform-membership-query.dto';

@Injectable()
export class PlatformMembershipPaymentService {
  private readonly logger = new Logger(PlatformMembershipPaymentService.name);

  constructor(
    private readonly purchaseService: PlatformMembershipPaymentPurchaseService,
    private readonly activationService: PlatformMembershipPaymentActivationService,
    private readonly recoveryService: PlatformMembershipPaymentRecoveryService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
  ) {}

  /** 真实模式购买：只落待支付订单与支付单，权益等支付回调再生效 */
  async createMembershipPaymentOrder(
    userId: number,
    storeId: number,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<Extract<PurchaseMembershipResult, { mode: 'live' }>> {
    return this.purchaseService.createMembershipPaymentOrder(
      userId,
      storeId,
      dto,
    );
  }

  /** 支付回调生效：幂等（重复回调不会重复开通或重复扣豆） */
  async activateByPaymentOrderNo(params: {
    paymentOrderNo: string;
    transactionId: string;
    amountFen: number;
  }): Promise<void> {
    return this.activationService.activateByPaymentOrderNo(params);
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

      // 「支付单 paid」不等于「权益已生效」：补生效仍然失败时必须按未完成返回，
      // 否则前端会把 paid 当成功提示并自动返回，用户以为已开通、实际一分权益没有
      const settled = await this.recoveryService.isMembershipOrderSettled(
        params.orderNo,
      );
      if (!settled) {
        this.logger.warn(
          `[会员支付] ${params.orderNo} 已付款但权益尚未落地，按未完成返回`,
        );
        return { ...status, status: 'pending' };
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
    const result = await this.paymentOrderService.closeOrder(
      params.orderNo,
      params.storeId,
    );

    // 关单只改了支付单：会员单会一直停在 pending，订单列表继续显示「待支付」
    // 并占着抵扣额度。确认关闭后同步置 failed（已 paid 的单绝不能被覆盖）
    if (result.status === 'closed') {
      await this.recoveryService.closePendingOrderByPaymentOrderNo(
        params.orderNo,
      );
    }

    return result;
  }

  /** 补偿：支付单已 paid 但会员权益尚未落地时补生效（前端轮询 / 启动扫描触发） */
  async retryActivateIfPaid(paymentOrderNo: string): Promise<boolean> {
    return this.recoveryService.retryActivateIfPaid(paymentOrderNo);
  }

  /** 启动补偿：扫描近期「已付款但权益未落地」的会员订单并补生效 */
  async backfillPendingPaidOrders(): Promise<void> {
    return this.recoveryService.backfillPendingPaidOrders();
  }
}
