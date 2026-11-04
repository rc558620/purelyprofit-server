/**
 * 微信支付 API v3 请求客户端（purely-club · 门店收款商户号）。
 *
 * 本文件只保留**身份适配**：从门店收款配置里取出「证书序列号 + 商户私钥」
 * 对应的配置键，并决定哪种凭据作用域在生产环境必须 fail-fast。
 * 签名串拼接、鉴权头构造、请求发送、超时与错误响应解析全部走
 * `src/shared/wechat-pay/wechat-pay-sign-transport.ts`。
 *
 * ⚠️ 门店收款商户号与平台收款商户号**必须分开**：一旦共用同一份身份配置，
 * 门店的钱会按平台主体签名，属于资金事故。所以要共用的是传输层，不是身份。
 *
 * 从 ClubWechatJsapiService 抽出的原因：查单与关单必须复用同一份签名与私钥逻辑。
 * 若各自复制一份，「私钥加载失败时是否降级为占位签名」这类资金安全口径会在
 * 不同接口之间漂移，最终出现「下单报错、查单却返回看起来正常的假结果」。
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

/**
 * 凭据作用域：决定这次请求用哪一套「证书序列号 + 商户私钥」签名。
 *
 * - `store`：旧直连链路 + 平台侧历史用法，读全局的 `wechat.mchSerialNo` / `wechat.privateKey*`；
 * - `partner`：服务商模式，读隔离新增的 `wechat.partner.serialNo` / `wechat.partner.privateKey*`。
 *
 * ⚠️ 两套配置**取值可能相同（同一商户号）但必须分开配置**：未来任意一边轮换证书，
 * 都不应牵连另一条链路。默认值是 `store`，保证所有历史调用方行为零变化。
 */
export type WechatPayCredentialScope = 'store' | 'partner';

/** 各作用域对应的门店收款凭据配置键（身份适配层，不进共享传输层） */
const CREDENTIAL_CONFIG: Record<
  WechatPayCredentialScope,
  WechatPayCredentialConfig
> = {
  store: {
    serialNoKey: 'wechat.mchSerialNo',
    privateKeyPathKey: 'wechat.privateKeyPath',
    privateKeyContentKey: 'wechat.privateKeyContent',
    failFastWhenMissingKeyInProduction: true,
    privateKeyPathHint: 'WECHAT_PRIVATE_KEY_PATH',
  },
  partner: {
    serialNoKey: 'wechat.partner.serialNo',
    privateKeyPathKey: 'wechat.partner.privateKeyPath',
    privateKeyContentKey: 'wechat.partner.privateKeyContent',
    failFastWhenMissingKeyInProduction: true,
    privateKeyPathHint: 'WECHAT_PARTNER_PRIVATE_KEY_PATH',
  },
};

export interface WechatPayRequestParams {
  method: WechatPayHttpMethod;
  /**
   * 参与签名的 canonical url（不含域名），形如 `/v3/pay/transactions/jsapi`。
   *
   * ⚠️ 该值同时用于签名与实际请求，因此调用方若要把业务单号拼进路径，
   * 必须先 `encodeURIComponent`。项目订单号仅含字母数字与连字符（编码前后一致），
   * 不存在「URL 能通、签名对不上」的风险。
   */
  urlPath: string;
  /** 参与鉴权头 `mchid` 的商户号（签名主体），由 {@link ClubWechatPayIdentityService} 给出 */
  mchId: string;
  /** 凭据作用域，默认 `store`（见类型注释） */
  credential?: WechatPayCredentialScope;
  /** query 串，不含 `?`；同时参与签名 */
  query?: string;
  /** POST 请求体；GET 时为空串参与签名 */
  body?: string;
}

@Injectable()
export class ClubWechatPayHttpService {
  private readonly logger = new Logger(ClubWechatPayHttpService.name);
  /** 传输层实例按商户身份构造，私钥缓存与降级策略都跟着门店收款配置走 */
  private readonly transport: WechatPaySignTransport<WechatPayCredentialScope>;

  constructor(private readonly configService: ConfigService) {
    this.transport = new WechatPaySignTransport<WechatPayCredentialScope>({
      configService: this.configService,
      logger: this.logger,
      defaultScope: 'store',
      resolveCredential: (scope) => CREDENTIAL_CONFIG[scope],
    });
  }

  /** 是否生产环境：生产禁用一切「签名降级」路径 */
  isProduction(): boolean {
    return this.transport.isProduction();
  }

  /**
   * 发起一次微信支付 API v3 请求。
   *
   * 微信返回 4xx / 5xx 时不抛异常，而是返回 `ok: false` 并带回微信错误码，
   * 由调用方按错误码决定语义（例如关单遇到 `ORDERPAID` 意味着用户其实已付款）。
   * 只有网络层不可达才抛 `InternalServerErrorException`。
   */
  request<T>(params: WechatPayRequestParams): Promise<WechatPayResponse<T>> {
    const querySuffix = params.query ? `?${params.query}` : '';

    return this.transport.request<T>({
      method: params.method,
      // 门店侧签名 URL 与请求 URL 恒等，无需单独给出 signUrlPath
      requestUrlPath: `${params.urlPath}${querySuffix}`,
      mchId: params.mchId,
      credential: params.credential,
      body: params.body,
    });
  }

  /**
   * RSA-SHA256 签名，返回 Base64。
   *
   * 供 JSAPI 组装前端 paySign 复用：paySign 与鉴权头必须用同一把私钥，
   * 否则前端拿到的是「能拉起但必被拒」的参数。
   */
  signWithRsa(message: string, privateKeyPem: string | null): string {
    return this.transport.signWithRsa(message, privateKeyPem);
  }

  /**
   * 加载商户 RSA 私钥 PEM（文件路径 > 内联内容 > 开发态 null）。
   *
   * 生产环境未配置时**直接失败**：降级成占位签名会让请求看起来正常发出，
   * 实际必被微信拒绝，前端只看到「支付失败」，排查成本极高。
   *
   * @param scope 凭据作用域，两套作用域各自独立缓存互不影响
   */
  loadPrivateKeyPem(
    scope: WechatPayCredentialScope = 'store',
  ): Promise<string | null> {
    return this.transport.loadPrivateKeyPem(scope);
  }

  getRequiredConfig(key: string): string {
    return this.transport.getRequiredConfig(key);
  }
}
