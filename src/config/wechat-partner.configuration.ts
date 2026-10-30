/**
 * `wechat.partner` 配置块：【服务商模式 · 增量隔离】C 端门店微信收款（链路 a）专用配置组。
 *
 * ⚠️ 隔离铁律（红线 1）：本组内所有配置**新增不替换**。
 * `wechat` 顶层那套（appId / mchSerialNo / privateKey* / platformPublicKeyContent /
 * payMchId / payApiV3Key）继续服务短信钱包充值（链路 b）与平台会员/额度（链路 c），
 * 其取值与消费方一个都不能改。两套配置语义完全不同：
 *   - 顶层那套 = 商家向平台付费，资金进平台商户号；
 *   - 下面这套 = C 端用户向商家付费，请求主体是服务商商户号，资金进子商户号。
 * 即便未来确认两套取值相同（同一商户号既做平台收款又做服务商），
 * 也必须保留两份独立配置项并在此注明复用理由，禁止合并。
 *
 * 灰度开关默认关闭：enabled=false 时链路 a 维持旧直连行为，保证可回滚。
 *
 * 【已确认事实 2026-10-29】`wechat.payMchId`（WECHAT_PAY_MCH_ID）本身就是
 * 平台的**微信支付服务商商户号**，链路 b/c 也在这同一个商户号下收款。
 * ⇒ `spMchId` 与 `payMchId` **取值相同是被允许的**，启动自检需通过
 *   `WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID=true` 显式豁免并填写原因。
 * ⇒ 同一个商户号意味着平台罗盘/证书也是同一份：`partner.serialNo`、
 *   `partner.privateKey*`、`partner.platformPublicKeyContent` 的**取值**
 *   与上方全局项相同，但**配置项必须保持独立**（资金语义不同、灰度互不牵连）。
 * ⚠️ 若未来平台新增「非服务商」的自收商户号，此处结论失效，必须重新评估平台证书维度。
 */
export interface WechatPartnerConfig {
  /** 服务商模式开关。true = 链路 a 走服务商（Partner）接口；false = 回落旧直连逻辑 */
  enabled: boolean;
  /** 服务商商户号（sp_mchid），服务商模式下所有 APIv3 请求的请求主体 */
  spMchId: string;
  /** 服务商 APIv3 密钥（32 字节），服务商模式下回调报文解密的唯一密钥 */
  apiV3Key: string;
  /** 服务商 API 证书序列号（serial_no），用于 Authorization 头 */
  serialNo: string;
  /** 服务商 API RSA 私钥文件路径（PEM），优先使用文件路径 */
  privateKeyPath: string;
  /** 服务商 API RSA 私钥内容（PEM 内联），次优先级，用于 Docker secret 注入 */
  privateKeyContent: string;
  /** 微信支付平台证书公钥（服务商商户号维度下载，PEM 内联） */
  platformPublicKeyContent: string;
  /** 服务商模式下发起支付的小程序 appid（sp_appid） */
  spAppId: string;
  /** 服务商模式的支付回调通知地址（已备案的 HTTPS 公网地址） */
  notifyUrl: string;
  /** 豁免开关：允许 spMchId 与 wechat.payMchId 相等 */
  allowSharedPlatformMchId: boolean;
  /** 豁免原因留档（配合 allowSharedPlatformMchId 使用），空值视为未留档 */
  sharedMchIdReason: string;
}

/** 解析 `wechat.partner` 配置块。 */
export function resolveWechatPartnerConfig(): WechatPartnerConfig {
  return {
    /**
     * 服务商模式开关。true=链路 a 走服务商（Partner）接口；false=回落旧直连逻辑。
     * 对应环境变量：WECHAT_PARTNER_ENABLED
     */
    enabled: (process.env.WECHAT_PARTNER_ENABLED ?? 'false') === 'true',

    /**
     * 服务商商户号（sp_mchid），服务商模式下所有 APIv3 请求的**请求主体**。
     *
     * ⚠️ 资金归属红线：正常情况下禁止与 wechat.payMchId（平台自收商户号）混用。
     * 两者相等意味着「C 端付款落进平台账户」而非子商户，属资金归属事故，
     * 启动自检会拦截（除非显式豁免，见 allowSharedPlatformMchId）。
     *
     * 已确认：本平台的 payMchId 本身即服务商商户号，因此两者相等是**预期配置**，
     * 不是事故；但仍必须显式豁免，理由是「防止有人因为填错/抄错而静默同号」。
     * 真正的资金去向由子商户号 sub_mchid 决定，而不是这个字段。
     * 对应环境变量：WECHAT_PARTNER_SP_MCH_ID
     */
    spMchId: process.env.WECHAT_PARTNER_SP_MCH_ID ?? '',

    /**
     * 服务商 APIv3 密钥（32 字节）。
     *
     * 服务商模式下**回调报文解密的唯一密钥**：特约商户/二级商户在微信侧不存在
     * 自己的 APIv3 密钥也不会自行设置，回调统一由服务商密钥加密后发给服务商。
     * 因此这里**禁止**回落到任何门店维度的密钥。
     * 对应环境变量：WECHAT_PARTNER_API_V3_KEY
     */
    apiV3Key: process.env.WECHAT_PARTNER_API_V3_KEY ?? '',

    /**
     * 服务商 API 证书序列号（serial_no），用于 Authorization 头。
     *
     * 独立配置项而非复用 wechat.mchSerialNo：两者虽可能取同一份证书，
     * 但消费方（签名链路）不同，独立命名才能做到「改一份不影响另一条链路」。
     * 对应环境变量：WECHAT_PARTNER_MCH_SERIAL_NO
     */
    serialNo: process.env.WECHAT_PARTNER_MCH_SERIAL_NO ?? '',

    /**
     * 服务商 API RSA 私钥文件路径（PEM），优先使用文件路径。
     * 对应环境变量：WECHAT_PARTNER_PRIVATE_KEY_PATH
     */
    privateKeyPath: process.env.WECHAT_PARTNER_PRIVATE_KEY_PATH ?? '',

    /**
     * 服务商 API RSA 私钥内容（PEM 内联），次优先级，用于 Docker secret 注入。
     * 对应环境变量：WECHAT_PARTNER_PRIVATE_KEY_CONTENT
     */
    privateKeyContent: process.env.WECHAT_PARTNER_PRIVATE_KEY_CONTENT ?? '',

    /**
     * 微信支付平台证书公钥（服务商商户号维度下载，PEM 内联），
     * 用于校验链路 a 回调的 Wechatpay-Signature。
     *
     * ⚠️ 平台证书是**按商户号维度**下发的：sp_mchid ≠ payMchId 时，
     * 服务商维度的平台证书与平台商户号的平台证书是两份不同证书，
     * 共用一份必然导致其中一条链路验签失败。
     * 对应环境变量：WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT
     */
    platformPublicKeyContent:
      process.env.WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT ?? '',

    /**
     * 服务商模式下发起支付的小程序 appid（sp_appid）。
     *
     * 未显式配置时回落 wechat.appId（purelyClub 小程序 AppID）——单向读取、
     * 不改动原配置；待 Q2 确认「purelyClub AppID 是否直接作为 sp_appid」后
     * 再决定是否需要按商家收集 sub_appid。
     * 对应环境变量：WECHAT_PARTNER_SP_APP_ID
     */
    spAppId:
      process.env.WECHAT_PARTNER_SP_APP_ID?.trim() ||
      process.env.WECHAT_APP_ID ||
      '',

    /**
     * 服务商模式的支付回调通知地址：必须是已备案的 HTTPS 公网地址，
     * 且指向 C 端订单回调路由 `/api/club/payments/wechat/callback`。
     * 对应环境变量：WECHAT_PARTNER_PAY_NOTIFY_URL
     */
    notifyUrl: process.env.WECHAT_PARTNER_PAY_NOTIFY_URL ?? '',

    /**
     * 豁免开关：允许 spMchId 与 wechat.payMchId 相等。
     *
     * 仅在确认「现有平台收款商户号本身就是微信支付服务商商户号」时才可开启，
     * 且必须同时填写 sharedMchIdReason 留档。禁止为了绕过启动校验随手打开。
     * 对应环境变量：WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID
     */
    allowSharedPlatformMchId:
      (process.env.WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID ?? 'false') ===
      'true',

    /**
     * 豁免原因留档（配合 allowSharedPlatformMchId 使用），空值视为未留档。
     * 对应环境变量：WECHAT_PARTNER_SHARED_MCH_ID_REASON
     */
    sharedMchIdReason: process.env.WECHAT_PARTNER_SHARED_MCH_ID_REASON ?? '',
  };
}
