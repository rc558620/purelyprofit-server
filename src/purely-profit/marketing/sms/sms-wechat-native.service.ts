/**
 * SmsWechatNativeService
 *
 * 短信钱包充值专用：微信支付 Native（扫码）下单 v3
 *  POST https://api.mch.weixin.qq.com/v3/pay/transactions/native
 *
 * 资金流向：**商家付钱给平台**（B 端采购短信服务），与门店微信收款
 * （purelyClub 顾客付钱给商家，配置在 `stores_wechat_pay` 表）完全无关。
 * 因此本服务**不读任何门店配置**，全部使用平台级微信支付商户号：
 *   - wechat.payMchId         平台收款商户号（WECHAT_PAY_MCH_ID）
 *   - wechat.appId            平台小程序/公众号 AppID
 *   - wechat.privateKey*      商户 API 私钥
 *   - wechat.mchSerialNo      商户 API 证书序列号
 *
 * 认证方式与 club 的 JSAPI 一致：WECHATPAY2-SHA256-RSA2048（商户私钥签名）。
 * 差别只有两处：下单地址 `/native`（取 code_url）、notify_url 用短信专用路由。
 */
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateSmsNativeOrderParams {
  orderNo: string;
  amountFen: number;
  description: string;
}

interface WechatNativeOrderResponse {
  code_url?: string;
}

/** 私钥缓存有效期：5 分钟，支持热更新 */
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SmsWechatNativeService {
  private readonly logger = new Logger(SmsWechatNativeService.name);

  private cachedPrivateKeyPem: string | null | undefined = undefined;
  private cachedPrivateKeyPemLoadedAt = 0;

  constructor(private readonly configService: ConfigService) {}

  /** 下单并返回二维码链接 */
  async createNativeOrder(
    params: CreateSmsNativeOrderParams,
  ): Promise<{ codeUrl: string }> {
    const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/native';

    const mchId = this.getPlatformMchId();
    const appId = this.getRequiredConfig('wechat.appId');
    const serialNo = this.getRequiredConfig('wechat.mchSerialNo');
    const notifyUrl = this.getSmsNotifyUrl();
    const privateKeyPem = await this.loadPrivateKeyPem();

    const body = JSON.stringify({
      appid: appId,
      mchid: mchId,
      description: params.description,
      out_trade_no: params.orderNo,
      notify_url: notifyUrl,
      amount: { total: params.amountFen, currency: 'CNY' },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const authorization = this.buildAuthorization({
      mchId,
      serialNo,
      privateKeyPem,
      method: 'POST',
      url,
      timestamp,
      nonce,
      body,
    });

    let responseJson: unknown;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
          'User-Agent': 'purelyprofit-server/1.0',
        },
        body,
      });

      responseJson = await response.json();

      if (!response.ok) {
        const errBody = responseJson as { code?: string; message?: string };
        this.logger.error(
          `短信充值微信下单失败: ${errBody.code ?? 'UNKNOWN'} - ${errBody.message ?? ''}`,
        );
        throw new InternalServerErrorException(
          `微信支付下单失败：${errBody.message ?? '请联系平台管理员'}`,
        );
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error('短信充值微信下单网络异常', error);
      throw new InternalServerErrorException(
        '微信支付服务暂时不可用，请稍后重试',
      );
    }

    const nativeResponse = responseJson as WechatNativeOrderResponse;
    if (!nativeResponse.code_url) {
      throw new InternalServerErrorException(
        '微信支付返回数据异常，code_url 为空',
      );
    }

    return { codeUrl: nativeResponse.code_url };
  }

  // ─── 平台配置 ──────────────────────────────────────────────────────────────

  /**
   * 平台收款商户号。
   *
   * 缺失时报错文案指向**平台管理员**而不是商家：商家充值是付钱给平台，
   * 这个配置商家既看不到也改不了，让商家「前往门店设置」纯属误导。
   */
  private getPlatformMchId(): string {
    const mchId = this.configService.get<string>('wechat.payMchId')?.trim();
    if (!mchId) {
      throw new InternalServerErrorException(
        '平台微信收款未配置（WECHAT_PAY_MCH_ID），短信充值暂不可用，请联系平台管理员',
      );
    }
    return mchId;
  }

  /**
   * 短信专用回调地址。
   *
   * 未配置 `SMS_WECHAT_PAY_NOTIFY_URL` 时**不回落到** club 的通用地址：
   * 那会导致短信充值回调打到 C 端订单回调上，而后者根本不认识 SM 前缀订单，
   * 表现为「付了钱、钱包没到账」且无报错。宁可下单直接失败让人去配。
   */
  private getSmsNotifyUrl(): string {
    const configured = this.configService
      .get<string>('sms.wechatPayNotifyUrl')
      ?.trim();
    if (configured) {
      return configured;
    }
    throw new InternalServerErrorException(
      '环境变量 SMS_WECHAT_PAY_NOTIFY_URL 未配置，无法发起短信充值',
    );
  }

  // ─── 签名 ──────────────────────────────────────────────────────────────────

  private buildAuthorization(opts: {
    mchId: string;
    serialNo: string;
    privateKeyPem: string | null;
    method: string;
    url: string;
    timestamp: string;
    nonce: string;
    body: string;
  }): string {
    const urlObj = new URL(opts.url);
    const canonicalUrl = urlObj.pathname + (urlObj.search || '');

    const signMessage = [
      opts.method,
      canonicalUrl,
      opts.timestamp,
      opts.nonce,
      opts.body,
      '',
    ].join('\n');

    const signature = this.signWithRsa(signMessage, opts.privateKeyPem);

    return [
      `WECHATPAY2-SHA256-RSA2048 mchid="${opts.mchId}"`,
      `nonce_str="${opts.nonce}"`,
      `signature="${signature}"`,
      `timestamp="${opts.timestamp}"`,
      `serial_no="${opts.serialNo}"`,
    ].join(',');
  }

  private signWithRsa(message: string, privateKeyPem: string | null): string {
    if (!privateKeyPem) {
      this.logger.warn(
        'WECHAT_PRIVATE_KEY_PATH / WECHAT_PRIVATE_KEY_CONTENT 均未配置，' +
          '使用开发态占位签名，微信将拒绝此请求。',
      );
      return 'DEV_MODE_NO_RSA_KEY';
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

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new InternalServerErrorException(
        `环境变量 ${key} 未配置，无法发起微信支付`,
      );
    }
    return value.trim();
  }
}
