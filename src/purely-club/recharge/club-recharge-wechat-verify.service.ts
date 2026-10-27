/**
 * 充值订单「微信侧主动核对 + 补落账」服务（D2 / D3）。
 *
 * 为什么必须有这一层：
 * `wx.requestPayment` 的结果可能是 unknown（小程序被系统回收、支付页切后台、
 * 回调延迟）。此时前端若按失败提示「请重试」，用户很可能已经扣款 —— 重试会
 * 造成重复支付。正确做法是以微信侧为准核对一次：
 *   - 微信侧 SUCCESS 且本地未落账 → 立即补落账，用户看到真实结果；
 *   - 微信侧 NOTPAY / CLOSED → 确认未扣款，前端可以安全地引导重试；
 *   - 查不到 / 返回未知 → 仍是不确定，前端继续展示「等待到账确认」。
 *
 * 节流：前端查单是 500ms 级轮询，若每次都打微信查单会把商户接口打爆，
 * 因此同一订单默认 {@link CLUB_RECHARGE_WECHAT_VERIFY_INTERVAL_SECONDS} 内只核对一次。
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubWechatTransactionService } from '../payments/club-wechat-transaction.service';
import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusValue } from '../orders/club-order.types';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { CLUB_RECHARGE_WECHAT_VERIFY_INTERVAL_SECONDS } from './club-recharge.constants';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';

/** 只有处于这两个状态的订单才值得回微信核对：paid 已终结，failed/cancelled 不可支付 */
const VERIFIABLE_STATUSES: readonly ClubOrderStatusValue[] = [
  'pending',
  'expired',
];

type RechargeDraft = ClubOrderDraftPayload<
  ClubRechargeOrderMetadata,
  'recharge'
>;

@Injectable()
export class ClubRechargeWechatVerifyService {
  private readonly logger = new Logger(ClubRechargeWechatVerifyService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly alertService: AlertService,
    private readonly transactionService: ClubWechatTransactionService,
    private readonly clubRechargeQueryService: ClubRechargeQueryService,
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
  ) {}

  /**
   * 核对订单在微信侧的真实状态，必要时补落账。
   *
   * @param params.orderNo 业务订单号（微信 out_trade_no）
   * @param params.force   跳过节流，立即核对（管理端人工补单用）
   * @returns 核对后（可能已落账）的订单状态
   */
  async verifyAndSettle(params: {
    orderNo: string;
    force?: boolean;
  }): Promise<ClubRechargeOrderResponseDto> {
    const draft = await this.clubRechargeQueryService.getRechargeDraftByOrderNo(
      params.orderNo,
    );

    if (!VERIFIABLE_STATUSES.includes(draft.status)) {
      return this.clubRechargeQueryService.toRechargeOrderResponse(draft);
    }

    if (!params.force && !(await this.acquireVerifySlot(draft.orderNo))) {
      // 节流命中：返回本地状态，前端继续按「等待确认」展示，不谎报成功也不谎报失败
      return this.clubRechargeQueryService.toRechargeOrderResponse(draft);
    }

    const settled = await this.settleIfPaidOnWechat(draft);
    return (
      settled ?? this.clubRechargeQueryService.toRechargeOrderResponse(draft)
    );
  }

  // ─── 微信侧核对与补落账 ───────────────────────────────────────────────────

  private async settleIfPaidOnWechat(
    draft: RechargeDraft,
  ): Promise<ClubRechargeOrderResponseDto | null> {
    const result = await this.transactionService.queryByOutTradeNo({
      storeId: draft.storeId,
      orderNo: draft.orderNo,
    });

    if (!result.found) {
      this.logger.warn(
        `充值订单 ${draft.orderNo} 微信侧查不到交易（code=${result.code ?? 'UNKNOWN'}），保持本地状态 ${draft.status}`,
      );
      return null;
    }

    const { snapshot } = result;

    if (snapshot.tradeState !== 'SUCCESS') {
      this.logger.log(
        `充值订单 ${draft.orderNo} 微信侧交易状态 ${snapshot.tradeState}，本地状态 ${draft.status} 保持不变`,
      );
      return null;
    }

    if (snapshot.amountFen !== null && snapshot.amountFen !== draft.amountFen) {
      // 金额不一致绝不落账：宁可留待人工，也不能按错误金额给用户加余额
      await this.alertService.send({
        level: 'error',
        title: '充值订单微信侧金额与本地不一致',
        content: `orderNo=${draft.orderNo} storeId=${draft.storeId} 微信=${snapshot.amountFen} 分，本地=${draft.amountFen} 分，已跳过自动补落账`,
        suppressKey: `recharge-amount-mismatch:${draft.orderNo}`,
      });
      return null;
    }

    if (!snapshot.transactionId) {
      await this.alertService.send({
        level: 'error',
        title: '充值订单微信侧已支付但缺少流水号',
        content: `orderNo=${draft.orderNo} storeId=${draft.storeId} tradeState=SUCCESS 但 transaction_id 为空，无法补落账`,
        suppressKey: `recharge-missing-transaction:${draft.orderNo}`,
      });
      return null;
    }

    this.logger.warn(
      `充值订单 ${draft.orderNo} 微信侧已支付但本地未落账，主动查单补落账（transactionId=${snapshot.transactionId}）`,
    );

    return this.clubRechargePaymentService.confirmOrderPaidByCallback(
      draft.orderNo,
      {
        amountFen: snapshot.amountFen ?? draft.amountFen,
        transactionId: snapshot.transactionId,
        paidAtMs: snapshot.paidAtMs ?? Date.now(),
        callbackReceivedAtMs: Date.now(),
      },
    );
  }

  // ─── 节流 ─────────────────────────────────────────────────────────────────

  /** 抢占本次核对名额；false 表示节流窗口内已核对过 */
  private async acquireVerifySlot(orderNo: string): Promise<boolean> {
    return this.redisService.setIfAbsent(
      `club:recharge:wechat-verify:${orderNo}`,
      String(Date.now()),
      CLUB_RECHARGE_WECHAT_VERIFY_INTERVAL_SECONDS,
    );
  }
}
