/**
 * 微信支付 API v3 传输层类型定义（平台侧 / 门店侧共用）。
 *
 * ⚠️ 这里只描述**传输层契约**，不出现任何具体商户号或凭据：
 * 商户身份由各业务模块的适配器以 `WechatPayCredentialConfig` 给出。
 * 平台收款与门店收款一旦共用同一份身份配置，「进错账」就是资金事故，而不是配置错误。
 */
import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/** 微信支付只用到这两种方法，收敛成字面量类型避免调用方传错 */
export type WechatPayHttpMethod = 'GET' | 'POST';

export type WechatPayResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string | null; message: string };

/** 微信错误响应体（只取业务需要的两个字段） */
export interface WechatPayErrorPayload {
  code?: string;
  message?: string;
}

/** 一套商户身份的配置描述（由各业务模块自己给出，传输层不猜测） */
export interface WechatPayCredentialConfig {
  /** 证书序列号配置键 */
  serialNoKey: string;
  /** 私钥文件路径配置键 */
  privateKeyPathKey: string;
  /** 私钥内联内容配置键 */
  privateKeyContentKey: string;
  /**
   * 生产环境私钥缺失时是否直接失败。
   *
   * 门店侧为 true：降级成占位签名会让请求看起来正常发出、实际必被微信拒绝，
   * 前端只看到「支付失败」，排查成本极高。
   * 平台侧保持 false：这是既有行为，改动会让平台下单在配置缺失时从
   * 「微信拒绝」变成「本地 500」，影响面超出本次重构。
   */
  failFastWhenMissingKeyInProduction: boolean;
  /** 私钥读取失败提示里引用的环境变量名，避免提示与实际配置项对不上 */
  privateKeyPathHint: string;
}

export interface WechatPayTransportOptions<TScope extends string> {
  configService: ConfigService;
  logger: Logger;
  /** 把凭据作用域翻译成配置键；作用域划分由业务侧决定 */
  resolveCredential: (scope: TScope) => WechatPayCredentialConfig;
  /** 未显式指定作用域时使用哪一个 */
  defaultScope: TScope;
}

export interface WechatPayTransportRequest<TScope extends string> {
  method: WechatPayHttpMethod;
  /** 实际请求的 url path（含 query，不含域名）；其中的业务单号必须已编码 */
  requestUrlPath: string;
  /**
   * 参与签名的 canonical url path（含 query）。
   *
   * 微信要求签名使用**未编码**的原始单号，可能与请求 URL 的编码 path 不同；
   * 省略时按 `requestUrlPath` 签名（两者一致的历史链路）。
   */
  signUrlPath?: string;
  /** 参与鉴权头 `mchid` 的商户号（签名主体） */
  mchId: string;
  /** 凭据作用域，默认取 `defaultScope` */
  credential?: TScope;
  /** POST 请求体；GET 时为空串参与签名 */
  body?: string;
}

/** 签名串拼接入参（6 段固定格式） */
export interface WechatPaySignMessageParts {
  method: string;
  canonicalUrl: string;
  timestamp: string;
  nonce: string;
  body: string;
}

/** 鉴权头拼接入参 */
export interface WechatPayAuthorizationParts {
  mchId: string;
  nonce: string;
  timestamp: string;
  signature: string;
  serialNo: string;
}
