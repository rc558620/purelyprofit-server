/**
 * 微信支付 API v3 请求客户端（purely-profit · 平台收款商户号）。
 *
 * 本文件只保留**身份适配**：平台收款固定用 `wechat.mchSerialNo` +
 * `wechat.privateKey*` 这一套凭据，生产环境缺少私钥时与门店侧一致直接失败，
 * 不再降级为占位签名（那会下发注定被微信拒绝、用户却看不出原因的二维码）。
 * 签名串拼接、鉴权头构造、请求发送、超时与错误响应解析全部走
 * `src/shared/wechat-pay/wechat-pay-sign-transport.ts`。
 *
 * ⚠️ 平台收款商户号与门店收款商户号**必须分开**：两者共用一个传输层实例
 * 就会共用同一把私钥与降级策略，商户身份也随之串味，属于资金事故。
 * 因此共享的是传输层实现，不是身份。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatPaySignTransport } from '../../shared/wechat-pay/wechat-pay-sign-transport';
import type {
  WechatPayCredentialConfig,
  WechatPayHttpMethod,
  WechatPayResponse,
} from '../../shared/wechat-pay/wechat-pay.types';

export type { WechatPayResponse };

/** 平台侧只有一套凭据，作用域固定，避免调用方误传门店作用域 */
type PlatformCredentialScope = 'platform';

/** 平台收款商户号的凭据配置键（身份适配层，不进共享传输层） */
const PLATFORM_CREDENTIAL: WechatPayCredentialConfig = {
  serialNoKey: 'wechat.mchSerialNo',
  privateKeyPathKey: 'wechat.privateKeyPath',
  privateKeyContentKey: 'wechat.privateKeyContent',
  // 与门店侧一致：生产缺失私钥直接失败，避免下发注定被微信拒绝的二维码
  failFastWhenMissingKeyInProduction: true,
  privateKeyPathHint: 'WECHAT_PRIVATE_KEY_PATH',
};

export interface WechatPayRequestParams {
  method: WechatPayHttpMethod;
  /** 实际请求的 url path（不含域名）；路径段里的业务单号必须已编码 */
  urlPath: string;
  /** 收款商户号（平台级），参与鉴权头 */
  mchId: string;
  /**
   * 参与签名的 canonical url path（可含 query）。
   *
   * ⚠️ 微信要求签名使用**未编码**的原始单号，与请求 URL 的编码 path 不是一回事。
   * 只有「确定不含需编码字符」的接口才能省略此项（如 Native 下单）；
   * 涉及 out_trade_no 的关单 / 查单必须显式传入未编码版本。
   */
  signPath?: string;
  /** query 串，不含 `?`；同时参与签名 */
  query?: string;
  /** POST 请求体；GET 时传空串参与签名 */
  body?: string;
}

@Injectable()
export class PlatformWechatPayHttpService {
  private readonly logger = new Logger(PlatformWechatPayHttpService.name);
  private readonly transport: WechatPaySignTransport<PlatformCredentialScope>;

  constructor(private readonly configService: ConfigService) {
    this.transport = new WechatPaySignTransport<PlatformCredentialScope>({
      configService: this.configService,
      logger: this.logger,
      defaultScope: 'platform',
      resolveCredential: () => PLATFORM_CREDENTIAL,
    });
  }

  /** 是否生产环境：生产禁用一切「签名降级」路径 */
  isProduction(): boolean {
    return this.transport.isProduction();
  }

  /**
   * 发起一次微信支付 API v3 请求。
   *
   * 微信返回 4xx / 5xx 时**不抛异常**，而是返回 `ok: false` 并带回微信错误码，
   * 由调用方按错误码决定语义（例如关单遇到 `ORDERPAID` 意味着用户其实已付款）。
   * 只有网络层不可达才抛 `InternalServerErrorException`。
   */
  request<T>(params: WechatPayRequestParams): Promise<WechatPayResponse<T>> {
    const querySuffix = params.query ? `?${params.query}` : '';
    const requestUrlPath = `${params.urlPath}${querySuffix}`;

    return this.transport.request<T>({
      method: params.method,
      requestUrlPath,
      // 签名 URL 与请求 URL 可能不同（未编码单号 vs 编码后的 path）
      signUrlPath: params.signPath
        ? `${params.signPath}${querySuffix}`
        : requestUrlPath,
      mchId: params.mchId,
      body: params.body,
    });
  }

  /** 读取必填配置；缺失直接失败，避免发出注定被微信拒绝的请求 */
  getRequiredConfig(key: string): string {
    return this.transport.getRequiredConfig(key);
  }

  /**
   * 加载商户 RSA 私钥 PEM（文件路径 > 内联内容 > 开发态 null），带缓存与并发合并。
   */
  loadPrivateKeyPem(): Promise<string | null> {
    return this.transport.loadPrivateKeyPem();
  }
}
