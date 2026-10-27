/**
 * purely-club 订单「微信侧主动核对」通用服务。
 *
 * 为什么必须有这一层：
 * `wx.requestPayment` 的结果可能是 unknown（小程序被系统回收、支付页切后台、
 * 回调延迟）。此时前端若按失败提示「请重试」，用户很可能已经扣款 —— 重试会
 * 造成重复支付。正确做法是以微信侧为准核对一次：
 *   - 微信侧 SUCCESS 且本地未落账 → 返回可用快照，由调用方补落账；
 *   - 微信侧 NOTPAY / CLOSED → 确认未扣款，前端可以安全地引导重试；
 *   - 查不到 / 返回未知 → 仍是不确定，前端继续展示「等待到账确认」。
 *
 * 本服务只负责「核对」，不负责落账：四条链路（服务订单 / 团购券 / 自助点单 /
 * 扫码点餐）各有自己的落账入口与幂等实现，由调用方拿到快照后自行落账。
 *
 * 节流：前端查单是 500ms 级轮询，若每次都打微信查单会把商户接口打爆，
 * 因此同一订单默认 {@link CLUB_WECHAT_VERIFY_INTERVAL_SECONDS} 内只核对一次。
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubWechatTransactionService } from './club-wechat-transaction.service';

/** 同一订单两次微信侧核对的最小间隔（秒）；前端 500ms 轮询在窗口内直接复用本地状态 */
export const CLUB_WECHAT_VERIFY_INTERVAL_SECONDS = 3;

/** 核对场景：用于节流 key 分桶与日志定位，避免不同链路互相顶掉名额 */
export const CLUB_WECHAT_VERIFY_SCOPES = [
  'service',
  'voucher',
  'self-ordering',
  'scan-ordering',
] as const;

export type ClubWechatVerifyScope = (typeof CLUB_WECHAT_VERIFY_SCOPES)[number];

/** 核对通过的支付快照：字段直接对齐落账入参，调用方无需再推导 */
export interface ClubWechatVerifiedPayment {
  /** 微信侧实付金额（分） */
  amountFen: number;
  /** 微信支付流水号 */
  transactionId: string;
  /** 支付完成时间（毫秒时间戳） */
  paidAtMs: number;
}

export interface ClubWechatVerifyParams {
  /** 核对场景 */
  scope: ClubWechatVerifyScope;
  /** 门店 ID：决定用哪个商户号查询 */
  storeId: number;
  /** 微信商户单号（out_trade_no） */
  outTradeNo: string;
  /** 本地应付金额（分），用于与微信侧实付金额比对 */
  expectedAmountFen: number;
  /** 跳过节流，立即核对（人工补单场景） */
  force?: boolean;
}

@Injectable()
export class ClubWechatVerifyService {
  private readonly logger = new Logger(ClubWechatVerifyService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly alertService: AlertService,
    private readonly transactionService: ClubWechatTransactionService,
  ) {}

  /**
   * 回微信侧核对订单，确认已支付时返回落账快照。
   *
   * @returns 已支付且金额 / 流水号齐全时返回快照；未支付、查不到、数据不一致或节流命中返回 null
   */
  async confirmPaidOnWechat(
    params: ClubWechatVerifyParams,
  ): Promise<ClubWechatVerifiedPayment | null> {
    if (
      !params.force &&
      !(await this.acquireVerifySlot(params.scope, params.outTradeNo))
    ) {
      // 节流命中：交给调用方按本地状态返回，不谎报成功也不谎报失败
      return null;
    }

    const result = await this.transactionService.queryByOutTradeNo({
      storeId: params.storeId,
      orderNo: params.outTradeNo,
    });

    if (!result.found) {
      this.logger.warn(
        `[${params.scope}] 订单 ${params.outTradeNo} 微信侧查不到交易（code=${result.code ?? 'UNKNOWN'}），保持本地状态`,
      );
      return null;
    }

    const { snapshot } = result;
    if (snapshot.tradeState !== 'SUCCESS') {
      this.logger.log(
        `[${params.scope}] 订单 ${params.outTradeNo} 微信侧状态 ${snapshot.tradeState}，未支付`,
      );
      return null;
    }

    return this.assertSettlementUsable(
      params,
      snapshot.amountFen,
      snapshot.transactionId,
      snapshot.paidAtMs,
    );
  }

  /**
   * 落账前的一致性校验：金额不符或流水号缺失一律不落账。
   *
   * 宁可留待人工核对，也不能按错误金额给用户加余额 / 出券 / 出餐。
   */
  private async assertSettlementUsable(
    params: ClubWechatVerifyParams,
    amountFen: number | null,
    transactionId: string | null,
    paidAtMs: number | null,
  ): Promise<ClubWechatVerifiedPayment | null> {
    if (amountFen !== null && amountFen !== params.expectedAmountFen) {
      await this.alertService.send({
        level: 'error',
        title: `${params.scope} 订单微信侧金额与本地不一致`,
        content:
          `outTradeNo=${params.outTradeNo} storeId=${params.storeId} ` +
          `微信=${amountFen} 分，本地=${params.expectedAmountFen} 分，已跳过自动补落账`,
        suppressKey: `${params.scope}-amount-mismatch:${params.outTradeNo}`,
      });
      return null;
    }

    if (!transactionId) {
      await this.alertService.send({
        level: 'error',
        title: `${params.scope} 订单微信侧已支付但缺少流水号`,
        content:
          `outTradeNo=${params.outTradeNo} storeId=${params.storeId} ` +
          `tradeState=SUCCESS 但 transaction_id 为空，无法补落账`,
        suppressKey: `${params.scope}-missing-transaction:${params.outTradeNo}`,
      });
      return null;
    }

    this.logger.warn(
      `[${params.scope}] 订单 ${params.outTradeNo} 微信侧已支付但本地未落账，补落账（transactionId=${transactionId}）`,
    );

    return {
      amountFen: amountFen ?? params.expectedAmountFen,
      transactionId,
      paidAtMs: paidAtMs ?? Date.now(),
    };
  }

  /** 抢占本次核对名额；false 表示节流窗口内已核对过 */
  private async acquireVerifySlot(
    scope: ClubWechatVerifyScope,
    outTradeNo: string,
  ): Promise<boolean> {
    return this.redisService.setIfAbsent(
      `club:wechat-verify:${scope}:${outTradeNo}`,
      String(Date.now()),
      CLUB_WECHAT_VERIFY_INTERVAL_SECONDS,
    );
  }
}
