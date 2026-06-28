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
    portAutoTerminateEnabled:
      (process.env.APP_PORT_AUTO_TERMINATE_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
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
    throttleTtlSeconds: parseInt(
      process.env.APP_THROTTLE_TTL_SECONDS ?? '60',
      10,
    ),
    throttleLimit: parseInt(process.env.APP_THROTTLE_LIMIT ?? '100', 10),
  },

  database: {
    url: process.env.DATABASE_URL,
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
    poolMin: parseInt(process.env.DATABASE_POOL_MIN ?? '5', 10),
    poolIdleTimeoutMs: parseInt(
      process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? '30000',
      10,
    ),
    poolConnectionTimeoutMs: parseInt(
      process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? '5000',
      10,
    ),
    /** 单条 SQL 语句超时（毫秒），防止单条慢查询无限占用连接池连接 */
    statementTimeoutMs: parseInt(
      process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? '10000',
      10,
    ),
    /**
     * PostgreSQL 侧 max_connections 配置值。
     * 集群模式下 PrismaService 会据此自动调整每 worker 的 poolMax，
     * 确保 workers × poolMax 不超过此值。
     * 未配置时默认 100（即 PostgreSQL 默认值）。
     */
    pgMaxConnections: parseInt(
      process.env.DATABASE_PG_MAX_CONNECTIONS ?? '100',
      10,
    ),
  },

  cluster: {
    /**
     * 集群 worker 进程数。未配置时默认跟随 CPU 核数。
     * 生产环境建议显式配置（如 4），避免自动跟随核数导致连接池总量超出 PG 限制。
     */
    workers: parseInt(process.env.CLUSTER_WORKERS ?? '0', 10) || undefined,
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
    smsSendCooldownSeconds: parseInt(
      process.env.AUTH_SMS_SEND_COOLDOWN_SECONDS ?? '60',
      10,
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

  wechat: {
    /**
     * 微信小程序 AppID（purely-club 对应的小程序 appid）
     * 对应环境变量：WECHAT_APP_ID
     */
    appId: process.env.WECHAT_APP_ID ?? '',

    /**
     * 微信小程序 AppSecret（code2session 接口鉴权，严禁泄露/明文落库）
     * 对应环境变量：WECHAT_APP_SECRET
     */
    appSecret: process.env.WECHAT_APP_SECRET ?? '',

    /**
     * 微信支付回调通知地址（商家服务器公网可达地址）
     * 对应环境变量：WECHAT_PAY_NOTIFY_URL
     * 示例：https://api.yourdomain.com/club/payments/wechat/callback
     */
    payNotifyUrl: process.env.WECHAT_PAY_NOTIFY_URL ?? '',

    /**
     * 微信支付商户 API RSA 私钥文件路径（PEM 格式），优先使用文件路径。
     * 对应环境变量：WECHAT_PRIVATE_KEY_PATH
     * 示例：/etc/secrets/wechat_apiclient_key.pem
     */
    privateKeyPath: process.env.WECHAT_PRIVATE_KEY_PATH ?? '',

    /**
     * 微信支付商户 API RSA 私钥内容（PEM 格式，直接内联），次优先级。
     * 适合 Docker 环境注入 secret 内容而不挂载文件。
     * 对应环境变量：WECHAT_PRIVATE_KEY_CONTENT
     */
    privateKeyContent: process.env.WECHAT_PRIVATE_KEY_CONTENT ?? '',

    /**
     * 商户 API 证书序列号（serial_no），在微信商户平台「账户中心 → API 安全」可查。
     * 用于 WECHATPAY2-SHA256-RSA2048 Authorization 头中的 serial_no 字段。
     * 对应环境变量：WECHAT_MCH_SERIAL_NO
     */
    mchSerialNo: process.env.WECHAT_MCH_SERIAL_NO ?? '',

    /**
     * 微信支付平台公钥（PEM 格式，内联内容），用于验证回调签名（Wechatpay-Signature）。
     * 平台证书可通过 GET /v3/certificates 接口下载，建议定期轮换。
     * 未配置时跳过 RSA 验签，仅靠时间戳防重放（首次上线阶段可接受）。
     * 对应环境变量：WECHAT_PLATFORM_PUBLIC_KEY_CONTENT
     */
    platformPublicKeyContent:
      process.env.WECHAT_PLATFORM_PUBLIC_KEY_CONTENT ?? '',
  },
});
