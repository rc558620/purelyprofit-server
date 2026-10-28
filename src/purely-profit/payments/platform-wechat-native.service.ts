/**
 * 平台侧微信支付 Native（扫码）下单 / 查单 / 关单服务。
 *
 * 资金流向：**商家 / 门店付钱给平台**，店维度随场景不同包括
 * 短信钱包充值、平台会员开通与续费、新客额度充值等。
 * 与门店微信收款（purelyClub 顾客付钱给商家，配置在 stores_wechat_pay 表）
 * 是两条完全独立的资金流，因此本服务**不读任何门店配置**，一律使用平台级商户号：
 *   - wechat.payMchId   平台收款商户号（WECHAT_PAY_MCH_ID）
 *   - wechat.appId      平台小程序 / 公众号 AppID
 *   - wechat.mchSerialNo 商户 API 证书序列号
 *   - wechat.privateKey* 商户 API 私钥（文件优先，其次内联）
 *
 * 认证方式：WECHATPAY2-SHA256-RSA2048（商户私钥签名），与 club 侧 JSAPI 一致。
 * 签名与私钥加载统一由 `PlatformWechatPayHttpService` 承担，本服务只表达业务语义。
 *
 * ⚠️ 回调地址（notify_url）由**调用方按自己的业务路由显式传入**：
 * 各条链路的回调路由互不相同，一旦混用会出现「用户已付款、业务没到账」且无报错，
 * 因此这里刻意不提供任何回落默认值（宁可下单失败让人去配，也不静默打错地方）。
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformWechatPayHttpService } from './platform-wechat-pay-http.service';

/** Native（扫码）下单路径 */
const WECHAT_NATIVE_ORDER_PATH = '/v3/pay/transactions/native';

/** 关单路径：out_trade_no 是路径段，必须编码后再拼，避免单号里的字符破坏 URL */
const buildWechatCloseOrderPath = (orderNo: string): string =>
  `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close`;

/**
 * 关单接口**参与签名**的 canonical url。
 *
 * 微信 v3 要求签名用未编码的原始 path，编码只作用于实际请求 URL；
 * 两者混用会在订单号含保留字符时出现「URL 能通、签名对不上」。
 */
const buildWechatCloseOrderSignPath = (orderNo: string): string =>
  `/v3/pay/transactions/out-trade-no/${orderNo}/close`;

/** 查单路径：单号是路径段，必须编码后再拼（商户号走 query，由传输层拼装） */
const buildWechatQueryOrderPath = (orderNo: string): string =>
  `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}`;

/**
 * 查单接口**参与签名**的 canonical url path（不含 query）。
 *
 * 与关单同理：签名用未编码的原始单号。query（`?mchid=`）由传输层统一拼接，
 * 避免签名与请求两处各拼一次而对不上。
 */
const buildWechatQueryOrderSignPath = (orderNo: string): string =>
  `/v3/pay/transactions/out-trade-no/${orderNo}`;

export interface CreatePlatformNativeOrderParams {
  /** 业务订单号（同一商户号下必须唯一） */
  orderNo: string;
  /** 金额，单位：分。始终由后端计算，前端不得提供 */
  amountFen: number;
  /** 商品 / 服务描述，会展示在微信支付凭证上 */
  description: string;
  /** 该业务链路专属的支付回调地址（公网 HTTPS） */
  notifyUrl: string;
  /**
   * 业务链路标记（如 `sms_recharge`），只用于日志定位。
   *
   * 下单能力上浮为公共服务后，日志类名不再随业务变化，
   * 运维按类名检索会失真；因此由调用方显式带上自己的链路标识。
   */
  bizType?: string;
}

interface WechatNativeOrderResponse {
  code_url?: string;
}

/**
 * 关单结果。
 *
 * - `closed`：微信侧已不可支付（含「订单在微信侧不存在」），本地可以放心关单；
 * - `paid`：用户其实已经付过钱，只是回调还在路上 —— 绝不能按关单处理，
 *   否则会出现「本地显示超时未付、钱已扣、额度靠回调补」的错位。
 */
export type WechatCloseOrderResult = 'closed' | 'paid';

/**
 * 微信交易状态；`UNKNOWN` 表示返回了文档外的值。
 *
 * 调用方必须把 `UNKNOWN` 当「结果不确定」处理 —— 与「未支付」混为一谈
 * 会在微信返回异常时误关掉一笔其实已付款的单。
 */
export type PlatformWechatTradeState =
  | 'SUCCESS'
  | 'NOTPAY'
  | 'CLOSED'
  | 'REVOKED'
  | 'PAYERROR'
  | 'ACCEPT'
  | 'REFUND'
  | 'UNKNOWN';

/** 微信查单返回的交易快照（对账与补入账的事实来源） */
export interface PlatformWechatOrderSnapshot {
  tradeState: PlatformWechatTradeState;
  /** 微信支付订单号；SUCCESS 时应非空，入账前由调用方强制校验 */
  transactionId: string | null;
  /** 微信侧实收金额（分）；入账前必须与本地落单金额严格比对 */
  amountFen: number | null;
  /** 微信侧支付完成时间；未支付为 null */
  paidAt: Date | null;
}

/** 查单响应体（仅取用得到的字段） */
interface WechatQueryOrderResponse {
  trade_state?: string;
  transaction_id?: string;
  success_time?: string;
  amount?: { total?: number };
}

const KNOWN_TRADE_STATES: readonly PlatformWechatTradeState[] = [
  'SUCCESS',
  'NOTPAY',
  'CLOSED',
  'REVOKED',
  'PAYERROR',
  'ACCEPT',
  'REFUND',
];

/**
 * 查单响应 → 内部快照。
 *
 * 文档外的交易状态一律收敛为 `UNKNOWN`：宁可让调用方本轮什么都不做，
 * 也不能让它按「未支付」去关单。
 */
function toOrderSnapshot(
  payload: WechatQueryOrderResponse | null,
): PlatformWechatOrderSnapshot {
  const tradeState =
    KNOWN_TRADE_STATES.find((state) => state === payload?.trade_state) ??
    'UNKNOWN';
  const paidAtMs = payload?.success_time
    ? Date.parse(payload.success_time)
    : Number.NaN;

  return {
    tradeState,
    transactionId: payload?.transaction_id ?? null,
    amountFen: payload?.amount?.total ?? null,
    paidAt: Number.isFinite(paidAtMs) ? new Date(paidAtMs) : null,
  };
}

@Injectable()
export class PlatformWechatNativeService {
  private readonly logger = new Logger(PlatformWechatNativeService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly wechatPayHttpService: PlatformWechatPayHttpService,
  ) {}

  /** 调用微信 Native 下单，返回可渲染成二维码的 code_url */
  async createNativeOrder(
    params: CreatePlatformNativeOrderParams,
  ): Promise<{ codeUrl: string }> {
    const bizTag = this.formatBizTag(params.bizType);
    const mchId = this.getPlatformMchId();
    const appId = this.getRequiredConfig('wechat.appId');

    const body = JSON.stringify({
      appid: appId,
      mchid: mchId,
      description: params.description,
      out_trade_no: params.orderNo,
      notify_url: params.notifyUrl,
      amount: { total: params.amountFen, currency: 'CNY' },
    });

    const result =
      await this.wechatPayHttpService.request<WechatNativeOrderResponse>({
        method: 'POST',
        urlPath: WECHAT_NATIVE_ORDER_PATH,
        mchId,
        body,
      });

    if (!result.ok) {
      this.logger.error(
        `微信 Native 下单失败${bizTag}: ${result.code ?? 'UNKNOWN'} - ${result.message}`,
      );
      throw new InternalServerErrorException(
        `微信支付下单失败：${result.message || '请联系平台管理员'}`,
      );
    }

    if (!result.data?.code_url) {
      throw new InternalServerErrorException(
        '微信支付返回数据异常，code_url 为空',
      );
    }

    return { codeUrl: result.data.code_url };
  }

  /**
   * 关闭微信侧订单。
   *
   * 只关本地单是不够的：微信二维码有效期是 2 小时，本地 15 分钟就把单标成 closed，
   * 用户在 15 分钟～2 小时之间扫码仍能付款成功，就会出现「前端已放弃轮询、钱照扣」。
   * 所以本地关单之前必须先调这里，把微信侧也关掉。
   */
  async closeNativeOrder(
    orderNo: string,
    bizType?: string,
  ): Promise<WechatCloseOrderResult> {
    const bizTag = this.formatBizTag(bizType);
    const mchId = this.getPlatformMchId();

    const result = await this.wechatPayHttpService.request<null>({
      method: 'POST',
      urlPath: buildWechatCloseOrderPath(orderNo),
      mchId,
      body: JSON.stringify({ mchid: mchId }),
      // 签名用未编码 path，请求用编码后的 path：两者不能混用
      signPath: buildWechatCloseOrderSignPath(orderNo),
    });

    // 关单成功固定返回 204 No Content，没有响应体
    if (result.ok) {
      return 'closed';
    }

    // 用户其实已经付过钱：回调只是还没到，此时绝不能把单当超时关掉
    if (result.code === 'ORDERPAID') {
      this.logger.warn(
        `微信关单发现订单已支付${bizTag} orderNo=${orderNo}，保持 pending 等待回调`,
      );
      return 'paid';
    }

    // 微信侧根本没有这笔单（未下单成功/已被微信回收），等价于「不可支付」
    if (result.code === 'ORDER_NOT_EXIST') {
      return 'closed';
    }

    this.logger.error(
      `微信关单失败${bizTag} orderNo=${orderNo}: ${result.code ?? 'UNKNOWN'} - ${result.message}`,
    );
    throw new InternalServerErrorException('微信支付关单失败，请稍后重试');
  }

  /**
   * 按商户订单号主动查询微信侧交易状态。
   *
   * 用途：回调丢失（隧道地址变更 / 进程重启 / 网络抖动）后的兜底补救。
   * 与 `closeNativeOrder` 的关键区别是**无任何副作用** —— 只问微信，不动本地状态。
   *
   * @param orderNo 平台支付单号（即微信 out_trade_no）
   * @param bizType 业务链路标记，仅用于日志定位
   * @returns 微信侧交易快照；**微信侧查不到该单时返回 `null`**
   * @throws 网络异常或微信返回非预期错误码时抛错，调用方应保持订单 pending 等下轮重试
   *
   * ⚠️ `null`（查不到）与 `tradeState = 'NOTPAY'`（查到但未支付）语义完全不同：
   *    前者通常是本地单残留 / 微信侧回收，后者才是「确认未支付」。
   *    调用方绝不能把 `null` 当未支付去关单。
   */
  async queryNativeOrder(
    orderNo: string,
    bizType?: string,
  ): Promise<PlatformWechatOrderSnapshot | null> {
    const bizTag = this.formatBizTag(bizType);
    const mchId = this.getPlatformMchId();

    const result =
      await this.wechatPayHttpService.request<WechatQueryOrderResponse>({
        method: 'GET',
        urlPath: buildWechatQueryOrderPath(orderNo),
        mchId,
        query: `mchid=${mchId}`,
        // 签名用未编码单号；GET 无请求体，签名串末尾两个 \n
        signPath: buildWechatQueryOrderSignPath(orderNo),
      });

    if (result.ok) {
      return toOrderSnapshot(result.data);
    }

    // 微信侧没有这笔单：与「已下单但未支付」是两回事，交给调用方区分处理
    if (result.code === 'ORDER_NOT_EXIST') {
      this.logger.warn(
        `微信查单未找到订单${bizTag} orderNo=${orderNo}，本轮跳过不关单`,
      );
      return null;
    }

    this.logger.error(
      `微信查单失败${bizTag} orderNo=${orderNo}: ${result.code ?? 'UNKNOWN'} - ${result.message}`,
    );
    throw new InternalServerErrorException('微信支付查单失败，请稍后重试');
  }

  // ─── 私有辅助 ─────────────────────────────────────────────────────────────

  /** 日志用的业务链路标记，未传时返回空串（保持日志格式稳定） */
  private formatBizTag(bizType?: string): string {
    return bizType ? ` [bizType=${bizType}]` : '';
  }

  private getRequiredConfig(key: string): string {
    return this.wechatPayHttpService.getRequiredConfig(key);
  }

  /**
   * 平台收款商户号。
   *
   * 缺失时报错文案指向**平台管理员**而不是商家：这几条链路都是付钱给平台，
   * 商家既看不到也改不了这份配置，让商家「前往门店设置」纯属误导。
   */
  private getPlatformMchId(): string {
    const mchId = this.configService.get<string>('wechat.payMchId')?.trim();
    if (!mchId) {
      throw new InternalServerErrorException(
        '平台微信收款未配置（WECHAT_PAY_MCH_ID），相关支付暂不可用，请联系平台管理员',
      );
    }
    return mchId;
  }
}
