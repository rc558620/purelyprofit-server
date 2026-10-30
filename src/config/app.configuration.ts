import { parsePositiveInt, parseIntValue, parseStringList } from './env.utils';

/**
 * `app` 配置块：应用级运行参数。
 *
 * 覆盖 HTTP 服务、慢调用采样、缓存预热、空间自动签退、前端错误采集、
 * 限流、订单项归档与平台收款对账。
 */
export interface AppConfig {
  corsOrigin: string;
  swaggerEnabled: boolean;
  logEnabled: boolean;
  httpKeepAliveTimeoutMs: number;
  httpRequestTimeoutMs: number;
  httpBodyLimitBytes: number;
  portAutoTerminateEnabled: boolean;
  portAutoShiftEnabled: boolean;
  portAutoShiftMaxOffset: number;
  slowRequestLogEnabled: boolean;
  slowRequestThresholdMs: number;
  slowQueryLogEnabled: boolean;
  slowQueryThresholdMs: number;
  slowRedisLogEnabled: boolean;
  slowRedisThresholdMs: number;
  sqlMetricsEnabled: boolean;
  defaultPageSize: number;
  maxPageSize: number;
  businessTimezone: string;
  cachePrewarmEnabled: boolean;
  cachePrewarmIntervalMs: number;
  cachePrewarmInitialDelayMs: number;
  cachePrewarmBatchSize: number;
  cachePrewarmConcurrency: number;
  cachePrewarmLogEnabled: boolean;
  cachePrewarmLogSampleEvery: number;
  cachePrewarmSlowCycleThresholdMs: number;
  cacheRefreshConcurrency: number;
  spaceAutoCheckoutEnabled: boolean;
  spaceAutoCheckoutIntervalMs: number;
  spaceAutoCheckoutInitialDelayMs: number;
  businessEventLogEnabled: boolean;
  clientErrorLogEnabled: boolean;
  clientErrorStackMaxLength: number;
  clientErrorDetailsMaxLength: number;
  clientErrorAppHosts: string[];
  clientErrorSampleWindowSeconds: number;
  clientErrorSampleMaxPerWindow: number;
  throttleTtlSeconds: number;
  throttleLimit: number;
  sqlMetricsSampleRate: number;
  archiveSaleOrderItemsEnabled: boolean;
  archiveSaleOrderItemsIntervalMs: number;
  archiveSaleOrderItemsRetentionDays: number;
  archiveSaleOrderItemsBatchSize: number;
  platformPaymentReconcileEnabled: boolean;
  platformPaymentReconcileIntervalMs: number;
  platformPaymentReconcileBatchSize: number;
  platformPaymentReconcileMinPendingMinutes: number;
}

/**
 * 解析 `app` 配置块。
 *
 * 开关类配置统一按「字符串等于 'true'」判定；调试能力（Swagger / 日志 /
 * 端口漂移）的缺省值按环境推导：生产默认关闭，其余环境默认开启。
 */
export function resolveAppConfig(): AppConfig {
  return {
    corsOrigin: process.env.APP_CORS_ORIGIN ?? '*',
    swaggerEnabled:
      (process.env.APP_SWAGGER_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    logEnabled:
      (process.env.APP_LOG_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    httpKeepAliveTimeoutMs: parseIntValue(
      process.env.APP_HTTP_KEEP_ALIVE_TIMEOUT_MS,
      65000,
    ),
    httpRequestTimeoutMs: parseIntValue(
      process.env.APP_HTTP_REQUEST_TIMEOUT_MS,
      15000,
    ),
    httpBodyLimitBytes: parseIntValue(
      process.env.APP_HTTP_BODY_LIMIT_BYTES,
      5242880,
    ),
    portAutoTerminateEnabled:
      (process.env.APP_PORT_AUTO_TERMINATE_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    portAutoShiftEnabled:
      (process.env.APP_PORT_AUTO_SHIFT_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    portAutoShiftMaxOffset: parseIntValue(
      process.env.APP_PORT_AUTO_SHIFT_MAX_OFFSET,
      20,
    ),
    slowRequestLogEnabled:
      (process.env.APP_SLOW_REQUEST_LOG_ENABLED ?? 'true') === 'true',
    slowRequestThresholdMs: parseIntValue(
      process.env.APP_SLOW_REQUEST_THRESHOLD_MS,
      800,
    ),
    slowQueryLogEnabled:
      (process.env.APP_SLOW_QUERY_LOG_ENABLED ?? 'true') === 'true',
    slowQueryThresholdMs: parseIntValue(
      process.env.APP_SLOW_QUERY_THRESHOLD_MS,
      80,
    ),
    slowRedisLogEnabled:
      (process.env.APP_SLOW_REDIS_LOG_ENABLED ?? 'true') === 'true',
    slowRedisThresholdMs: parseIntValue(
      process.env.APP_SLOW_REDIS_THRESHOLD_MS,
      20,
    ),
    sqlMetricsEnabled:
      (process.env.APP_SQL_METRICS_ENABLED ?? 'false') === 'true',
    defaultPageSize: parseIntValue(process.env.APP_DEFAULT_PAGE_SIZE, 20),
    maxPageSize: parseIntValue(process.env.APP_MAX_PAGE_SIZE, 100),
    /** 业务时区，用于按日统计（如积分概览“今日变动数”）的跨日口径统一 */
    businessTimezone: process.env.APP_BUSINESS_TIMEZONE ?? 'Asia/Shanghai',
    cachePrewarmEnabled:
      (process.env.APP_CACHE_PREWARM_ENABLED ?? 'true') === 'true',
    cachePrewarmIntervalMs: parseIntValue(
      process.env.APP_CACHE_PREWARM_INTERVAL_MS,
      15000,
    ),
    cachePrewarmInitialDelayMs: parseIntValue(
      process.env.APP_CACHE_PREWARM_INITIAL_DELAY_MS,
      5000,
    ),
    cachePrewarmBatchSize: parseIntValue(
      process.env.APP_CACHE_PREWARM_BATCH_SIZE,
      30,
    ),
    cachePrewarmConcurrency: parseIntValue(
      process.env.APP_CACHE_PREWARM_CONCURRENCY,
      4,
    ),
    cachePrewarmLogEnabled:
      (process.env.APP_CACHE_PREWARM_LOG_ENABLED ?? 'true') === 'true',
    cachePrewarmLogSampleEvery: parseIntValue(
      process.env.APP_CACHE_PREWARM_LOG_SAMPLE_EVERY,
      20,
    ),
    cachePrewarmSlowCycleThresholdMs: parseIntValue(
      process.env.APP_CACHE_PREWARM_SLOW_CYCLE_THRESHOLD_MS,
      1500,
    ),
    cacheRefreshConcurrency: parseIntValue(
      process.env.APP_CACHE_REFRESH_CONCURRENCY,
      8,
    ),
    spaceAutoCheckoutEnabled:
      (process.env.APP_SPACE_AUTO_CHECKOUT_ENABLED ?? 'true') === 'true',
    spaceAutoCheckoutIntervalMs: parseIntValue(
      process.env.APP_SPACE_AUTO_CHECKOUT_INTERVAL_MS,
      60000,
    ),
    spaceAutoCheckoutInitialDelayMs: parseIntValue(
      process.env.APP_SPACE_AUTO_CHECKOUT_INITIAL_DELAY_MS,
      10000,
    ),
    businessEventLogEnabled:
      (process.env.APP_BUSINESS_EVENT_LOG_ENABLED ?? 'true') === 'true',
    clientErrorLogEnabled:
      (process.env.APP_CLIENT_ERROR_LOG_ENABLED ?? 'true') === 'true',
    clientErrorStackMaxLength: parseIntValue(
      process.env.APP_CLIENT_ERROR_STACK_MAX_LENGTH,
      2000,
    ),
    clientErrorDetailsMaxLength: parseIntValue(
      process.env.APP_CLIENT_ERROR_DETAILS_MAX_LENGTH,
      2000,
    ),
    /**
     * 前端 bundle 所在的可信域名（逗号分隔）。
     * 用于判定堆栈是否来自本站代码：bundle 部署在独立 CDN 域名时，
     * 仅靠 app.url 的 host 会误判成第三方脚本错误。
     * 对应环境变量：APP_CLIENT_ERROR_APP_HOSTS
     * 示例：profit.example.com,static.example.com
     */
    clientErrorAppHosts: parseStringList(
      process.env.APP_CLIENT_ERROR_APP_HOSTS,
    ),
    /**
     * 采样降噪窗口（秒）：同一 aggregateKey 在该窗口内最多记录
     * clientErrorSampleMaxPerWindow 条，超出部分只计数不落日志。
     * 对应环境变量：APP_CLIENT_ERROR_SAMPLE_WINDOW_SECONDS
     */
    clientErrorSampleWindowSeconds: parseIntValue(
      process.env.APP_CLIENT_ERROR_SAMPLE_WINDOW_SECONDS,
      60,
    ),
    /**
     * 采样降噪窗口内同一 aggregateKey 的最大落日志条数。
     * 0 表示不做降噪（每条都记）。
     * 对应环境变量：APP_CLIENT_ERROR_SAMPLE_MAX_PER_WINDOW
     */
    clientErrorSampleMaxPerWindow: parseIntValue(
      process.env.APP_CLIENT_ERROR_SAMPLE_MAX_PER_WINDOW,
      5,
    ),
    throttleTtlSeconds: parseIntValue(process.env.APP_THROTTLE_TTL_SECONDS, 60),
    throttleLimit: parseIntValue(process.env.APP_THROTTLE_LIMIT, 100),
    /** SQL metrics 采样率：1 = 全量记录，10 = 每 10 条采样 1 条 */
    sqlMetricsSampleRate: parseIntValue(
      process.env.APP_SQL_METRICS_SAMPLE_RATE,
      1,
    ),
    /**
     * sale_order_items 归档任务开关。
     * 启用后每 archiveSaleOrderItemsIntervalMs 毫秒执行一次，
     * 将超过保留窗口的冷数据迁移到 sale_order_items_archive 表。
     * 对应环境变量：APP_ARCHIVE_SALE_ORDER_ITEMS_ENABLED
     */
    archiveSaleOrderItemsEnabled:
      (process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_ENABLED ?? 'true') === 'true',
    /**
     * sale_order_items 归档任务执行间隔（毫秒），默认 24h。
     * 对应环境变量：APP_ARCHIVE_SALE_ORDER_ITEMS_INTERVAL_MS
     */
    archiveSaleOrderItemsIntervalMs: parseIntValue(
      process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_INTERVAL_MS,
      86400000,
    ),
    /**
     * sale_order_items 热表保留天数，默认 365 天（12 个月）。
     * 超过该天数的行将被迁移到归档表（归档表为长期存储，不做自动清理）。
     * 注意：保留窗口从 12 个月起，归档表增长会加快，需关注磁盘容量。
     * 对应环境变量：APP_ARCHIVE_SALE_ORDER_ITEMS_RETENTION_DAYS
     */
    archiveSaleOrderItemsRetentionDays: parseIntValue(
      process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_RETENTION_DAYS,
      365,
    ),
    /**
     * sale_order_items 归档任务每批迁移行数，默认 5000。
     * 每批一个事务，批间 sleep 100ms。
     * 对应环境变量：APP_ARCHIVE_SALE_ORDER_ITEMS_BATCH_SIZE
     */
    archiveSaleOrderItemsBatchSize: parseIntValue(
      process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_BATCH_SIZE,
      5000,
    ),

    /**
     * 平台收款对账开关（主动查单补入账，兜住丢失的支付回调）。
     * 对应环境变量：PROFIT_PAYMENT_RECONCILE_ENABLED
     */
    platformPaymentReconcileEnabled:
      (process.env.PROFIT_PAYMENT_RECONCILE_ENABLED ?? 'true') === 'true',
    /**
     * 平台收款对账执行间隔（毫秒），默认 30 分钟。
     * 对应环境变量：PROFIT_PAYMENT_RECONCILE_INTERVAL_MS
     */
    platformPaymentReconcileIntervalMs: parsePositiveInt(
      process.env.PROFIT_PAYMENT_RECONCILE_INTERVAL_MS,
      1_800_000,
    ),
    /**
     * 平台收款对账单轮最多核对的订单数，默认 200。
     * 对应环境变量：PROFIT_PAYMENT_RECONCILE_BATCH_SIZE
     */
    platformPaymentReconcileBatchSize: parsePositiveInt(
      process.env.PROFIT_PAYMENT_RECONCILE_BATCH_SIZE,
      200,
    ),
    /**
     * 挂起多少分钟后才纳入对账，默认 5 分钟。
     *
     * 太短会与正常支付窗口抢单：用户扫码付款到回调到达之间本来就有延迟，
     * 提前查单既没有收益又白耗商户接口额度。
     * 对应环境变量：PROFIT_PAYMENT_RECONCILE_MIN_PENDING_MINUTES
     */
    platformPaymentReconcileMinPendingMinutes: parsePositiveInt(
      process.env.PROFIT_PAYMENT_RECONCILE_MIN_PENDING_MINUTES,
      5,
    ),
  };
}
