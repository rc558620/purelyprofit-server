import { normalizeNodeEnv, parseIntValue } from './env.utils';
import { AppConfig, resolveAppConfig } from './app.configuration';
import { AlertConfig, resolveAlertConfig } from './alert.configuration';
import { AuthConfig, resolveAuthConfig } from './auth.configuration';
import {
  ClusterConfig,
  DatabaseConfig,
  JwtConfig,
  RedisConfig,
  resolveInfrastructureConfig,
} from './infrastructure.configuration';
import {
  PrintAgentConfig,
  FeiePrintConfig,
  resolvePrintConfig,
  UsbPrintConfig,
} from './print.configuration';
import {
  ClubConfig,
  ProfitConfig,
  PulseConfig,
  resolveClubConfig,
  resolveProfitConfig,
  resolvePulseConfig,
} from './product-line.configuration';
import {
  resolveScanOrderingConfig,
  ScanOrderingConfig,
} from './scan-ordering.configuration';
import {
  resolveSmsConfig,
  SmsWalletConfig,
  TencentSmsConfig,
} from './sms.configuration';
import { resolveSpaceConfig, SpaceConfig } from './space.configuration';
import {
  resolveTencentCosConfig,
  TencentCosConfig,
} from './storage.configuration';
import { resolveWechatConfig, WechatConfig } from './wechat.configuration';

/**
 * 全量应用配置。
 *
 * 这里是配置的**唯一装配入口**：只负责把各配置块拼装成完整对象，
 * 具体字段解析与默认值策略下沉到同目录的 `*.configuration.ts`，
 * 通用解析能力集中在 `env.utils.ts`。
 *
 * 配置键的层级即 `ConfigService.get()` 的路径（如 `app.corsOrigin`、
 * `wechat.partner.spMchId`），调整结构前必须同步检查消费方。
 */
export interface AppConfiguration {
  port: number;
  nodeEnv: string;
  app: AppConfig;
  database: DatabaseConfig;
  cluster: ClusterConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
  scanOrdering: ScanOrderingConfig;
  space: SpaceConfig;
  printAgent: PrintAgentConfig;
  feiePrint: FeiePrintConfig;
  usbPrint: UsbPrintConfig;
  auth: AuthConfig;
  pulse: PulseConfig;
  profit: ProfitConfig;
  club: ClubConfig;
  wechat: WechatConfig;
  tencentSms: TencentSmsConfig;
  sms: SmsWalletConfig;
  tencentCos: TencentCosConfig;
  alert: AlertConfig;
}

/** 装配全量应用配置（供 `ConfigModule.load` 与启动期校验使用）。 */
const buildConfiguration = (): AppConfiguration => ({
  port: parseIntValue(process.env.PORT, 3000),
  nodeEnv: normalizeNodeEnv(process.env.NODE_ENV),

  app: resolveAppConfig(),
  // database / cluster / redis / jwt
  ...resolveInfrastructureConfig(),

  scanOrdering: resolveScanOrderingConfig(),
  space: resolveSpaceConfig(),
  // printAgent / feiePrint / usbPrint
  ...resolvePrintConfig(),

  auth: resolveAuthConfig(),

  // 三条产品线各自独立的支付模式与开关，禁止跨线复用
  pulse: resolvePulseConfig(),
  profit: resolveProfitConfig(),
  club: resolveClubConfig(),

  wechat: resolveWechatConfig(),

  // tencentSms / sms
  ...resolveSmsConfig(),
  tencentCos: resolveTencentCosConfig(),

  alert: resolveAlertConfig(),
});

export default buildConfiguration;
