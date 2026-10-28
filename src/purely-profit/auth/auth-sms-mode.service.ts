import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import {
  AUTH_SMS_MODE_KEY,
  AUTH_SMS_MODE_TTL_SECONDS,
  type SmsMode,
} from './auth.constants';

/**
 * 归一化短信通道模式。
 *
 * 忽略首尾空白与大小写，避免 `AUTH_SMS_MODE="live "`、`"Live"` 这类
 * 配置漂移被静默判成测试模式（生产环境后果是短信完全发不出去）。
 * 其余任何非法值一律回落为测试模式。
 */
const normalizeSmsMode = (value: string | undefined): SmsMode =>
  value?.trim().toLowerCase() === 'live' ? 'live' : 'mock';

/**
 * 短信通道模式服务。
 *
 * 负责短信「测试模式 / 真实接通模式」的读取、切换与裁决，是通道选择的唯一权威来源：
 * - 生产环境：强制按配置默认值执行，忽略任何运行期状态与切换请求；
 * - 非生产环境：允许在配置了访问令牌的前提下通过 dev-only 接口运行期切换；
 * - 配置了手机号白名单时，名单外手机号即使在 live 模式也降级为测试模式。
 */
@Injectable()
export class AuthSmsModeService {
  private readonly logger = new Logger(AuthSmsModeService.name);
  private readonly nodeEnv: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';
    // 启动即打一次通道基线，便于事后追溯「为什么没发短信」
    this.logger.log(
      `[短信通道] 配置默认模式=${this.getConfiguredMode()}，运行期可切换=${this.isSwitchEnabled()}，nodeEnv=${this.nodeEnv}`,
    );
  }

  /** 当前是否处于生产环境。 */
  isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /** 是否允许通过 dev-only 接口在运行期切换通道；生产环境恒为 false。 */
  isSwitchEnabled(): boolean {
    if (this.isProduction()) {
      return false;
    }
    return (
      this.configService.get<boolean>('auth.smsModeSwitchEnabled') === true
    );
  }

  /**
   * 校验 dev-only 开关接口的访问令牌。
   * 未配置令牌时一律拒绝，避免测试环境公网可达时被任意切换通道。
   */
  isDevTokenValid(devToken?: string): boolean {
    const expectedToken =
      this.configService.get<string>('auth.smsModeDevToken') ?? '';
    if (!expectedToken) {
      return false;
    }
    return typeof devToken === 'string' && devToken === expectedToken;
  }

  /** 服务端是否已配置切换访问令牌。 */
  isDevTokenConfigured(): boolean {
    return (
      (this.configService.get<string>('auth.smsModeDevToken') ?? '').length > 0
    );
  }

  /** 是否配置了 live 通道手机号白名单。 */
  isLiveWhitelistEnabled(): boolean {
    return (
      (this.configService.get<string[]>('auth.smsLiveAllowedPhones') ?? [])
        .length > 0
    );
  }

  /** 读取当前短信通道模式：允许切换时优先取运行期状态，否则取配置默认值。 */
  async getMode(): Promise<SmsMode> {
    if (!this.isSwitchEnabled()) {
      return this.getConfiguredMode();
    }

    try {
      const runtimeMode = await this.redisService.get(AUTH_SMS_MODE_KEY);
      return runtimeMode
        ? normalizeSmsMode(runtimeMode)
        : this.getConfiguredMode();
    } catch (error) {
      // Redis 只是模式状态的加速层，不能成为唯一数据源：
      // 读取失败时回落为配置默认值，保证验证码链路不被缓存故障阻断。
      this.logger.warn('[短信通道] 运行期模式读取失败，回落为配置默认值');
      this.logger.debug(String(error));
      return this.getConfiguredMode();
    }
  }

  /**
   * 切换运行期短信通道模式。
   * @param mode 目标模式
   * @returns 切换后的实际模式
   */
  async setMode(mode: SmsMode): Promise<SmsMode> {
    await this.redisService.set(
      AUTH_SMS_MODE_KEY,
      mode,
      AUTH_SMS_MODE_TTL_SECONDS,
    );
    this.logger.warn(
      `[短信通道] 已切换为 ${mode} 模式，${AUTH_SMS_MODE_TTL_SECONDS} 秒后自动回落为配置默认值`,
    );
    return mode;
  }

  /**
   * 判断给定手机号在当前通道模式下是否应真实发送短信。
   * 配置了白名单时，名单外手机号一律降级为测试模式。
   * @param phone 纯数字手机号
   */
  async shouldSendLive(phone: string): Promise<boolean> {
    const mode = await this.getMode();
    if (mode !== 'live') {
      return false;
    }

    const allowedPhones =
      this.configService.get<string[]>('auth.smsLiveAllowedPhones') ?? [];
    if (allowedPhones.length === 0) {
      return true;
    }

    return allowedPhones.includes(phone);
  }

  /**
   * 启动期校验「响应中回传验证码明文」开关，避免危险配置被静默带上线。
   *
   * `AuthCodeService.isExposeCodeEnabled` 只在**运行期**用「本次是否真实发送」
   * 做了兜底，但兜底挡不住配置组合事故：生产一旦误配 `AUTH_SMS_MODE=mock`，
   * `shouldSendLive` 恒为 false，明文回传会被永久激活，
   * 任何人都能凭接口返回的验证码完成登录与手机号绑定。
   *
   * 因此生产环境直接 fail-fast（启动即失败，而不是带病运行），
   * 非生产环境仅打出醒目告警：mock 模式下验证码依然写入 Redis 且校验有效，
   * 该环境必须保证不公网可达。
   */
  assertExposeCodeConfig(): void {
    if (this.configService.get<boolean>('auth.exposeCodeInResponse') !== true) {
      return;
    }

    if (this.isProduction()) {
      throw new Error(
        '生产环境禁止启用 AUTH_EXPOSE_CODE_IN_RESPONSE：' +
          '验证码明文会随响应返回，等同于绕过短信校验。请移除该配置后重启。',
      );
    }

    this.logger.warn(
      '[验证码明文回传已开启] AUTH_EXPOSE_CODE_IN_RESPONSE=true，' +
        '验证码将随接口响应返回。该环境严禁公网可达——' +
        'mock 模式下验证码同样写入 Redis 且校验有效，' +
        '泄露后任何人可凭返回验证码完成登录与手机号绑定。',
    );
  }

  /** 读取配置文件中的默认短信通道模式。 */
  private getConfiguredMode(): SmsMode {
    return normalizeSmsMode(this.configService.get<string>('auth.smsMode'));
  }
}
