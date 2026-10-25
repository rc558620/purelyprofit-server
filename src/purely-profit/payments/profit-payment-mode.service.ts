import { timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import {
  PROFIT_PAYMENT_MODE_KEY,
  PROFIT_PAYMENT_MODE_TTL_SECONDS,
  type ProfitPaymentMode,
} from './profit-payment-mode.constants';

/**
 * 归一化支付模式。
 *
 * 忽略首尾空白与大小写，避免配置漂移（`PROFIT_PAYMENT_MODE="live "`）被静默
 * 判成默认模式；任何非法值一律按**会真实扣款**的 live 处理 —— 这里与 club 侧
 * 刻意向相反一侧收口：商家端目前的「假支付」是直接发放会员权益与额度，
 * 猜错方向的代价（白送权益）比让流程失败更高。
 */
const normalizePaymentMode = (value: string | undefined): ProfitPaymentMode =>
  value?.trim().toLowerCase() === 'test' ? 'test' : 'live';

/**
 * 商家端（purelyProfit）支付模式服务。
 *
 * 负责「测试模式 / 真实模式」的读取、切换与裁决，是「能否跳过真实扣款、
 * 直接把订单置为已生效」的唯一权威来源：
 * - 生产环境：恒为 `live`，忽略任何运行期状态；
 * - 非生产环境：以 `profit.manualPaidEnabled` 作为配置默认模式，
 *   在配置了访问令牌且开关打开的前提下允许运行期覆盖 12 小时。
 *
 * ⚠️ 与 club 侧（ClubPaymentModeService）是两套独立开关：
 * 两条资金流方向不同、后果不同，混用一个开关会让「改一边影响另一边」。
 */
@Injectable()
export class ProfitPaymentModeService {
  private readonly logger = new Logger(ProfitPaymentModeService.name);
  private readonly nodeEnv: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';
    this.logger.log(
      `[Profit 支付模式] 配置默认模式=${this.getConfiguredMode()}，运行期可切换=${this.isSwitchEnabled()}，nodeEnv=${this.nodeEnv}`,
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
      this.configService.get<boolean>('profit.paymentModeSwitchEnabled') ===
      true
    );
  }

  /** 校验 dev-only 开关接口的访问令牌；未配置令牌时一律拒绝。 */
  isDevTokenValid(devToken?: string): boolean {
    const expectedToken = this.readDevToken();
    if (!expectedToken || typeof devToken !== 'string') {
      return false;
    }

    const expectedBuffer = Buffer.from(expectedToken, 'utf8');
    const providedBuffer = Buffer.from(devToken.trim(), 'utf8');
    // timingSafeEqual 要求等长入参；长度本身不是有效秘密，直接判失败不构成信息泄露
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    // 定长比较，避免逐字符短路比较泄露令牌前缀
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  /** 服务端是否已配置切换访问令牌。 */
  isDevTokenConfigured(): boolean {
    return this.readDevToken().length > 0;
  }

  /** 运行期模式状态的 TTL（秒），到期后自动回落。 */
  getModeTtlSeconds(): number {
    return PROFIT_PAYMENT_MODE_TTL_SECONDS;
  }

  /**
   * 读取当前支付模式。
   *
   * 生产环境恒返回 `live`；非生产环境优先取运行期状态，
   * key 不存在（含 TTL 到期）时回落为配置默认模式。
   */
  async getMode(): Promise<ProfitPaymentMode> {
    const mode = await this.readRawMode();

    // 一致性闸门：对外返回的模式必须等于「钱到底扣不扣」。
    // 否则配置默认 live、运行期又被切成 test 时，前端展示「测试模式」，
    // 实际却按真实扣款下单——用户以为免费，结果被扣钱。
    if (mode === 'test' && this.getConfiguredMode() !== 'test') {
      return 'live';
    }

    return mode;
  }

  /** 未做一致性收敛的原始模式（生产恒 live） */
  private async readRawMode(): Promise<ProfitPaymentMode> {
    if (this.isProduction()) {
      return 'live';
    }

    if (!this.isSwitchEnabled()) {
      return this.getConfiguredMode();
    }

    try {
      const runtimeMode = await this.redisService.get(PROFIT_PAYMENT_MODE_KEY);
      return runtimeMode
        ? normalizePaymentMode(runtimeMode)
        : this.getConfiguredMode();
    } catch (error) {
      // Redis 只是模式状态的加速层，不能成为唯一数据源：
      // 读取失败时回落为配置默认值，保证支付链路不被缓存故障阻断
      this.logger.warn(
        '[Profit 支付模式] 运行期模式读取失败，回落为配置默认值',
      );
      this.logger.debug(String(error));
      return this.getConfiguredMode();
    }
  }

  /** 切换运行期支付模式 */
  async setMode(mode: ProfitPaymentMode): Promise<ProfitPaymentMode> {
    // 防御性二次校验：本 Service 对外导出，不能只依赖 controller 的 404 伪装，
    // 否则将来任何模块注入后误调用都能在生产写运行期模式
    if (this.isProduction()) {
      throw new ForbiddenException('生产环境禁止切换支付模式');
    }
    if (!this.isSwitchEnabled()) {
      throw new ForbiddenException('支付模式切换开关未开启，禁止切换支付模式');
    }

    // 一致性闸门（与 getMode() 同一口径）：配置默认模式为 live 时运行期不允许切到 test。
    // 若这里仍静默写入 Redis，会出现「接口返回 200、日志说已切 test、实际仍按真实扣款」
    // 的误导状态，因此必须显式拒绝，让调用方立刻看到真实原因。
    if (mode === 'test' && this.getConfiguredMode() !== 'test') {
      throw new ConflictException(
        '配置默认模式为真实支付（PROFIT_MANUAL_PAID_ENABLED=false），运行期不允许切换到测试模式；请先在配置中打开该开关并重启服务',
      );
    }

    await this.redisService.set(
      PROFIT_PAYMENT_MODE_KEY,
      mode,
      PROFIT_PAYMENT_MODE_TTL_SECONDS,
    );
    this.logger.warn(
      `[Profit 支付模式] 已切换为 ${mode} 模式，${PROFIT_PAYMENT_MODE_TTL_SECONDS} 秒后自动回落为配置默认模式`,
    );
    return mode;
  }

  /**
   * 当前是否允许跳过真实扣款、直接把订单置为已生效。
   *
   * 资金安全闸门（与 club 侧同构）：生产环境恒 false；
   * 非生产环境还要求配置默认开关打开 **且** 运行期模式处于 test。
   */
  async isSkipPaymentAllowed(): Promise<boolean> {
    if (this.isProduction()) {
      return false;
    }
    // getMode() 已做过「模式 ↔ 是否真扣款」的一致性收敛，这里直接取用，
    // 避免两套判断各自演化后出现「展示 test、实际扣款」
    return (await this.getMode()) === 'test';
  }

  /**
   * 读取配置文件中的默认支付模式。
   * `profit.manualPaidEnabled` 为 true 表示默认允许跳过真实扣款。
   */
  getConfiguredMode(): ProfitPaymentMode {
    const manualPaidEnabled =
      this.configService.get<boolean>('profit.manualPaidEnabled') ?? false;
    return manualPaidEnabled ? 'test' : 'live';
  }

  /** 读取并归一化 dev-only 切换令牌（去首尾空白，未配置时为空串）。 */
  private readDevToken(): string {
    return (
      this.configService.get<string>('profit.paymentModeDevToken') ?? ''
    ).trim();
  }
}
