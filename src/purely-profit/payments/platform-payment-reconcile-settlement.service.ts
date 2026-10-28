/**
 * 平台收款对账的**执行层**：按微信查单结论补入账 / 关单。
 *
 * 与编排层（`PlatformPaymentReconcileService`）分开的原因：
 * 编排层关心「扫哪些单、何时扫、扫得动扫不动」，执行层关心
 * 「微信说付了怎么补、微信说没付怎么收口」。两者变化原因不同，
 * 混在一起会让「新增一个 bizType」和「调整对账节流」互相牵连。
 *
 * 入账分发的口径与平台收款回调（`PlatformPaymentCallbackService.dispatchByBizType`）
 * **保持一致**：只接 `new_customer_quota` 与 `membership`，其它 bizType 一律告警不处理。
 * 之所以不直接复用同一份代码：两个入口的失败语义不同 ——
 * 回调必须对未接入的 bizType 回 FAIL 让微信重投，而对账是后台兜底，
 * 只能告警并保持 pending，否则这笔「已付款」会从对账视野里消失。
 */
import { Injectable, Logger } from '@nestjs/common';
import { AlertService } from '../../shared/alert/alert.service';
import { NewCustomerQuotaRechargeService } from '../member/new-customer-quota/new-customer-quota-recharge.service';
import { PlatformMembershipPaymentService } from '../member/platform-membership/platform-membership-payment.service';
import { PlatformPaymentOrderService } from './platform-payment-order.service';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import type {
  PlatformWechatOrderSnapshot,
  PlatformWechatTradeState,
} from './platform-wechat-native.service';
import { PROFIT_PAYMENT_UNPAID_TRADE_STATES } from './platform-payment-reconcile.constants';

/** 待核对的挂起单（只取对账需要的字段） */
export interface PendingPaymentOrder {
  orderNo: string;
  bizType: string;
  amountFen: number;
  expiresAt: Date;
}

@Injectable()
export class PlatformPaymentReconcileSettlementService {
  private readonly logger = new Logger(
    PlatformPaymentReconcileSettlementService.name,
  );

  constructor(
    private readonly alertService: AlertService,
    private readonly nativeService: PlatformWechatNativeService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly realtimeService: PlatformPaymentRealtimeService,
    private readonly quotaRechargeService: NewCustomerQuotaRechargeService,
    private readonly membershipPaymentService: PlatformMembershipPaymentService,
  ) {}

  /**
   * 微信侧已支付 → 补入账。
   *
   * 入账前必须过两道闸门：**金额与本地落单金额一致**、**微信流水号非空**。
   * 任一不满足就绝不入账，只告警 —— 按错金额开通会员 / 加额度属于资金事故，
   * 事后几乎追不回来。这两道闸门没有「兼容旧数据」的例外。
   *
   * @returns 是否完成入账
   */
  async settlePaidOrder(
    order: PendingPaymentOrder,
    snapshot: PlatformWechatOrderSnapshot,
  ): Promise<boolean> {
    if (snapshot.amountFen === null || snapshot.amountFen !== order.amountFen) {
      await this.alertService.send({
        level: 'error',
        title: '平台收款对账发现金额不一致',
        content:
          `orderNo=${order.orderNo} bizType=${order.bizType} ` +
          `微信=${snapshot.amountFen ?? '缺失'} 分，本地=${order.amountFen} 分，` +
          '已跳过自动补入账，请人工核对。',
        suppressKey: `profit-payment-reconcile-amount-mismatch:${order.orderNo}`,
      });
      return false;
    }

    if (!snapshot.transactionId) {
      await this.alertService.send({
        level: 'error',
        title: '平台收款对账缺少微信流水号',
        content:
          `orderNo=${order.orderNo} bizType=${order.bizType} ` +
          '微信侧 tradeState=SUCCESS 但 transaction_id 为空，无法追溯，已跳过自动补入账。',
        suppressKey: `profit-payment-reconcile-missing-transaction:${order.orderNo}`,
      });
      return false;
    }

    return this.dispatchByBizType(
      order,
      snapshot.transactionId,
      snapshot.paidAt,
    );
  }

  /** 微信侧是否处于「确认未支付」状态（结果未定的状态一律不算） */
  isUnpaid(tradeState: PlatformWechatTradeState): boolean {
    return PROFIT_PAYMENT_UNPAID_TRADE_STATES.includes(tradeState);
  }

  /** 本地订单是否已过有效期 */
  isExpired(order: PendingPaymentOrder): boolean {
    return order.expiresAt.getTime() <= Date.now();
  }

  /**
   * 微信侧确认未支付且本地已过期 → 先关微信侧，再关本地单。
   *
   * 顺序不能反：本地单 15 分钟过期，而微信二维码最长 2 小时有效，
   * 只关本地单会出现「前端已放弃轮询、钱照扣」。
   *
   * @returns 是否完成关单；false 表示关单瞬间被回调抢占（订单已 paid）
   */
  async closeUnpaidOrder(order: PendingPaymentOrder): Promise<boolean> {
    const result = await this.nativeService.closeNativeOrder(
      order.orderNo,
      order.bizType,
    );

    // 微信侧报已支付：钱已扣、回调还在路上，此时绝不能关本地单
    if (result === 'paid') {
      this.logger.warn(
        `[平台收款对账] ${order.orderNo} 关单时发现微信侧已支付，保持 pending 等待回调`,
      );
      return false;
    }

    return this.paymentOrderService.markClosed(order.orderNo);
  }

  // ─── 入账分发 ─────────────────────────────────────────────────────────────

  /**
   * 按支付单业务类型分发补入账。
   *
   * @returns 是否已入账；false 表示业务类型未接入（已告警，订单保持 pending）
   */
  private async dispatchByBizType(
    order: PendingPaymentOrder,
    transactionId: string,
    paidAt: Date | null,
  ): Promise<boolean> {
    if (order.bizType === 'new_customer_quota') {
      await this.quotaRechargeService.settleByOrderNo({
        orderNo: order.orderNo,
        transactionId,
        amountFen: order.amountFen,
      });
      this.realtimeService.publishPaid(
        order.orderNo,
        paidAt?.toISOString() ?? new Date().toISOString(),
      );
      return true;
    }

    if (order.bizType === 'membership') {
      await this.membershipPaymentService.activateByPaymentOrderNo({
        paymentOrderNo: order.orderNo,
        transactionId,
        amountFen: order.amountFen,
      });
      this.realtimeService.publishPaid(
        order.orderNo,
        paidAt?.toISOString() ?? new Date().toISOString(),
      );
      return true;
    }

    // 其余 bizType（含本不该出现在此表的 sms_recharge）：刻意**不置 failed**——
    // 一旦翻成终态，这笔「已付款但无处入账」的单就从对账视野里消失了
    await this.alertService.send({
      level: 'error',
      title: '平台收款对账遇到未接入的业务类型',
      content:
        `orderNo=${order.orderNo} bizType=${order.bizType} ` +
        '微信侧已支付但缺少入账处理器，已跳过并保持 pending 待人工处理。',
      suppressKey: `profit-payment-reconcile-unsupported-biz:${order.orderNo}`,
    });
    return false;
  }
}
