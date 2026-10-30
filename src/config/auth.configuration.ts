import { parseIntValue, parseStringList } from './env.utils';

/** `auth` 配置块：登录注册、验证码、RSA 加密与短信通道。 */
export interface AuthConfig {
  passwordResetCodeTtlSeconds: number;
  registerCodeTtlSeconds: number;
  smsSendCooldownSeconds: number;
  /** Refresh token 有效期（秒），默认 30 天 */
  refreshTokenTtlSeconds: number;
  /** Admin 登录账号别名，用于系统默认管理员快速登录 */
  adminLoginAlias: string;
  /** Admin 登录手机号，用于关联系统默认管理员账号 */
  adminLoginPhone: string;
  /** RSA 公钥（PEM 格式），用于登录加密；不配置时自动生成 */
  rsaPublicKey: string;
  /** RSA 私钥（PEM 格式），用于解密前端加密的密码字段；不配置时自动生成 */
  rsaPrivateKey: string;
  /** 是否在 API 响应中暴露验证码明文（仅限本地开发调试） */
  exposeCodeInResponse: boolean;
  /** 是否启用「微信 getPhoneNumber」一键绑定手机号入口 */
  wechatPhoneBindEnabled: boolean;
  /** 短信发送通道模式：mock = 仅打印日志，live = 真实接通腾讯云短信 */
  smsMode: string;
  /** 是否允许通过 dev-only 开关接口在运行期切换短信通道 */
  smsModeSwitchEnabled: boolean;
  /** dev-only 短信通道开关接口的访问令牌 */
  smsModeDevToken: string;
  /** live 通道下允许真实发送短信的手机号白名单，为空表示不限制 */
  smsLiveAllowedPhones: string[];
}

/** 解析 `auth` 配置块。 */
export function resolveAuthConfig(): AuthConfig {
  return {
    passwordResetCodeTtlSeconds: parseIntValue(
      process.env.AUTH_PASSWORD_RESET_CODE_TTL_SECONDS,
      600,
    ),
    registerCodeTtlSeconds: parseIntValue(
      process.env.AUTH_REGISTER_CODE_TTL_SECONDS,
      600,
    ),
    smsSendCooldownSeconds: parseIntValue(
      process.env.AUTH_SMS_SEND_COOLDOWN_SECONDS,
      60,
    ),
    /**
     * Refresh token 有效期（秒），默认 30 天。
     * 对应环境变量：AUTH_REFRESH_TOKEN_TTL_SECONDS
     */
    refreshTokenTtlSeconds: parseIntValue(
      process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      2592000,
    ),
    /**
     * Admin 登录账号别名，用于系统默认管理员快速登录。
     * 生产环境务必通过环境变量覆盖，避免使用默认值。
     * 对应环境变量：AUTH_ADMIN_LOGIN_ALIAS
     */
    adminLoginAlias: process.env.AUTH_ADMIN_LOGIN_ALIAS ?? 'admin',
    /**
     * Admin 登录手机号，用于关联系统默认管理员账号。
     * 生产环境务必通过环境变量覆盖，避免使用默认值。
     * 对应环境变量：AUTH_ADMIN_LOGIN_PHONE
     */
    adminLoginPhone: process.env.AUTH_ADMIN_LOGIN_PHONE ?? '13619654020',
    /**
     * RSA 公钥（PEM 格式），用于登录加密。
     * 不配置时自动生成（进程重启后轮换）。
     * 对应环境变量：AUTH_RSA_PUBLIC_KEY
     */
    rsaPublicKey: process.env.AUTH_RSA_PUBLIC_KEY ?? '',
    /**
     * RSA 私钥（PEM 格式），用于解密前端加密的密码字段。
     * 不配置时自动生成（进程重启后轮换）。
     * 对应环境变量：AUTH_RSA_PRIVATE_KEY
     */
    rsaPrivateKey: process.env.AUTH_RSA_PRIVATE_KEY ?? '',
    /**
     * 是否在 API 响应中暴露验证码明文（仅限本地开发调试）。
     * 默认关闭，生产 / staging / QA 环境禁止启用。
     * 对应环境变量：AUTH_EXPOSE_CODE_IN_RESPONSE
     */
    exposeCodeInResponse:
      (process.env.AUTH_EXPOSE_CODE_IN_RESPONSE ?? 'false') === 'true',
    /**
     * 是否启用「微信 getPhoneNumber」一键绑定手机号入口
     * （`POST /club/auth/bind-phone/by-wechat-code`）。
     *
     * 该能力要求小程序**已通过微信认证**（个人主体不可用），因此被主体变更阻塞；
     * 接口与前端接线可提前就绪，认证通过后把本开关打开即可生效，**无需再改代码**。
     *
     * 默认关闭：未认证时启用只会让每次调用都被微信侧拒绝，
     * 不如显式关闭并给出明确提示。
     * 对应环境变量：AUTH_WECHAT_PHONE_BIND_ENABLED
     */
    wechatPhoneBindEnabled:
      (process.env.AUTH_WECHAT_PHONE_BIND_ENABLED ?? 'false') === 'true',
    /**
     * 短信发送通道模式。
     * - `mock`：测试模式，仅打印日志、不真实发送（现状行为）
     * - `live`：真实接通腾讯云短信
     *
     * 未显式配置时按环境推导：生产默认 `live`，其余环境默认 `mock`。
     * 对应环境变量：AUTH_SMS_MODE
     */
    smsMode:
      // 空串 / 纯空白也必须回落到按环境推导，否则生产配成 `AUTH_SMS_MODE=`
      // 会被判成测试模式，短信静默失效且无任何报错
      (process.env.AUTH_SMS_MODE ?? '').trim() ||
      (process.env.NODE_ENV === 'production' ? 'live' : 'mock'),
    /**
     * 是否允许通过 dev-only 开关接口在运行期切换短信通道。
     * 生产环境强制禁用（无论环境变量如何配置）。
     * 对应环境变量：AUTH_SMS_MODE_SWITCH_ENABLED
     */
    smsModeSwitchEnabled:
      (process.env.AUTH_SMS_MODE_SWITCH_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    /**
     * dev-only 开关接口的访问令牌。
     * 未配置时开关接口一律拒绝写入，防止测试环境公网可达时被任意切换。
     * 对应环境变量：AUTH_SMS_MODE_DEV_TOKEN
     */
    smsModeDevToken: process.env.AUTH_SMS_MODE_DEV_TOKEN ?? '',
    /**
     * live 通道下允许真实发送短信的手机号白名单（逗号分隔）。
     * 为空表示不限制；只要配置了白名单，名单外手机号一律降级为测试模式。
     * 对应环境变量：AUTH_SMS_LIVE_ALLOWED_PHONES
     */
    smsLiveAllowedPhones: parseStringList(
      process.env.AUTH_SMS_LIVE_ALLOWED_PHONES,
    ),
  };
}
