import { parseIntValue } from './env.utils';

/** 短信计费字数统计口径。 */
export type SmsSegmentCountMode = 'utf16' | 'codepoint';

/**
 * `tencentSms` 配置块：腾讯云短信服务。
 *
 * 用于注册、登录、找回密码等场景的验证码发送。
 * 未配置时 AuthSmsService 降级为仅打印日志（开发模式）。
 */
export interface TencentSmsConfig {
  /** 腾讯云 SecretId（访问管理 → API 密钥管理） */
  secretId: string;
  /** 腾讯云 SecretKey（与 SecretId 配对，严禁泄露） */
  secretKey: string;
  /** 短信 SDK AppId（短信控制台 → 应用管理 → 应用列表） */
  sdkAppId: string;
  /** 短信签名（短信控制台 → 签名管理，需审核通过） */
  signName: string;
  /** 注册验证码模板 ID */
  registerTemplateId: string;
  /** 登录验证码模板 ID */
  loginTemplateId: string;
  /** 绑定 / 换绑手机号验证码模板 ID */
  bindPhoneTemplateId: string;
  /** 找回密码验证码模板 ID */
  passwordResetTemplateId: string;
  /** 营销类短信模板 ID（群发专用） */
  marketingTemplateId: string;
}

/**
 * `sms` 配置块：群发短信（营销中心 → 短信钱包）。
 *
 * 全部走配置而非硬编码：单价、告警阈值、充值档位都属于运营口径，
 * 改动不应触发发版。未配置时回落到 sms.constants.ts 的兜底值。
 */
export interface SmsWalletConfig {
  /** 短信单价（分/条），对应 SMS_UNIT_PRICE_FEN */
  unitPriceFen: number;
  /** 余额告警阈值（分），对应 SMS_WARNING_THRESHOLD_FEN */
  warningThresholdFen: number;
  /** 充值档位（分）：不含任何赠送，赠送由运营侧发放并计入 grant 流水 */
  rechargeTiersFen: number[];
  /** 单条短信字数上限（超出按长短信拆分） */
  segmentSingleLimit: number;
  /** 长短信每段字数上限 */
  segmentLongLimit: number;
  /** 微信 Native 支付回调地址（短信钱包专用） */
  wechatPayNotifyUrl: string;
  /** 腾讯云送达状态回执的校验口令 */
  deliveryCallbackToken: string;
  /** 短信计费字数统计口径 */
  segmentCountMode: SmsSegmentCountMode;
  /** 平台短信采购成本（分/条），用于毛利监控；0 表示不告警 */
  costPriceFen: number;
}

/** 短信相关配置：腾讯云短信服务 + 短信钱包运营口径。 */
export interface SmsConfig {
  tencentSms: TencentSmsConfig;
  sms: SmsWalletConfig;
}

/** 解析 `tencentSms` 配置块。 */
export function resolveTencentSmsConfig(): TencentSmsConfig {
  return {
    /** 腾讯云 SecretId（访问管理 → API 密钥管理） */
    secretId: process.env.TENCENT_SMS_SECRET_ID ?? '',
    /** 腾讯云 SecretKey（与 SecretId 配对，严禁泄露） */
    secretKey: process.env.TENCENT_SMS_SECRET_KEY ?? '',
    /** 短信 SDK AppId（短信控制台 → 应用管理 → 应用列表） */
    sdkAppId: process.env.TENCENT_SMS_SDK_APP_ID ?? '',
    /** 短信签名（短信控制台 → 签名管理，需审核通过） */
    signName: process.env.TENCENT_SMS_SIGN_NAME ?? '',
    /** 注册验证码模板 ID */
    registerTemplateId: process.env.TENCENT_SMS_REGISTER_TEMPLATE_ID ?? '',
    /**
     * 登录验证码模板 ID。
     *
     * ⚠️ 命名与真实用途已脱节：该模板同时服务注册后登录、purely-club 登录即注册，
     * 以及绑定 / 换绑手机号（后者在 `bindPhoneTemplateId` 未配置时回落到这里）。
     * 清理配置时不可仅凭「登录不要验证码」就删除，否则会打断 club 的手机号绑定。
     */
    loginTemplateId: process.env.TENCENT_SMS_LOGIN_TEMPLATE_ID ?? '',
    /**
     * 绑定 / 换绑手机号验证码模板 ID。
     *
     * 该场景历史上复用登录模板，导致用户执行「绑定手机号」时收到
     * 「您正在登录账号」的文案，语义错配且易被运营商判定为业务不符。
     *
     * 腾讯云模板需单独申请审核，因此设计为「提前接线 + 按需启用」：
     * 未配置时 AuthSmsService 自动回落 loginTemplateId，
     * 保证未申请该模板前线上行为完全不变，不会被空模板 ID 阻断。
     * 对应环境变量：TENCENT_SMS_BIND_PHONE_TEMPLATE_ID
     */
    bindPhoneTemplateId: process.env.TENCENT_SMS_BIND_PHONE_TEMPLATE_ID ?? '',
    /** 找回密码验证码模板 ID */
    passwordResetTemplateId:
      process.env.TENCENT_SMS_PASSWORD_RESET_TEMPLATE_ID ?? '',
    /**
     * 营销类短信模板 ID（群发专用）。
     *
     * ⚠️ 必须与上面三个验证码模板区分：腾讯云对验证码模板有严格限流且
     * **不允许群发**，用验证码模板走群发会被通道直接拒绝。
     * 对应环境变量：TENCENT_SMS_MARKETING_TEMPLATE_ID
     */
    marketingTemplateId: process.env.TENCENT_SMS_MARKETING_TEMPLATE_ID ?? '',
  };
}

/** 解析 `sms` 配置块。 */
export function resolveSmsWalletConfig(): SmsWalletConfig {
  return {
    /** 短信单价（分/条），对应 SMS_UNIT_PRICE_FEN */
    unitPriceFen: parseIntValue(process.env.SMS_UNIT_PRICE_FEN, 5),
    /** 余额告警阈值（分），对应 SMS_WARNING_THRESHOLD_FEN */
    warningThresholdFen: parseIntValue(
      process.env.SMS_WARNING_THRESHOLD_FEN,
      500,
    ),
    /**
     * 充值档位（分，英文逗号分隔）。**不含任何赠送**——赠送由 purelyPulse
     * 侧发放并计入 grant 流水，档位里没有 bonus 字段。
     * 对应环境变量：SMS_RECHARGE_TIERS_FEN
     */
    rechargeTiersFen: (
      process.env.SMS_RECHARGE_TIERS_FEN ?? '1000,5000,10000,30000,50000'
    )
      .split(',')
      .map((value) => parseIntValue(value.trim(), 0))
      .filter((value) => value > 0),
    /** 单条短信字数上限（超出按长短信拆分） */
    segmentSingleLimit: parseIntValue(process.env.SMS_SEGMENT_SINGLE_LIMIT, 70),
    /** 长短信每段字数上限 */
    segmentLongLimit: parseIntValue(process.env.SMS_SEGMENT_LONG_LIMIT, 67),
    /**
     * 微信 Native 支付回调地址（短信钱包专用）。
     * ⚠️ 不能复用 WECHAT_PAY_NOTIFY_URL：那是 purelyClub C 端订单回调，
     * 走的是另一套上下文与落账逻辑。
     */
    wechatPayNotifyUrl: process.env.SMS_WECHAT_PAY_NOTIFY_URL ?? '',
    /**
     * 注意：这里曾有 `SMS_RECHARGE_DIRECT_CREDIT` 场景级直充开关，
     * 与全局支付模式「取或」后会覆盖全局 `live`，已删除。
     * 现在是否跳过微信支付**只**由
     * `ProfitPaymentModeService.isSkipPaymentAllowed()` 单点裁决。
     */
    /**
     * 腾讯云**送达状态回执**的校验口令。
     *
     * 回执是公网 HTTP 推送、且腾讯侧没有请求签名，防护只能靠：
     * 1. 不易猜的回调路径（见 SMS_DELIVERY_CALLBACK_PATH）；
     * 2. 这里的可选口令——配置了就要求请求带上，带了必须对得上。
     *
     * 校验位置：`X-Sms-Delivery-Token` 请求头或 query `token`。
     * 不配置时不做口令校验（字段匹配不到就没人动钱，退费链路天然无害）。
     * 对应环境变量：SMS_DELIVERY_CALLBACK_TOKEN
     */
    deliveryCallbackToken: process.env.SMS_DELIVERY_CALLBACK_TOKEN ?? '',
    /**
     * 短信计费字数统计口径：`utf16`（默认）| `codepoint`。
     *
     * 默认 `utf16`：腾讯云按 UCS-2 计费，用它才能做到「商户消耗多少付多少」。
     * 之前用 codepoint 会让含 emoji 的正文少算段数、少收钱，差额由平台承担。
     * 保留 `codepoint` 仅用于回滚。
     *
     * ⚠️ 切换会改变含 emoji 短信的扣费金额。询价会把口径固化进快照，
     * 因此切换过程中不会出现「询价与扣款不一致」。
     * 对应环境变量：SMS_SEGMENT_COUNT_MODE
     */
    segmentCountMode:
      process.env.SMS_SEGMENT_COUNT_MODE === 'codepoint'
        ? 'codepoint'
        : 'utf16',
    /**
     * 平台短信**采购成本**（分/条）。用于毛利监控：
     * 配置后，若售价 `unitPriceFen` 不高于它，每次群发都会打 ERROR 告警
     * （那意味着每发一条都在亏，与退费策略无关）。
     *
     * 未配置（0）时不告警。**填上真实采购价才能发现倒挂。**
     * 对应环境变量：SMS_COST_PRICE_FEN
     */
    costPriceFen: parseIntValue(process.env.SMS_COST_PRICE_FEN, 0),
  };
}

/** 解析短信相关配置（tencentSms / sms）。 */
export function resolveSmsConfig(): SmsConfig {
  return {
    tencentSms: resolveTencentSmsConfig(),
    sms: resolveSmsWalletConfig(),
  };
}
