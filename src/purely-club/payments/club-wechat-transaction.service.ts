/**
 * 微信支付订单查询 / 关闭（purely-club · C 端门店收款链路）。
 *
 * 解决两类「钱付了但系统不知道」的资金事故：
 *
 * 1. 查单（D2 / D3）：`wx.requestPayment` 结果未知（小程序被杀、回调未达）时，
 *    前端不能按失败提示「请重试」——用户可能已扣款，重试会造成重复支付。
 *    必须回微信侧按 out_trade_no 查真实状态。
 * 2. 关单（E2）：本地订单过期但微信侧未关单时，用户仍能在微信有效期内付款，
 *    出现「前端已放弃、钱照扣」。所以本地翻转 expired 之前必须先关微信侧订单。
 *
 * ⚠️ 商户号**不再直接取自门店配置**：统一经 {@link ClubWechatPayIdentityService} 解析
 * （服务商模式下签名主体是服务商商户号、查询对象是子商户号），此处禁止自行拼商户号。
 *
 * 服务商改造后：
 *   查单 GET  /v3/pay/partner/transactions/out-trade-no/{no}?sp_mchid=&sub_mchid=
 *   关单 POST /v3/pay/partner/transactions/out-trade-no/{no}/close，body {sp_mchid, sub_mchid}
 * 签名主体一律是服务商商户号，代表查询/操作对象的是子商户号。
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type {
  ClubWechatPayTarget,
  WechatPayCollectionMode,
} from './club-wechat-pay-identity.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';

/** 微信交易状态；`UNKNOWN` 表示返回了文档外的值，调用方应按「不确定」处理 */
export type WechatTradeState =
  | 'SUCCESS'
  | 'NOTPAY'
  | 'CLOSED'
  | 'REVOKED'
  | 'PAYERROR'
  | 'ACCEPT'
  | 'REFUND'
  | 'UNKNOWN';

export interface WechatTransactionSnapshot {
  tradeState: WechatTradeState;
  /** 微信支付订单号，落账与对账的主键 */
  transactionId: string | null;
  /** 微信侧支付完成时间（毫秒）；未支付为 null */
  paidAtMs: number | null;
  /** 微信侧实际收款金额（分），用于与本地订单金额比对 */
  amountFen: number | null;
}

export type WechatTransactionQueryResult =
  | { found: false; code: string | null }
  | { found: true; snapshot: WechatTransactionSnapshot };

/**
 * 关单结果。
 *
 * - `closed`：微信侧已不可支付（含「订单在微信侧不存在」），本地可放心翻转 expired；
 * - `paid`：用户其实已经付过钱，只是回调还在路上 —— 绝不能关本地单，
 *   否则会出现「本地显示超时未付、钱已扣、靠迟到回调补落账」的错位。
 */
export type WechatCloseOrderResult = 'closed' | 'paid';

/** 微信查询原始响应体（仅取用得到的字段） */
interface WechatTransactionResponse {
  trade_state?: string;
  transaction_id?: string;
  success_time?: string;
  amount?: { total?: number };
}

const KNOWN_TRADE_STATES: readonly WechatTradeState[] = [
  'SUCCESS',
  'NOTPAY',
  'CLOSED',
  'REVOKED',
  'PAYERROR',
  'ACCEPT',
  'REFUND',
];

@Injectable()
export class ClubWechatTransactionService {
  private readonly logger = new Logger(ClubWechatTransactionService.name);

  constructor(
    private readonly identityService: ClubWechatPayIdentityService,
    private readonly wechatPayHttpService: ClubWechatPayHttpService,
  ) {}

  /**
   * 按商户订单号查询微信侧真实交易状态。
   *
   * 门店未配置收款时返回 `found: false`（下单时就被拦下，走到这里说明是历史单）；
   * 微信侧不存在该单号同样返回 `found: false`。
   */
  async queryByOutTradeNo(params: {
    storeId: number;
    orderNo: string;
  }): Promise<WechatTransactionQueryResult> {
    const target = await this.identityService.resolveTarget(params.storeId);
    if (!target) {
      return { found: false, code: 'STORE_MCH_NOT_CONFIGURED' };
    }

    const urlPath = this.buildTransactionPath(target.mode, params.orderNo);
    const result =
      await this.wechatPayHttpService.request<WechatTransactionResponse>({
        method: 'GET',
        urlPath,
        mchId: target.signMchId,
        credential: target.mode,
        query: this.buildMerchantQuery(target),
      });

    if (!result.ok) {
      // 微信侧没有这笔单：可能是本地单，或已被微信回收，等价于「未支付」
      this.logger.warn(
        `微信查单失败 orderNo=${params.orderNo} storeId=${params.storeId} mode=${target.mode} ` +
          `signMchId=${target.signMchId} settleMchId=${target.settleMchId} ` +
          `httpStatus=${result.status} wechatCode=${result.code ?? 'UNKNOWN'}`,
      );
      return { found: false, code: result.code };
    }

    return {
      found: true,
      snapshot: this.toSnapshot(result.data),
    };
  }

  /**
   * 关闭微信侧订单。
   *
   * 结果未知（网络异常 / 未预期错误码）时**抛异常**：调用方必须保持订单 pending
   * 等下次重试，绝不能当作已关闭去翻转本地单（E3）。
   */
  async closeOrder(params: {
    storeId: number;
    orderNo: string;
  }): Promise<WechatCloseOrderResult> {
    const target = await this.identityService.resolveTarget(params.storeId);
    if (!target) {
      // 门店没有收款配置就不可能有微信侧订单，等价于已关闭
      return 'closed';
    }

    const urlPath = `${this.buildTransactionPath(target.mode, params.orderNo)}/close`;
    const result = await this.wechatPayHttpService.request<null>({
      method: 'POST',
      urlPath,
      mchId: target.signMchId,
      credential: target.mode,
      body: this.buildCloseBody(target),
    });

    if (result.ok) {
      return 'closed';
    }

    // 用户其实已经付过钱：回调只是还没到，此时绝不能把单当超时关掉
    if (result.code === 'ORDERPAID') {
      this.logger.warn(
        `微信关单发现订单已支付 orderNo=${params.orderNo} storeId=${params.storeId}，保持 pending 等待回调`,
      );
      return 'paid';
    }

    // 微信侧根本没有这笔单（未下单成功 / 已被微信回收），等价于「不可支付」
    if (result.code === 'ORDER_NOT_EXIST') {
      return 'closed';
    }

    this.logger.error(
      `微信关单失败 orderNo=${params.orderNo} storeId=${params.storeId} ` +
        `httpStatus=${result.status} wechatCode=${result.code ?? 'UNKNOWN'} message=${result.message}`,
    );
    throw new InternalServerErrorException('微信支付关单失败，请稍后重试');
  }

  // ─── 私有辅助 ─────────────────────────────────────────────────────────────

  /** 查单 / 关单共用的交易路径：服务商模式下多了 `/partner` 段 */
  private buildTransactionPath(
    mode: WechatPayCollectionMode,
    orderNo: string,
  ): string {
    const prefix =
      mode === 'partner'
        ? '/v3/pay/partner/transactions/out-trade-no'
        : '/v3/pay/transactions/out-trade-no';
    return `${prefix}/${encodeURIComponent(orderNo)}`;
  }

  /** 查单 query：服务商模式要同时带上服务商号与子商户号，二者缺一不可 */
  private buildMerchantQuery(target: ClubWechatPayTarget): string {
    if (target.mode === 'partner') {
      return `sp_mchid=${encodeURIComponent(target.signMchId)}&sub_mchid=${encodeURIComponent(target.settleMchId)}`;
    }
    return `mchid=${encodeURIComponent(target.settleMchId)}`;
  }

  /** 关单 body：服务商模式下靠 sub_mchid 指定要关哪笔收款 */
  private buildCloseBody(target: ClubWechatPayTarget): string {
    if (target.mode === 'partner') {
      return JSON.stringify({
        sp_mchid: target.signMchId,
        sub_mchid: target.settleMchId,
      });
    }
    return JSON.stringify({ mchid: target.settleMchId });
  }

  private toSnapshot(
    payload: WechatTransactionResponse | null,
  ): WechatTransactionSnapshot {
    const rawState = payload?.trade_state ?? '';
    const tradeState = KNOWN_TRADE_STATES.find((state) => state === rawState);
    const paidAtMs = payload?.success_time
      ? Date.parse(payload.success_time)
      : null;

    return {
      tradeState: tradeState ?? 'UNKNOWN',
      transactionId: payload?.transaction_id ?? null,
      paidAtMs: Number.isFinite(paidAtMs) ? paidAtMs : null,
      amountFen: payload?.amount?.total ?? null,
    };
  }
}
