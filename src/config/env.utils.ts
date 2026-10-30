/**
 * 配置解析工具。
 *
 * 仅服务于 `src/config/*` 下的配置入口：除配置入口（如 `configuration.ts`、
 * `prisma.config.ts`）外，业务代码禁止直接读取 `process.env`，
 * 应统一通过 `ConfigService` 读取已解析完成的配置对象。
 */

/**
 * 默认允许「跳过真实扣款」的环境白名单：只认本地开发与自动化测试。
 *
 * staging / pre / 预发 / 任何未列入白名单的环境一律按真实模式处理（fail-closed），
 * 禁止把「非 production」当成「可以免费下单」的通行证。
 */
const TEST_MODE_DEFAULT_ENV_WHITELIST = ['development', 'test'];

/** 逗号分隔字符串解析为字符串数组：去首尾空白、丢弃空项。 */
export function parseStringList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 解析整数配置，缺失 / 空白 / 非数字一律回落到兜底值。
 *
 * 与裸 `parseInt` 的差别只在非法取值：原先会产出 NaN 并一路传导到端口、
 * 连接池、超时、分页等运行参数，这里统一回落到安全默认值。
 */
export function parseIntValue(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 解析正整数配置，失败时用兜底值。
 *
 * 定时任务 / 兜底扫描类配置写错不应该让进程起不来或任务崩掉：
 * 缺失、空白、负数、0、非数字一律回落到安全默认值。
 */
export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(parsed)) {
    return fallback;
  }
  const floored = Math.floor(parsed);
  return floored > 0 ? floored : fallback;
}

/**
 * 归一化运行环境名：忽略首尾空白与大小写，空值兜底为 development。
 *
 * `NODE_ENV=Production` / `NODE_ENV="production "` 这类写法此前会被判成非生产，
 * 从而让生产启动校验、支付模式硬禁用等资金安全闸门被整体跳过。
 */
export function normalizeNodeEnv(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase() || 'development';
}

/**
 * 当前环境是否属于「默认允许测试模式」的白名单环境。
 *
 * 用于支付模式、短信通道、回调验签等 fail-closed 类开关的默认值推导：
 * 白名单外一律按真实（live）模式处理。
 */
export function isTestModeDefaultEnvironment(): boolean {
  return TEST_MODE_DEFAULT_ENV_WHITELIST.includes(
    normalizeNodeEnv(process.env.NODE_ENV),
  );
}
