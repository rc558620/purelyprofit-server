// 微信支付退款服务：调用 v3 退款接口（POST /v3/refund/domestic/refunds）
import { CLUB_PAY_ERROR_CODE, clubPayError } from './club-pay.errors';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ClubPaymentOrderRecordService } from './club-payment-order-record.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';

/** 微信退款请求入参 */
export interface WechatRefundRequest {
  storeId: number;
  /** 原支付订单号（out_trade_no） */
  orderNo: string;
  /** 商户退款单号（out_refund_no，幂等键） */
  refundNo: string;
  /** 原支付金额（分） */
  totalFen: number;
  /** 退款金额（分） */
  refundFen: number;
  /** 退款原因 */
  reason?: string;
}

/**
 * 微信退款单状态。
 * - SUCCESS：退款成功（唯一可以落「已退款」的终态）
 * - PROCESSING：已受理但未完成，必须继续查单，不能落终态
 * - ABNORMAL：退款异常（需人工处理），不能落终态
 * - CLOSED：退款关闭（未出款）
 * - NOT_FOUND：微信侧无此退款单（上次请求未到达）
 * - UNKNOWN：微信返回了未识别状态，按「未确认」处理
 */
export type WechatRefundStatus =
  | 'SUCCESS'
  | 'PROCESSING'
  | 'ABNORMAL'
  | 'CLOSED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

/** 发起/查询退款的统一结果 */
export interface WechatRefundResult {
  /** 微信退款单号（NOT_FOUND 时为空串） */
  refundId: string;
  status: WechatRefundStatus;
}

/** 微信退款响应（发起与查单返回同一结构） */
interface WechatRefundResponse {
  refund_id?: string;
  status?: string;
  success_time?: string;
  message?: string;
  code?: string;
}

/** 本次退款实际使用的收款主体 */
interface RefundTarget {
  mode: 'store' | 'partner';
  /** 签名主体：服务商模式下恒为服务商商户号 */
  signMchId: string;
  /** 原收款商户号：直连模式下必须等于 signMchId */
  settleMchId: string;
  /** 是否取自订单自身记录（false = 回落到门店当前配置，属兜底路径） */
  fromRecord: boolean;
}

const REFUND_PATH = '/v3/refund/domestic/refunds';

@Injectable()
export class ClubWechatRefundService {
  private readonly logger = new Logger(ClubWechatRefundService.name);

  constructor(
    private readonly httpService: ClubWechatPayHttpService,
    private readonly identityService: ClubWechatPayIdentityService,
    private readonly orderRecordService: ClubPaymentOrderRecordService,
  ) {}

  /**
   * 发起微信退款（v3 真实接口）。
   *
   * 配置不完整时 fail-closed：生产环境直接抛错（绝不能标记已退款），
   * 非生产环境保留本地联调降级通道以便跑通退款流程。
   */
  async requestRefund(
    params: WechatRefundRequest,
  ): Promise<WechatRefundResult> {
    const target = await this.resolveRefundTarget(
      params.storeId,
      params.orderNo,
    );
    if (!target) {
      return this.degradeToDevRefund(params.refundNo, '门店未配置收款商户号');
    }
    await this.ensureSignable(target, params.refundNo);

    const result = await this.httpService.request<WechatRefundResponse>({
      method: 'POST',
      urlPath: REFUND_PATH,
      mchId: target.signMchId,
      credential: target.mode,
      body: buildRefundBody(params, target),
    });

    if (result.ok) {
      const refundId = result.data?.refund_id;
      if (!refundId) {
        throw new InternalServerErrorException('微信退款返回数据异常');
      }
      // 受理成功不等于退款成功：PROCESSING 必须留给上层继续查单，不能当成「已退款」
      return {
        refundId,
        status: normalizeRefundStatus(result.data?.status),
      };
    }

    this.logger.error(
      `微信退款失败 orderNo=${params.orderNo} refundNo=${params.refundNo} mode=${target.mode} ` +
        `signMchId=${target.signMchId} settleMchId=${target.settleMchId} fromRecord=${target.fromRecord} ` +
        `httpStatus=${result.status} wechatCode=${result.code ?? 'UNKNOWN'} message=${result.message ?? ''}`,
    );
    throw new InternalServerErrorException(
      `微信退款失败：${result.message || '请联系客服'}`,
    );
  }

  /**
   * 查询微信退款单当前状态（GET /v3/refund/domestic/refunds/{out_refund_no}）。
   *
   * 用于「退款受理成功但状态不是 SUCCESS」后的补齐：只有查到 SUCCESS 才允许把本地订单
   * 落成已退款；PROCESSING 继续等待；ABNORMAL / CLOSED 说明钱没退成功，必须释放占位。
   */
  async queryRefund(params: {
    storeId: number;
    orderNo: string;
    refundNo: string;
  }): Promise<WechatRefundResult> {
    const target = await this.resolveRefundTarget(
      params.storeId,
      params.orderNo,
    );
    if (!target) {
      return this.degradeToDevRefund(params.refundNo, '门店未配置收款商户号');
    }
    await this.ensureSignable(target, params.refundNo);

    const result = await this.httpService.request<WechatRefundResponse>({
      method: 'GET',
      urlPath: `${REFUND_PATH}/${encodeURIComponent(params.refundNo)}`,
      mchId: target.signMchId,
      credential: target.mode,
    });

    if (result.ok) {
      return {
        refundId: result.data?.refund_id ?? '',
        status: normalizeRefundStatus(result.data?.status),
      };
    }

    // 微信明确「无此退款单」：上次请求没有到达微信，可按未发起处理
    if (result.code === 'RESOURCE_NOT_EXISTS') {
      return { refundId: '', status: 'NOT_FOUND' };
    }

    this.logger.error(
      `微信退款查单失败 orderNo=${params.orderNo} refundNo=${params.refundNo} mode=${target.mode} ` +
        `httpStatus=${result.status} wechatCode=${result.code ?? 'UNKNOWN'} message=${result.message ?? ''}`,
    );
    throw new InternalServerErrorException(
      '微信退款查单失败，退款状态未确认，请稍后重试',
    );
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  /**
   * 确定本次退款的收款主体。
   *
   * 【S0 资金口径】退款必须回到**原收款账户**。这里优先取订单自身记录的子商户号，
   * 只有在历史单据没记录（改造前落库的订单）时才回落到门店当前配置，并且必须告警：
   * 商家一旦换绑子商户，回落路径会把钱退到错误主体，是最难排查的一类资金事故。
   */
  private async resolveRefundTarget(
    storeId: number,
    orderNo: string,
  ): Promise<RefundTarget | null> {
    const current = await this.identityService.resolveTarget(storeId);
    if (!current) {
      return null;
    }

    const record = await this.orderRecordService.findByOrderNo(orderNo);

    /*
     * 越权闸门：订单记录必须属于本次请求的门店。
     *
     * 「优先用订单落库的原收款商户号」是为了修「换绑子商户后退错主体」的资金事故，
     * 但它把「按门店取配置」换成了「按订单号取记录」——后者天然跨门店，
     * 一旦漏掉归属校验，拿着别家的订单号就能把别家商户的钱退掉（IDOR）。
     * 服务商模式下签名主体是同一个 sp_mchid，签名这一层拦不住，只能在这里拦。
     */
    if (record && record.storeId !== storeId) {
      this.logger.error(
        `退款归属校验失败：订单 ${orderNo} 属于门店 ${record.storeId}，` +
          `与本次请求的门店 ${storeId} 不一致，拒绝退款`,
      );
      throw new ForbiddenException(
        clubPayError(
          CLUB_PAY_ERROR_CODE.AUTH_REFUND_STORE_MISMATCH,
          '订单与门店不匹配，拒绝退款',
        ),
      );
    }

    const recorded = record?.subMchId ?? null;
    if (!recorded) {
      this.logger.warn(
        `订单 ${orderNo} 未记录原收款子商户号，本次退款回落到门店 ${storeId} 当前配置 ` +
          `settleMchId=${current.settleMchId}（历史单据或改造前落库，请核对商户号是否已变更）`,
      );
      return {
        mode: current.mode,
        signMchId: current.signMchId,
        settleMchId: current.settleMchId,
        fromRecord: false,
      };
    }

    if (recorded !== current.settleMchId) {
      this.logger.warn(
        `订单 ${orderNo} 的原收款商户号 ${recorded} 与门店当前配置 ${current.settleMchId} 不一致，` +
          '按原收款主体退款（门店可能已换绑子商户号）',
      );
    }

    // 服务商模式下签名主体恒为服务商商户号；直连模式下收款方即签名主体
    const signMchId = current.mode === 'partner' ? current.signMchId : recorded;
    return {
      mode: current.mode,
      signMchId,
      settleMchId: recorded,
      fromRecord: true,
    };
  }

  /**
   * 非生产环境的本地联调通道。
   *
   * 早期实现的「DEV_REFUND_ 降级」会让系统显示已退款而钱根本没退，
   * 因此这里保留降级但强制生产环境拦截，并留下可检索日志。
   */
  private degradeToDevRefund(
    refundNo: string,
    reason: string,
  ): WechatRefundResult {
    if (this.httpService.isProduction()) {
      this.logger.error(
        `退款单 ${refundNo} 未真实发起退款（${reason}），生产环境禁止降级为已退款`,
      );
      throw new InternalServerErrorException(
        '微信退款配置不完整，退款未发起，请联系客服处理',
      );
    }
    this.logger.warn(
      `非生产环境降级：退款单 ${refundNo} 未真实调用微信退款接口（${reason}）`,
    );
    return { refundId: `DEV_REFUND_${refundNo}`, status: 'SUCCESS' };
  }

  /** 生产环境缺少签名私钥时 fail-fast：没有凭据的请求必然被微信拒绝 */
  private async ensureSignable(
    target: RefundTarget,
    refundNo: string,
  ): Promise<void> {
    const privateKeyPem = await this.httpService.loadPrivateKeyPem(target.mode);
    if (privateKeyPem || !this.httpService.isProduction()) {
      return;
    }
    this.logger.error(
      `退款签名私钥未配置，退款单 ${refundNo} 未真实发起（mode=${target.mode}）`,
    );
    throw new InternalServerErrorException(
      '微信支付签名凭据未配置，退款未发起，请联系平台管理员',
    );
  }
}

/** 微信退款状态归一化：未识别值一律按未确认处理，禁止默认成 SUCCESS */
function normalizeRefundStatus(value: string | undefined): WechatRefundStatus {
  if (
    value === 'SUCCESS' ||
    value === 'PROCESSING' ||
    value === 'ABNORMAL' ||
    value === 'CLOSED'
  ) {
    return value;
  }
  return 'UNKNOWN';
}

/**
 * 组装退款请求体。
 *
 * 服务商模式下钱子序列必须靠 body 里的 sub_mchid 指定原收款子商户，
 * 只靠 Authorization 里的服务商商户号是不够的（那是请求主体，不是收款方）。
 */
function buildRefundBody(
  params: WechatRefundRequest,
  target: RefundTarget,
): string {
  const common = {
    out_trade_no: params.orderNo,
    out_refund_no: params.refundNo,
    reason: params.reason ?? '用户主动退款',
    amount: {
      refund: params.refundFen,
      total: params.totalFen,
      currency: 'CNY',
    },
  };

  if (target.mode === 'partner') {
    return JSON.stringify({ ...common, sub_mchid: target.settleMchId });
  }
  return JSON.stringify({ ...common, mchid: target.settleMchId });
}
