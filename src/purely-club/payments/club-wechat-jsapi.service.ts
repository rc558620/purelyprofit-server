/**
 * ClubWechatJsapiService
 *
 * 封装微信支付 JSAPI 下单（v3）接口调用：
 *  POST https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi
 *
 * 认证方式：WECHATPAY2-SHA256-RSA2048（商户私钥签名）
 * 返回值：前端调起微信支付所需的 ClubWechatPaymentParamsDto
 *
 * 依赖：
 *   - StoresWechatPayService   读取门店的 mchId / apiV3Key / 证书序列号
 *   - ConfigService            读取 WECHAT_APP_ID / WECHAT_PAY_NOTIFY_URL
 *                                   WECHAT_PRIVATE_KEY_PATH / WECHAT_PRIVATE_KEY_CONTENT
 *                                   WECHAT_MCH_SERIAL_NO
 *
 * 私钥加载优先级：
 *   1. WECHAT_PRIVATE_KEY_PATH  — PEM 文件路径（生产推荐）
 *   2. WECHAT_PRIVATE_KEY_CONTENT — PEM 内容内联（Docker secret 注入）
 *   3. 以上均未配置 → 开发态降级：用 HMAC-SHA256 生成 paySign（微信会拒绝，仅本地联调用）
 */
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';

interface WechatJsapiOrderRequest {
  storeId: number;
  orderNo: string;
  description: string;
  amountFen: number;
  openid: string;
}

interface WechatJsapiPrePayResponse {
  prepay_id: string;
}

@Injectable()
export class ClubWechatJsapiService {
  private readonly logger = new Logger(ClubWechatJsapiService.name);

  /** 缓存已加载的私钥 PEM，避免每次请求重复读文件 */
  private cachedPrivateKeyPem: string | null | undefined = undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly storesWechatPayService: StoresWechatPayService,
  ) {}

  /**
   * 向微信统一下单 v3 接口请求 prepay_id，并组装前端拉起支付所需的签名参数
   */
  async createJsapiPaymentParams(
    params: WechatJsapiOrderRequest,
  ): Promise<ClubWechatPaymentParamsDto> {
    const config = await this.storesWechatPayService.getWechatPayConfigForStore(
      params.storeId,
    );

    if (!config.mchId || !config.apiV3Key) {
      throw new BadRequestException(
        '当前门店尚未配置微信收款，请前往设置完成配置后再下单',
      );
    }

    const appId = this.getRequiredConfig('wechat.appId');
    const notifyUrl = this.getRequiredConfig('wechat.payNotifyUrl');

    // 证书序列号：每个商户申请 API 证书时会分配，需配置到环境变量
    const serialNo = this.getRequiredConfig('wechat.mchSerialNo');

    const privateKeyPem = this.loadPrivateKeyPem();

    const prepayId = await this.requestPrepayId({
      appId,
      mchId: config.mchId,
      notifyUrl,
      serialNo,
      privateKeyPem,
      orderNo: params.orderNo,
      description: params.description,
      amountFen: params.amountFen,
      openid: params.openid,
    });

    return this.buildJsapiPaymentParams(appId, prepayId, privateKeyPem);
  }

  // ─── 统一下单请求 ─────────────────────────────────────────────────────────

  private async requestPrepayId(opts: {
    appId: string;
    mchId: string;
    notifyUrl: string;
    serialNo: string;
    privateKeyPem: string | null;
    orderNo: string;
    description: string;
    amountFen: number;
    openid: string;
  }): Promise<string> {
    const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi';
    const body = JSON.stringify({
      appid: opts.appId,
      mchid: opts.mchId,
      description: opts.description,
      out_trade_no: opts.orderNo,
      notify_url: opts.notifyUrl,
      amount: { total: opts.amountFen, currency: 'CNY' },
      payer: { openid: opts.openid },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');

    const authorization = this.buildAuthorization({
      mchId: opts.mchId,
      serialNo: opts.serialNo,
      privateKeyPem: opts.privateKeyPem,
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
        const errBody = responseJson as {
          code?: string;
          message?: string;
        };
        this.logger.error(
          `微信下单失败: ${errBody.code ?? 'UNKNOWN'} - ${errBody.message ?? ''}`,
        );
        throw new InternalServerErrorException(
          `微信支付下单失败：${errBody.message ?? '请联系客服'}`,
        );
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error('微信下单网络请求异常', error);
      throw new InternalServerErrorException(
        '微信支付服务暂时不可用，请稍后重试',
      );
    }

    const prepayResponse = responseJson as WechatJsapiPrePayResponse;
    if (!prepayResponse.prepay_id) {
      throw new InternalServerErrorException(
        '微信支付返回数据异常，prepay_id 为空',
      );
    }

    return prepayResponse.prepay_id;
  }

  // ─── 前端支付参数组装 ──────────────────────────────────────────────────────

  /**
   * 根据 prepay_id 组装前端 wx.requestPayment 所需的签名参数
   *
   * 签名消息格式（微信官方规范，4 行 + 末尾换行）：
   *   {appId}\n{timestamp}\n{nonceStr}\n{package}\n
   *
   * 算法：RSA-SHA256，输出 Base64
   * 文档：https://pay.weixin.qq.com/docs/merchant/development/interface-rules/signature-generation.html
   */
  private buildJsapiPaymentParams(
    appId: string,
    prepayId: string,
    privateKeyPem: string | null,
  ): ClubWechatPaymentParamsDto {
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = randomBytes(16).toString('hex');
    const packageStr = `prepay_id=${prepayId}`;

    const signMessage = `${appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
    const paySign = this.signWithRsa(signMessage, privateKeyPem);

    return {
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: 'RSA',
      paySign,
    };
  }

  // ─── 微信 v3 Authorization 头构造 ────────────────────────────────────────

  /**
   * 构造微信 v3 API 请求 Authorization 头
   *
   * 规范格式（WECHATPAY2-SHA256-RSA2048）：
   *   {method}\n{uri}\n{timestamp}\n{nonce}\n{body}\n
   * 签名算法：RSA-SHA256，输出 Base64
   *
   * 开发态降级说明：
   *   若私钥未配置，使用 HMAC-SHA256(apiV3Key) 代替，微信将拒绝，
   *   但本地可以看到请求结构是否正确，不会引发运行时崩溃。
   */
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

  // ─── 私钥加载 & RSA 签名 ─────────────────────────────────────────────────

  /**
   * 用 RSA-SHA256 对消息签名，返回 Base64 编码结果。
   *
   * 若 privateKeyPem 为 null（开发态未配置），返回占位字符串 "DEV_MODE_NO_RSA_KEY"，
   * 微信会拒绝该请求，但服务端不会崩溃，便于本地调试接口结构。
   */
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

  /**
   * 加载商户 RSA 私钥 PEM，优先级：文件路径 > 内联内容 > null（开发态）
   *
   * 结果仅在服务实例生命周期内缓存一次（`cachedPrivateKeyPem`），
   * 避免每次请求都重复读文件 I/O。
   */
  private loadPrivateKeyPem(): string | null {
    // 已加载（含 null 的情况）则直接返回缓存
    if (this.cachedPrivateKeyPem !== undefined) {
      return this.cachedPrivateKeyPem;
    }

    // 优先：文件路径
    const keyPath = this.configService
      .get<string>('wechat.privateKeyPath')
      ?.trim();
    if (keyPath) {
      try {
        const pem = readFileSync(keyPath, 'utf8');
        this.cachedPrivateKeyPem = pem;
        this.logger.log('微信支付 RSA 私钥已从文件路径加载');
        return pem;
      } catch (error) {
        this.logger.error(`读取微信私钥文件失败: ${keyPath}`, error);
        throw new InternalServerErrorException(
          '读取微信支付私钥文件失败，请检查 WECHAT_PRIVATE_KEY_PATH 配置',
        );
      }
    }

    // 次优先：内联内容
    const keyContent = this.configService
      .get<string>('wechat.privateKeyContent')
      ?.trim();
    if (keyContent) {
      // 支持环境变量中以字面 \n 代替换行的写法
      const pem = keyContent.replace(/\\n/g, '\n');
      this.cachedPrivateKeyPem = pem;
      this.logger.log('微信支付 RSA 私钥已从环境变量内容加载');
      return pem;
    }

    // 未配置：开发态降级
    this.logger.warn(
      'WECHAT_PRIVATE_KEY_PATH 和 WECHAT_PRIVATE_KEY_CONTENT 均未配置，' +
        '将使用开发态占位签名（微信不会接受此签名，仅供本地联调）',
    );
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
