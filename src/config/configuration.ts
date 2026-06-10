function parseStringList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  app: {
    corsOrigin: process.env.APP_CORS_ORIGIN ?? '*',
    swaggerEnabled:
      (process.env.APP_SWAGGER_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    logEnabled:
      (process.env.APP_LOG_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    httpKeepAliveTimeoutMs: parseInt(
      process.env.APP_HTTP_KEEP_ALIVE_TIMEOUT_MS ?? '65000',
      10,
    ),
    httpRequestTimeoutMs: parseInt(
      process.env.APP_HTTP_REQUEST_TIMEOUT_MS ?? '15000',
      10,
    ),
    httpBodyLimitBytes: parseInt(
      process.env.APP_HTTP_BODY_LIMIT_BYTES ?? '5242880',
      10,
    ),
    portAutoShiftEnabled:
      (process.env.APP_PORT_AUTO_SHIFT_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    portAutoShiftMaxOffset: parseInt(
      process.env.APP_PORT_AUTO_SHIFT_MAX_OFFSET ?? '20',
      10,
    ),
    slowRequestLogEnabled:
      (process.env.APP_SLOW_REQUEST_LOG_ENABLED ?? 'true') === 'true',
    slowRequestThresholdMs: parseInt(
      process.env.APP_SLOW_REQUEST_THRESHOLD_MS ?? '800',
      10,
    ),
    slowQueryLogEnabled:
      (process.env.APP_SLOW_QUERY_LOG_ENABLED ?? 'true') === 'true',
    slowQueryThresholdMs: parseInt(
      process.env.APP_SLOW_QUERY_THRESHOLD_MS ?? '80',
      10,
    ),
    slowRedisLogEnabled:
      (process.env.APP_SLOW_REDIS_LOG_ENABLED ?? 'true') === 'true',
    slowRedisThresholdMs: parseInt(
      process.env.APP_SLOW_REDIS_THRESHOLD_MS ?? '20',
      10,
    ),
    sqlMetricsEnabled:
      (process.env.APP_SQL_METRICS_ENABLED ?? 'true') === 'true',
    defaultPageSize: parseInt(process.env.APP_DEFAULT_PAGE_SIZE ?? '20', 10),
    maxPageSize: parseInt(process.env.APP_MAX_PAGE_SIZE ?? '100', 10),
    cachePrewarmEnabled:
      (process.env.APP_CACHE_PREWARM_ENABLED ?? 'true') === 'true',
    cachePrewarmIntervalMs: parseInt(
      process.env.APP_CACHE_PREWARM_INTERVAL_MS ?? '15000',
      10,
    ),
    cachePrewarmInitialDelayMs: parseInt(
      process.env.APP_CACHE_PREWARM_INITIAL_DELAY_MS ?? '5000',
      10,
    ),
    cachePrewarmBatchSize: parseInt(
      process.env.APP_CACHE_PREWARM_BATCH_SIZE ?? '30',
      10,
    ),
    cachePrewarmConcurrency: parseInt(
      process.env.APP_CACHE_PREWARM_CONCURRENCY ?? '4',
      10,
    ),
    cachePrewarmLogEnabled:
      (process.env.APP_CACHE_PREWARM_LOG_ENABLED ?? 'true') === 'true',
    cachePrewarmLogSampleEvery: parseInt(
      process.env.APP_CACHE_PREWARM_LOG_SAMPLE_EVERY ?? '20',
      10,
    ),
    cachePrewarmSlowCycleThresholdMs: parseInt(
      process.env.APP_CACHE_PREWARM_SLOW_CYCLE_THRESHOLD_MS ?? '1500',
      10,
    ),
    cacheRefreshConcurrency: parseInt(
      process.env.APP_CACHE_REFRESH_CONCURRENCY ?? '8',
      10,
    ),
    spaceAutoCheckoutEnabled:
      (process.env.APP_SPACE_AUTO_CHECKOUT_ENABLED ?? 'true') === 'true',
    spaceAutoCheckoutIntervalMs: parseInt(
      process.env.APP_SPACE_AUTO_CHECKOUT_INTERVAL_MS ?? '60000',
      10,
    ),
    spaceAutoCheckoutInitialDelayMs: parseInt(
      process.env.APP_SPACE_AUTO_CHECKOUT_INITIAL_DELAY_MS ?? '10000',
      10,
    ),
    clientErrorLogEnabled:
      (process.env.APP_CLIENT_ERROR_LOG_ENABLED ?? 'true') === 'true',
    clientErrorStackMaxLength: parseInt(
      process.env.APP_CLIENT_ERROR_STACK_MAX_LENGTH ?? '2000',
      10,
    ),
    clientErrorDetailsMaxLength: parseInt(
      process.env.APP_CLIENT_ERROR_DETAILS_MAX_LENGTH ?? '2000',
      10,
    ),
  },

  database: {
    url: process.env.DATABASE_URL,
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
    poolIdleTimeoutMs: parseInt(
      process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? '30000',
      10,
    ),
    poolConnectionTimeoutMs: parseInt(
      process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? '5000',
      10,
    ),
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    connectTimeoutMs: parseInt(
      process.env.REDIS_CONNECT_TIMEOUT_MS ?? '5000',
      10,
    ),
    commandTimeoutMs: parseInt(
      process.env.REDIS_COMMAND_TIMEOUT_MS ?? '3000',
      10,
    ),
    maxRetriesPerRequest: parseInt(
      process.env.REDIS_MAX_RETRIES_PER_REQUEST ?? '3',
      10,
    ),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  auth: {
    passwordResetCodeTtlSeconds: parseInt(
      process.env.AUTH_PASSWORD_RESET_CODE_TTL_SECONDS ?? '600',
      10,
    ),
    registerCodeTtlSeconds: parseInt(
      process.env.AUTH_REGISTER_CODE_TTL_SECONDS ?? '600',
      10,
    ),
  },

  pulse: {
    devAccountEmails: parseStringList(process.env.PULSE_DEV_ACCOUNT_EMAILS),
  },

  club: {
    wechatCallbackSecret:
      process.env.CLUB_WECHAT_CALLBACK_SECRET ?? 'club_wechat_callback_secret',
    wechatCallbackMaxAgeSeconds: parseInt(
      process.env.CLUB_WECHAT_CALLBACK_MAX_AGE_SECONDS ?? '300',
      10,
    ),
    manualConfirmPaidEnabled:
      (process.env.CLUB_MANUAL_CONFIRM_PAID_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  },
});
