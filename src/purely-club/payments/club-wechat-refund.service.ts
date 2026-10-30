// 微信支付退款服务：调用 v3 退款接口（POST /v3/refund/domestic/refunds）
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

/** 微信退款响应（成功态） */
interface WechatRefundResponse {
  refund_id?: string;
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
  ): Promise<{ refundId: string }> {
    const target = await this.resolveRefundTarget(params);
    if (!target) {
      return this.degradeToDevRefund(params, '门店未配置收款商户号');
    }

    const privateKeyPem = await this.httpService.loadPrivateKeyPem(target.mode);
    if (!privateKeyPem && this.httpService.isProduction()) {
      this.logger.error(
        `退款签名私钥未配置，退款单 ${params.refundNo} 未真实发起（mode=${target.mode}）`,
      );
      throw new InternalServerErrorException(
        '微信支付签名凭据未配置，退款未发起，请联系平台管理员',
      );
    }

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
      return { refundId };
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

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  /**
   * 确定本次退款的收款主体。
   *
   * 【S0 资金口径】退款必须回到**原收款账户**。这里优先取订单自身记录的子商户号，
   * 只有在历史单据没记录（改造前落库的订单）时才回落到门店当前配置，并且必须告警：
   * 商家一旦换绑子商户，回落路径会把钱退到错误主体，是最难排查的一类资金事故。
   */
  private async resolveRefundTarget(
    params: WechatRefundRequest,
  ): Promise<RefundTarget | null> {
    const current = await this.identityService.resolveTarget(params.storeId);
    if (!current) {
      return null;
    }

    const record = await this.orderRecordService.findByOrderNo(params.orderNo);

    /*
     * 越权闸门：订单记录必须属于本次请求的门店。
     *
     * 「优先用订单落库的原收款商户号」是为了修「换绑子商户后退错主体」的资金事故，
     * 但它把「按门店取配置」换成了「按订单号取记录」——后者天然跨门店，
     * 一旦漏掉归属校验，拿着别家的订单号就能把别家商户的钱退掉（IDOR）。
     * 服务商模式下签名主体是同一个 sp_mchid，签名这一层拦不住，只能在这里拦。
     */
    if (record && record.storeId !== params.storeId) {
      this.logger.error(
        `退款归属校验失败：订单 ${params.orderNo} 属于门店 ${record.storeId}，` +
          `与本次请求的门店 ${params.storeId} 不一致，拒绝退款`,
      );
      throw new ForbiddenException('订单与门店不匹配，拒绝退款');
    }

    const recorded = record?.subMchId ?? null;
    if (!recorded) {
      this.logger.warn(
        `订单 ${params.orderNo} 未记录原收款子商户号，本次退款回落到门店 ${params.storeId} 当前配置 ` +
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
        `订单 ${params.orderNo} 的原收款商户号 ${recorded} 与门店当前配置 ${current.settleMchId} 不一致，` +
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
    params: WechatRefundRequest,
    reason: string,
  ): { refundId: string } {
    if (this.httpService.isProduction()) {
      this.logger.error(
        `退款单 ${params.refundNo} 未真实发起退款（${reason}），生产环境禁止降级为已退款`,
      );
      throw new InternalServerErrorException(
        '微信退款配置不完整，退款未发起，请联系客服处理',
      );
    }
    this.logger.warn(
      `非生产环境降级：退款单 ${params.refundNo} 未真实调用微信退款接口（${reason}）`,
    );
    return { refundId: `DEV_REFUND_${params.refundNo}` };
  }
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
