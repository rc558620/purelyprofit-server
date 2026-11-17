/**
 * 微信 JSAPI 预下单的按需取参（payment attempt 幂等）。
 *
 * 背景：改造前「服务购买单 / 购卡单」把微信预下单塞在建单链路里，
 * 微信变慢或挂起会直接把建单拖到超时（`WECHAT_PAY_REQUEST_TIMEOUT_MS = 8s`），
 * 用户看到的是「下单失败」，而实际上什么都没落库。改造后建单只落本地草稿 / 订单，
 * 预下单挪到本服务，由前端单独调用，失败可原样重试而不重复建单。
 *
 * 幂等与可重试的两个关键点：
 * 1. 同一订单的并发取参用 Redis `SET NX` 互斥，避免两次远程下单互相覆盖；
 * 2. 每次取参分配新的尝试序号，`out_trade_no = {orderNo}-P{nn}`：
 *    微信不允许同单号重复下单，而序号后缀可从单号反解出基准订单号，
 *    因此支付回调无需任何映射存储也能定位原订单。
 *
 * ⚠️ 不落库、不建表：本服务刻意保持零 schema 变更。代价是服务购买单
 * （SV，仅有 Redis 草稿、无订单表）的 sp/sub_mch_id 仍无法落库，
 * 属既有短板，需另立任务处理，不在本次性能优化范围内顺手改资金表。
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';
import { ClubPaymentModeService } from './club-payment-mode.service';
import { ClubWechatJsapiService } from './club-wechat-jsapi.service';
import { ClubWechatOpenidService } from './club-wechat-openid.service';
import {
  buildPrepayOutTradeNo,
  MAX_PREPAY_ATTEMPT_SEQ,
} from './club-prepay-out-trade-no.util';

/** 在途互斥租约：单次远程下单最长 8s，取 10s 覆盖且不会长期阻塞用户重试 */
const PREPAY_LOCK_TTL_SECONDS = 10;

/** 尝试序号存活期：与订单待支付窗口一致（15 分钟），过期后重新从 01 开始 */
const PREPAY_SEQ_TTL_SECONDS = 15 * 60;

/** 尝试记录存活期：仅用于观测与排查，随订单窗口一起过期 */
const PREPAY_ATTEMPT_TTL_SECONDS = 15 * 60;

const PREPAY_SEQ_KEY_PREFIX = 'club:prepay:seq:';
const PREPAY_LOCK_KEY_PREFIX = 'club:prepay:lock:';
const PREPAY_ATTEMPT_KEY_PREFIX = 'club:prepay:attempt:';

/** 取参失败原因：由调用方映射成本域的错误码 */
export type ClubPrepayFailureReason = 'in_flight' | 'exhausted';

/** 取参入参：订单事实由各域从自己的载体（Redis 草稿 / 订单表）读出后传入 */
export interface ClubPrepayParams {
  /** 基准订单号（落库 / 草稿 key 使用的单号，不带尝试后缀） */
  baseOrderNo: string;
  storeId: number;
  /** 微信账单展示的商品描述 */
  description: string;
  amountFen: number;
  /** 发起支付的用户 ID，用于解析 openid */
  userId: number;
  /** 前端显式传入的 openid；缺省时按 userId 回查 */
  openid?: string;
  /** 错误构造器：保证「在途 / 序号耗尽」各自落到本域码表 */
  buildError: (reason: ClubPrepayFailureReason) => Error;
}

/** 取参结果 */
export interface ClubPrepayResult {
  /** 本次尝试的商户单号；测试模式或解析不到 openid 时为 null */
  merchantPaymentNo: string | null;
  /** 前端拉起 wx.requestPayment 所需参数；为 null 表示不应调起收银台 */
  paymentParams: ClubWechatPaymentParamsDto | null;
  /** 测试模式：不调微信，前端走 confirm-paid 兜底 */
  testMode: boolean;
}

@Injectable()
export class ClubPrepayAttemptService {
  private readonly logger = new Logger(ClubPrepayAttemptService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly paymentModeService: ClubPaymentModeService,
    private readonly jsapiService: ClubWechatJsapiService,
    private readonly openidService: ClubWechatOpenidService,
  ) {}

  /**
   * 为已创建的订单取一次支付参数。
   *
   * 调用方负责先校验归属与状态（订单存在、属于本人、仍待支付、未过期），
   * 本服务只处理「取参」这一件事，避免资金状态机散落到两个模块。
   */
  async createPaymentParams(
    params: ClubPrepayParams,
  ): Promise<ClubPrepayResult> {
    // 测试模式不向微信下单：与建单链路改前的口径完全一致
    if (await this.paymentModeService.isManualConfirmPaidAllowed()) {
      return { merchantPaymentNo: null, paymentParams: null, testMode: true };
    }

    const lockKey = `${PREPAY_LOCK_KEY_PREFIX}${params.baseOrderNo}`;
    const acquired = await this.redisService.setIfAbsent(
      lockKey,
      '1',
      PREPAY_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      throw params.buildError('in_flight');
    }

    try {
      return await this.requestPrepay(params);
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  /** 解析 openid → 分配尝试序号 → 微信下单 → 记录尝试状态 */
  private async requestPrepay(
    params: ClubPrepayParams,
  ): Promise<ClubPrepayResult> {
    const openid = await this.openidService.resolveOpenid(
      params.userId,
      params.openid,
    );
    // 解析不到 openid 时不下单（与改前降级口径一致）：前端拿不到参数就不会拉起支付
    if (!openid) {
      this.logger.warn(
        `取支付参数跳过微信下单（未解析到 openid）orderNo=${params.baseOrderNo} userId=${params.userId}`,
      );
      return { merchantPaymentNo: null, paymentParams: null, testMode: false };
    }

    const attemptSeq = await this.redisService.incr(
      `${PREPAY_SEQ_KEY_PREFIX}${params.baseOrderNo}`,
      PREPAY_SEQ_TTL_SECONDS,
    );
    if (attemptSeq > MAX_PREPAY_ATTEMPT_SEQ) {
      this.logger.error(
        `取支付参数尝试次数超限 orderNo=${params.baseOrderNo} seq=${attemptSeq}`,
      );
      throw params.buildError('exhausted');
    }

    const merchantPaymentNo = buildPrepayOutTradeNo(
      params.baseOrderNo,
      attemptSeq,
    );
    const attemptKey = `${PREPAY_ATTEMPT_KEY_PREFIX}${merchantPaymentNo}`;
    await this.persistAttempt(attemptKey, params.baseOrderNo, 'creating');

    try {
      const paymentParams = await this.jsapiService.createJsapiPaymentParams({
        storeId: params.storeId,
        orderNo: merchantPaymentNo,
        description: params.description,
        amountFen: params.amountFen,
        openid,
      });
      await this.persistAttempt(attemptKey, params.baseOrderNo, 'created');
      this.logger.log(
        `取支付参数成功 orderNo=${params.baseOrderNo} merchantOrderNo=${merchantPaymentNo}`,
      );
      return { merchantPaymentNo, paymentParams, testMode: false };
    } catch (error) {
      // 失败只标记本次尝试：序号已消耗，重试会换新单号，
      // 不会撞上微信「同一 out_trade_no 重复下单」的限制
      await this.persistAttempt(
        attemptKey,
        params.baseOrderNo,
        'failed',
        error,
      );
      throw error;
    }
  }

  /** 尝试状态留痕：仅用于排查「微信侧有单、本地无单」类问题，失败不影响主流程 */
  private async persistAttempt(
    attemptKey: string,
    baseOrderNo: string,
    status: 'creating' | 'created' | 'failed',
    error?: unknown,
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        attemptKey,
        {
          baseOrderNo,
          status,
          createdAtMs: Date.now(),
          ...(error
            ? {
                errorName: error instanceof Error ? error.name : 'UNKNOWN',
              }
            : {}),
        },
        PREPAY_ATTEMPT_TTL_SECONDS,
      );
    } catch (cacheError) {
      this.logger.warn(
        `支付尝试状态写入失败 orderNo=${baseOrderNo} status=${status} error=${
          cacheError instanceof Error ? cacheError.message : String(cacheError)
        }`,
      );
    }
  }

  /** 释放在途互斥：失败也不改写已抛出的业务错误 */
  private async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redisService.del(lockKey);
    } catch (error) {
      this.logger.warn(
        `释放在途互斥失败 key=${lockKey} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
