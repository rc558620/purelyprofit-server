/**
 * 平台侧微信支付 Native（扫码）下单服务。
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
 *
 * ⚠️ 回调地址（notify_url）由**调用方按自己的业务路由显式传入**：
 * 各条链路的回调路由互不相同，一旦混用会出现「用户已付款、业务没到账」且无报错，
 * 因此这里刻意不提供任何回落默认值（宁可下单失败让人去配，也不静默打错地方）。
 */
import { readFile } from 'node:fs/promises';
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 微信支付 API v3 基址 */
const WECHAT_API_BASE = 'https://api.mch.weixin.qq.com';

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

/**
 * 微信 API 请求超时（毫秒）。
 *
 * 微信侧挂起时若不设上限，下单 / 关单会无限等待，把 Node 事件循环里的
 * 连接和上层请求一起拖住；框架层的 requestTimeout 只断客户端，不会中断 fetch。
 */
const WECHAT_REQUEST_TIMEOUT_MS = 8000;

/** 私钥缓存有效期：5 分钟，支持证书热更新而不必重启 */
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/** 未配置私钥时的占位签名：请求会被微信拒绝，但不会让本地链路崩溃 */
const DEV_PLACEHOLDER_SIGNATURE = 'DEV_MODE_NO_RSA_KEY';

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

interface WechatErrorResponse {
  code?: string;
  message?: string;
}

/**
 * 关单结果。
 *
 * - `closed`：微信侧已不可支付（含「订单在微信侧不存在」），本地可以放心关单；
 * - `paid`：用户其实已经付过钱，只是回调还在路上 —— 绝不能按关单处理，
 *   否则会出现「本地显示超时未付、钱已扣、额度靠回调补」的错位。
 */
export type WechatCloseOrderResult = 'closed' | 'paid';

@Injectable()
export class PlatformWechatNativeService {
  private readonly logger = new Logger(PlatformWechatNativeService.name);

  private cachedPrivateKeyPem: string | null | undefined = undefined;
  private cachedPrivateKeyPemLoadedAt = 0;
  /** 正在进行的私钥加载：并发请求共用同一次 IO，避免缓存失效瞬间重复 readFile */
  private privateKeyLoadInFlight: Promise<string | null> | null = null;

  constructor(private readonly configService: ConfigService) {}

  /** 调用微信 Native 下单，返回可渲染成二维码的 code_url */
  async createNativeOrder(
    params: CreatePlatformNativeOrderParams,
  ): Promise<{ codeUrl: string }> {
    const mchId = this.getPlatformMchId();
    const appId = this.getRequiredConfig('wechat.appId');
    const serialNo = this.getRequiredConfig('wechat.mchSerialNo');
    const privateKeyPem = await this.loadPrivateKeyPem();

    const body = JSON.stringify({
      appid: appId,
      mchid: mchId,
      description: params.description,
      out_trade_no: params.orderNo,
      notify_url: params.notifyUrl,
      amount: { total: params.amountFen, currency: 'CNY' },
    });

    const authorization = this.buildAuthorization({
      mchId,
      serialNo,
      privateKeyPem,
      body,
      urlPath: WECHAT_NATIVE_ORDER_PATH,
    });

    return this.requestCodeUrl(body, authorization, params.bizType);
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
    const serialNo = this.getRequiredConfig('wechat.mchSerialNo');
    const privateKeyPem = await this.loadPrivateKeyPem();
    const urlPath = buildWechatCloseOrderPath(orderNo);
    const body = JSON.stringify({ mchid: mchId });
    const authorization = this.buildAuthorization({
      mchId,
      serialNo,
      privateKeyPem,
      body,
      // 签名用未编码 path，请求用编码后的 path：两者不能混用
      urlPath: buildWechatCloseOrderSignPath(orderNo),
    });

    let response: Response;
    try {
      response = await fetch(`${WECHAT_API_BASE}${urlPath}`, {
        method: 'POST',
        headers: this.buildHeaders(authorization),
        body,
        signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`微信关单网络异常${bizTag} orderNo=${orderNo}`, error);
      throw new InternalServerErrorException(
        '微信支付服务暂时不可用，请稍后重试',
      );
    }

    // 关单成功固定返回 204 No Content，没有响应体，不能去读 json
    if (response.ok) {
      return 'closed';
    }

    const errorPayload = await this.readErrorPayload(response);

    // 用户其实已经付过钱：回调只是还没到，此时绝不能把单当超时关掉
    if (errorPayload?.code === 'ORDERPAID') {
      this.logger.warn(
        `微信关单发现订单已支付${bizTag} orderNo=${orderNo}，保持 pending 等待回调`,
      );
      return 'paid';
    }

    // 微信侧根本没有这笔单（未下单成功/已被微信回收），等价于「不可支付」
    if (errorPayload?.code === 'ORDER_NOT_EXIST') {
      return 'closed';
    }

    this.logger.error(
      `微信关单失败${bizTag} orderNo=${orderNo}: ${errorPayload?.code ?? 'UNKNOWN'} - ${errorPayload?.message ?? ''}`,
    );
    throw new InternalServerErrorException('微信支付关单失败，请稍后重试');
  }

  /** 日志用的业务链路标记，未传时返回空串（保持日志格式稳定） */
  private formatBizTag(bizType?: string): string {
    return bizType ? ` [bizType=${bizType}]` : '';
  }

  /** 安全读取微信错误响应体（204 或非 JSON 时返回 null） */
  private async readErrorPayload(
    response: Response,
  ): Promise<WechatErrorResponse | null> {
    try {
      return (await response.json()) as WechatErrorResponse;
    } catch {
      return null;
    }
  }

  /** 微信支付 API v3 统一请求头 */
  private buildHeaders(authorization: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authorization,
      'User-Agent': 'purelyprofit-server/1.0',
    };
  }

  /** 发起下单请求并校验微信返回的 code_url 存在 */
  private async requestCodeUrl(
    body: string,
    authorization: string,
    bizType?: string,
  ): Promise<{ codeUrl: string }> {
    const bizTag = this.formatBizTag(bizType);
    let response: Response;
    let responseJson: WechatErrorResponse & WechatNativeOrderResponse;

    try {
      response = await fetch(
        `${WECHAT_API_BASE}${WECHAT_NATIVE_ORDER_PATH}`,
        {
          method: 'POST',
          headers: this.buildHeaders(authorization),
          body,
          signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
        },
      );
      responseJson = (await response.json()) as WechatErrorResponse &
        WechatNativeOrderResponse;
    } catch (error) {
      this.logger.error(`微信 Native 下单网络异常${bizTag}`, error);
      throw new InternalServerErrorException(
        '微信支付服务暂时不可用，请稍后重试',
      );
    }

    if (!response.ok) {
      const { code, message } = responseJson;
      this.logger.error(
        `微信 Native 下单失败${bizTag}: ${code ?? 'UNKNOWN'} - ${message ?? ''}`,
      );
      throw new InternalServerErrorException(
        `微信支付下单失败：${message ?? '请联系平台管理员'}`,
      );
    }

    if (!responseJson.code_url) {
      throw new InternalServerErrorException(
        '微信支付返回数据异常，code_url 为空',
      );
    }

    return { codeUrl: responseJson.code_url };
  }

  // ─── 平台配置 ──────────────────────────────────────────────────────────────

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

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new InternalServerErrorException(
        `环境变量 ${key} 未配置，无法发起微信支付`,
      );
    }
    return value.trim();
  }

  // ─── 签名 ──────────────────────────────────────────────────────────────────

  /** 组装 WECHATPAY2-SHA256-RSA2048 鉴权头 */
  private buildAuthorization(opts: {
    mchId: string;
    serialNo: string;
    privateKeyPem: string | null;
    body: string;
    /** 参与签名的 canonical url（不含域名、不含 query），由调用方按实际接口传入 */
    urlPath: string;
  }): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');

    const signMessage = [
      'POST',
      opts.urlPath,
      timestamp,
      nonce,
      opts.body,
      '',
    ].join('\n');

    return [
      `WECHATPAY2-SHA256-RSA2048 mchid="${opts.mchId}"`,
      `nonce_str="${nonce}"`,
      `signature="${this.signWithRsa(signMessage, opts.privateKeyPem)}"`,
      `timestamp="${timestamp}"`,
      `serial_no="${opts.serialNo}"`,
    ].join(',');
  }

  private signWithRsa(message: string, privateKeyPem: string | null): string {
    if (!privateKeyPem) {
      this.logger.warn(
        'WECHAT_PRIVATE_KEY_PATH / WECHAT_PRIVATE_KEY_CONTENT 均未配置，' +
          '使用开发态占位签名，微信将拒绝此请求。',
      );
      return DEV_PLACEHOLDER_SIGNATURE;
    }

    try {
      const privateKey = createPrivateKey(privateKeyPem);
      const sign = createSign('RSA-SHA256');
      sign.update(message, 'utf8');
      return sign.sign(privateKey, 'base64');
    } catch (error) {
      this.logger.error('RSA 签名失败，私钥格式可能有误', error);
      throw new InternalServerErrorException(
        '微信支付签名失败，请检查私钥配置是否正确',
      );
    }
  }

  private async loadPrivateKeyPem(): Promise<string | null> {
    if (
      this.cachedPrivateKeyPem !== undefined &&
      Date.now() - this.cachedPrivateKeyPemLoadedAt < PRIVATE_KEY_CACHE_TTL_MS
    ) {
      return this.cachedPrivateKeyPem;
    }

    // 缓存失效瞬间的多笔下单会同时走到这里：共用同一次加载，
    // 否则并发度多高就会重复读多少次私钥文件
    if (!this.privateKeyLoadInFlight) {
      this.privateKeyLoadInFlight = this.loadPrivateKeyPemFromSource().finally(
        () => {
          this.privateKeyLoadInFlight = null;
        },
      );
    }
    return this.privateKeyLoadInFlight;
  }

  /** 真正读取私钥（文件优先，其次内联），结果写入缓存 */
  private async loadPrivateKeyPemFromSource(): Promise<string | null> {
    // 先清缓存再加载：读取失败时不会残留上一次的旧值
    this.cachedPrivateKeyPem = undefined;
    this.cachedPrivateKeyPemLoadedAt = Date.now();

    const keyPath = this.configService
      .get<string>('wechat.privateKeyPath')
      ?.trim();
    if (keyPath) {
      try {
        const pem = await readFile(keyPath, 'utf8');
        this.cachedPrivateKeyPem = pem;
        return pem;
      } catch (error) {
        this.logger.error(`读取微信私钥文件失败: ${keyPath}`, error);
        throw new InternalServerErrorException(
          '读取微信支付私钥文件失败，请检查 WECHAT_PRIVATE_KEY_PATH 配置',
        );
      }
    }

    const keyContent = this.configService
      .get<string>('wechat.privateKeyContent')
      ?.trim();
    if (keyContent) {
      const pem = keyContent.replace(/\\n/g, '\n');
      this.cachedPrivateKeyPem = pem;
      return pem;
    }

    this.logger.warn('微信支付私钥未配置，将使用开发态占位签名');
    this.cachedPrivateKeyPem = null;
    return null;
  }
}
