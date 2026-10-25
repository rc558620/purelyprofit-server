import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import {
  CLUB_PAYMENT_MODE_KEY,
  CLUB_PAYMENT_MODE_TTL_SECONDS,
  type ClubPaymentMode,
} from './club-payment-mode.constants';

/**
 * 归一化支付模式。
 *
 * 忽略首尾空白与大小写，避免 `CLUB_PAYMENT_MODE="live "`、`"Test"` 这类
 * 配置漂移被静默判成默认模式；其余任何非法值一律按安全侧回落为 `test`。
 */
const normalizePaymentMode = (value: string | undefined): ClubPaymentMode =>
  value?.trim().toLowerCase() === 'live' ? 'live' : 'test';

/**
 * 俱乐部侧支付模式服务。
 *
 * 负责「测试模式 / 真实模式」的读取、切换与裁决，是「能否跳过真实扣款」的唯一权威来源：
 * - 生产环境：恒为 `live`，禁止任何运行期状态覆盖，手动确认支付（confirm-paid）一律不可用；
 * - 非生产环境：以 `club.manualConfirmPaidEnabled` 作为配置默认模式，
 *   在配置了访问令牌且开关打开的前提下，允许运行期覆盖 12 小时（TTL 到期自动回落到安全侧）。
 *
 * ⚠️ 这里是资金安全边界：任何放宽都必须同步检查
 * `bootstrap/production-config.utils.ts` 的生产启动校验。
 */
@Injectable()
export class ClubPaymentModeService {
  private readonly logger = new Logger(ClubPaymentModeService.name);
  private readonly nodeEnv: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';
    // 启动即打一次支付模式基线，便于事后追溯「为什么会真实扣款 / 为什么付不了款」
    this.logger.log(
      `[支付模式] 配置默认模式=${this.getConfiguredMode()}，运行期可切换=${this.isSwitchEnabled()}，nodeEnv=${this.nodeEnv}`,
    );
  }

  /** 当前是否处于生产环境。 */
  isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /** 是否允许通过 dev-only 接口在运行期切换支付模式；生产环境恒为 false。 */
  isSwitchEnabled(): boolean {
    if (this.isProduction()) {
      return false;
    }
    return (
      this.configService.get<boolean>('club.paymentModeSwitchEnabled') === true
    );
  }

  /**
   * 校验 dev-only 开关接口的访问令牌。
   * 未配置令牌时一律拒绝，避免测试环境公网可达时被任意切换到真实扣款。
   */
  isDevTokenValid(devToken?: string): boolean {
    const expectedToken =
      this.configService.get<string>('club.paymentModeDevToken') ?? '';
    if (!expectedToken) {
      return false;
    }
    return typeof devToken === 'string' && devToken === expectedToken;
  }

  /** 服务端是否已配置切换访问令牌。 */
  isDevTokenConfigured(): boolean {
    return (
      (this.configService.get<string>('club.paymentModeDevToken') ?? '')
        .length > 0
    );
  }

  /** 运行期模式状态的 TTL（秒），到期后自动回落。 */
  getModeTtlSeconds(): number {
    return CLUB_PAYMENT_MODE_TTL_SECONDS;
  }

  /**
   * 读取当前支付模式。
   *
   * 生产环境恒返回 `live`；非生产环境在允许切换时优先取运行期状态，
   * key 不存在（含 TTL 到期）时按安全侧回落为 `test`，避免遗忘在真实扣款状态。
   */
  async getMode(): Promise<ClubPaymentMode> {
    const mode = await this.readRawMode();

    // 一致性闸门：对外返回的模式必须等于「订单到底能不能跳过真实扣款」。
    // 配置默认 live 时，运行期即使被切成 test 也不会真的放行，
    // 若这里仍回 test，前端会展示「测试模式」却在下单时真实扣款。
    if (mode === 'test' && this.getConfiguredMode() !== 'test') {
      return 'live';
    }

    return mode;
  }

  /** 未做一致性收敛的原始模式（生产恒 live） */
  private async readRawMode(): Promise<ClubPaymentMode> {
    if (this.isProduction()) {
      return 'live';
    }

    if (!this.isSwitchEnabled()) {
      return this.getConfiguredMode();
    }

    try {
      const runtimeMode = await this.redisService.get(CLUB_PAYMENT_MODE_KEY);
      return runtimeMode ? normalizePaymentMode(runtimeMode) : 'test';
    } catch (error) {
      // Redis 只是模式状态的加速层，不能成为唯一数据源：
      // 读取失败时按安全侧回落为 test，保证测试链路不被缓存故障阻断。
      this.logger.warn('[支付模式] 运行期模式读取失败，按安全侧回落为 test');
      this.logger.debug(String(error));
      return 'test';
    }
  }

  /**
   * 切换运行期支付模式。
   * @param mode 目标模式
   * @returns 切换后的实际模式
   */
  async setMode(mode: ClubPaymentMode): Promise<ClubPaymentMode> {
    await this.redisService.set(
      CLUB_PAYMENT_MODE_KEY,
      mode,
      CLUB_PAYMENT_MODE_TTL_SECONDS,
    );
    this.logger.warn(
      `[支付模式] 已切换为 ${mode} 模式，${CLUB_PAYMENT_MODE_TTL_SECONDS} 秒后自动回落为 test`,
    );
    return mode;
  }

  /**
   * 当前是否允许手动确认支付（跳过微信回调直接把订单置为已支付）。
   *
   * 资金安全双重闸门：
   * 1. 生产环境恒为 false；
   * 2. 非生产环境还要求配置默认开关打开 **且** 运行期模式处于 test。
   */
  async isManualConfirmPaidAllowed(): Promise<boolean> {
    if (this.isProduction()) {
      return false;
    }
    // getMode() 已收敛过「模式 ↔ 能否跳过扣款」，直接取用即可，
    // 避免两处判断各自演化出「展示 test、实际不放行」的偏差
    return (await this.getMode()) === 'test';
  }

  /**
   * 读取配置文件中的默认支付模式。
   * `club.manualConfirmPaidEnabled` 为 true 表示默认允许跳过真实扣款，即 test 模式。
   */
  getConfiguredMode(): ClubPaymentMode {
    const manualConfirmPaidEnabled =
      this.configService.get<boolean>('club.manualConfirmPaidEnabled') ?? false;
    return manualConfirmPaidEnabled ? 'test' : 'live';
  }
}
