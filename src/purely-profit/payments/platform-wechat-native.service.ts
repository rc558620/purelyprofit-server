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

const WECHAT_NATIVE_ORDER_URL =
  'https://api.mch.weixin.qq.com/v3/pay/transactions/native';

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
}

interface WechatNativeOrderResponse {
  code_url?: string;
}

interface WechatErrorResponse {
  code?: string;
  message?: string;
}

@Injectable()
export class PlatformWechatNativeService {
  private readonly logger = new Logger(PlatformWechatNativeService.name);

  private cachedPrivateKeyPem: string | null | undefined = undefined;
  private cachedPrivateKeyPemLoadedAt = 0;

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
    });

    return this.requestCodeUrl(body, authorization);
  }

  /** 发起下单请求并校验微信返回的 code_url 存在 */
  private async requestCodeUrl(
    body: string,
    authorization: string,
  ): Promise<{ codeUrl: string }> {
    let response: Response;
    let responseJson: WechatErrorResponse & WechatNativeOrderResponse;

    try {
      response = await fetch(WECHAT_NATIVE_ORDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
          'User-Agent': 'purelyprofit-server/1.0',
        },
        body,
      });
      responseJson = (await response.json()) as WechatErrorResponse &
        WechatNativeOrderResponse;
    } catch (error) {
      this.logger.error('微信 Native 下单网络异常', error);
      throw new InternalServerErrorException(
        '微信支付服务暂时不可用，请稍后重试',
      );
    }

    if (!response.ok) {
      const { code, message } = responseJson;
      this.logger.error(
        `微信 Native 下单失败: ${code ?? 'UNKNOWN'} - ${message ?? ''}`,
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
  }): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const canonicalUrl = new URL(WECHAT_NATIVE_ORDER_URL).pathname;

    const signMessage = [
      'POST',
      canonicalUrl,
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
