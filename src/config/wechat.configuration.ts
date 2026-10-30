import { isTestModeDefaultEnvironment } from './env.utils';
import {
  resolveWechatPartnerConfig,
  WechatPartnerConfig,
} from './wechat-partner.configuration';

/**
 * `wechat` 配置块：微信小程序与微信支付。
 *
 * 顶层字段服务「商家向平台付费」的资金流（短信钱包充值 / 平台会员 / 额度），
 * `partner` 子块单独服务「C 端用户向商家付费」的服务商模式资金流，
 * 两者配置项必须保持独立，严禁合并（详见 `wechat-partner.configuration.ts`）。
 */
export interface WechatConfig {
  /** 微信小程序 AppID（purely-club 对应的小程序 appid） */
  appId: string;
  /** 微信小程序 AppSecret（code2session 接口鉴权，严禁泄露/明文落库） */
  appSecret: string;
  /** 微信支付回调通知地址（商家服务器公网可达地址） */
  payNotifyUrl: string;
  /** 微信支付商户 API RSA 私钥文件路径（PEM 格式），优先使用文件路径 */
  privateKeyPath: string;
  /** 微信支付商户 API RSA 私钥内容（PEM 格式，直接内联），次优先级 */
  privateKeyContent: string;
  /** 商户 API 证书序列号（serial_no） */
  mchSerialNo: string;
  /** 微信支付平台公钥（PEM 格式，内联内容），用于验证回调签名 */
  platformPublicKeyContent: string;
  /** 是否允许在未配置平台公钥的情况下跳过 RSA 验签处理支付回调 */
  allowInsecureCallback: boolean;
  /** 平台收款商户号（商家向平台付费的场景） */
  payMchId: string;
  /** 平台收款商户号的 APIv3 密钥（32 字节） */
  payApiV3Key: string;
  /** 服务商模式配置组（C 端门店微信收款） */
  partner: WechatPartnerConfig;
}

/** 解析 `wechat` 配置块。 */
export function resolveWechatConfig(): WechatConfig {
  return {
    /**
     * 微信小程序 AppID（purely-club 对应的小程序 appid）
     * 对应环境变量：WECHAT_APP_ID
     */
    appId: process.env.WECHAT_APP_ID ?? '',

    /**
     * 微信小程序 AppSecret（code2session 接口鉴权，严禁泄露/明文落库）
     * 对应环境变量：WECHAT_APP_SECRET
     */
    appSecret: process.env.WECHAT_APP_SECRET ?? '',

    /**
     * 微信支付回调通知地址（商家服务器公网可达地址）
     * 对应环境变量：WECHAT_PAY_NOTIFY_URL
     * 示例：https://api.yourdomain.com/club/payments/wechat/callback
     */
    payNotifyUrl: process.env.WECHAT_PAY_NOTIFY_URL ?? '',

    /**
     * 微信支付商户 API RSA 私钥文件路径（PEM 格式），优先使用文件路径。
     * 对应环境变量：WECHAT_PRIVATE_KEY_PATH
     * 示例：/etc/secrets/wechat_apiclient_key.pem
     */
    privateKeyPath: process.env.WECHAT_PRIVATE_KEY_PATH ?? '',

    /**
     * 微信支付商户 API RSA 私钥内容（PEM 格式，直接内联），次优先级。
     * 适合 Docker 环境注入 secret 内容而不挂载文件。
     * 对应环境变量：WECHAT_PRIVATE_KEY_CONTENT
     */
    privateKeyContent: process.env.WECHAT_PRIVATE_KEY_CONTENT ?? '',

    /**
     * 商户 API 证书序列号（serial_no），在微信商户平台「账户中心 → API 安全」可查。
     * 用于 WECHATPAY2-SHA256-RSA2048 Authorization 头中的 serial_no 字段。
     * 对应环境变量：WECHAT_MCH_SERIAL_NO
     */
    mchSerialNo: process.env.WECHAT_MCH_SERIAL_NO ?? '',

    /**
     * 微信支付平台公钥（PEM 格式，内联内容），用于验证回调签名（Wechatpay-Signature）。
     * 平台证书可通过 GET /v3/certificates 接口下载，建议定期轮换。
     * 未配置时跳过 RSA 验签，仅靠时间戳防重放（首次上线阶段可接受）。
     * 对应环境变量：WECHAT_PLATFORM_PUBLIC_KEY_CONTENT
     */
    platformPublicKeyContent:
      process.env.WECHAT_PLATFORM_PUBLIC_KEY_CONTENT ?? '',

    /**
     * 是否允许在**未配置平台公钥**的情况下跳过 RSA 验签处理支付回调。
     *
     * fail-closed：默认仅 `development` / `test` 打开，staging / 预发等环境默认关闭。
     * 关闭时若公钥缺失，回调一律拒绝 —— 只靠时间戳 + 必填头是可伪造的，
     * 任何公网可达的非生产环境都不该接受这种报文。
     * 生产环境强制为 false（启动校验会拦下显式开启）。
     * 对应环境变量：WECHAT_ALLOW_INSECURE_CALLBACK
     */
    allowInsecureCallback:
      (process.env.WECHAT_ALLOW_INSECURE_CALLBACK ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',

    /**
     * **平台收款商户号**（商家向平台付费的场景：短信钱包充值等）。
     *
     * ⚠️ 与门店微信收款（stores_wechat_pay，C 端顾客付钱给商家）是两条
     * 完全独立的资金流，严禁混用：短信充值下单用这里的商户号，
     * 回调也用这里的 APIv3Key 解密。
     * 对应环境变量：WECHAT_PAY_MCH_ID
     */
    payMchId: process.env.WECHAT_PAY_MCH_ID ?? '',

    /**
     * 平台收款商户号的 APIv3 密钥（32 字节），用于解密短信充值回调报文。
     * 对应环境变量：WECHAT_PAY_API_V3_KEY
     */
    payApiV3Key: process.env.WECHAT_PAY_API_V3_KEY ?? '',

    partner: resolveWechatPartnerConfig(),
  };
}
