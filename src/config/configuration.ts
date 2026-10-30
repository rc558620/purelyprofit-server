function parseStringList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 解析正整数配置，失败时用兜底值。
 *
 * 定时任务 / 兜底扫描类配置写错不应该让进程起不来或任务崩掉：
 * 缺失、空白、负数、0、非数字一律回落到安全默认值。
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
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
function normalizeNodeEnv(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase() || 'development';
}

/**
 * 默认允许「跳过真实扣款」的环境白名单：只认本地开发与自动化测试。
 *
 * staging / pre / 预发 / 任何未列入白名单的环境一律按真实模式处理（fail-closed），
 * 禁止把「非 production」当成「可以免费下单」的通行证。
 */
const TEST_MODE_DEFAULT_ENV_WHITELIST = ['development', 'test'];

function isTestModeDefaultEnvironment(): boolean {
  return TEST_MODE_DEFAULT_ENV_WHITELIST.includes(
    normalizeNodeEnv(process.env.NODE_ENV),
  );
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: normalizeNodeEnv(process.env.NODE_ENV),

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
      (process.env.APP_SQL_METRICS_ENABLED ?? 'false') === 'true',
    defaultPageSize: parseInt(process.env.APP_DEFAULT_PAGE_SIZE ?? '20', 10),
    maxPageSize: parseInt(process.env.APP_MAX_PAGE_SIZE ?? '100', 10),
    /** 业务时区，用于按日统计（如积分概览“今日变动数”）的跨日口径统一 */
    businessTimezone: process.env.APP_BUSINESS_TIMEZONE ?? 'Asia/Shanghai',
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
    businessEventLogEnabled:
      (process.env.APP_BUSINESS_EVENT_LOG_ENABLED ?? 'true') === 'true',
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
    clientErrorSampleWindowSeconds: parseInt(
      process.env.APP_CLIENT_ERROR_SAMPLE_WINDOW_SECONDS ?? '60',
      10,
    ),
    /**
     * 采样降噪窗口内同一 aggregateKey 的最大落日志条数。
     * 0 表示不做降噪（每条都记）。
     * 对应环境变量：APP_CLIENT_ERROR_SAMPLE_MAX_PER_WINDOW
     */
    clientErrorSampleMaxPerWindow: parseInt(
      process.env.APP_CLIENT_ERROR_SAMPLE_MAX_PER_WINDOW ?? '5',
      10,
    ),
    throttleTtlSeconds: parseInt(
      process.env.APP_THROTTLE_TTL_SECONDS ?? '60',
      10,
    ),
    throttleLimit: parseInt(process.env.APP_THROTTLE_LIMIT ?? '100', 10),
    /** SQL metrics 采样率：1 = 全量记录，10 = 每 10 条采样 1 条 */
    sqlMetricsSampleRate: parseInt(
      process.env.APP_SQL_METRICS_SAMPLE_RATE ?? '1',
      10,
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
    archiveSaleOrderItemsIntervalMs: parseInt(
      process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_INTERVAL_MS ?? '86400000',
      10,
    ),
    /**
     * sale_order_items 热表保留天数，默认 365 天（12 个月）。
     * 超过该天数的行将被迁移到归档表（归档表为长期存储，不做自动清理）。
     * 注意：保留窗口从 12 个月起，归档表增长会加快，需关注磁盘容量。
     * 对应环境变量：APP_ARCHIVE_SALE_ORDER_ITEMS_RETENTION_DAYS
     */
    archiveSaleOrderItemsRetentionDays: parseInt(
      process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_RETENTION_DAYS ?? '365',
      10,
    ),
    /**
     * sale_order_items 归档任务每批迁移行数，默认 5000。
     * 每批一个事务，批间 sleep 100ms。
     * 对应环境变量：APP_ARCHIVE_SALE_ORDER_ITEMS_BATCH_SIZE
     */
    archiveSaleOrderItemsBatchSize: parseInt(
      process.env.APP_ARCHIVE_SALE_ORDER_ITEMS_BATCH_SIZE ?? '5000',
      10,
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
    /**
     * 启用 Redis TLS 加密连接。
     * 生产环境建议启用，尤其是 Redis 与服务器不在同一 VPC 时。
     * 对应环境变量：REDIS_TLS_ENABLED
     */
    tlsEnabled: (process.env.REDIS_TLS_ENABLED ?? 'false') === 'true',
    /**
     * Redis TLS CA 证书路径（PEM 格式）。
     * 未配置时使用系统默认 CA 证书库。
     * 对应环境变量：REDIS_TLS_CA_CERT_PATH
     */
    tlsCaCertPath: process.env.REDIS_TLS_CA_CERT_PATH ?? '',
    /**
     * 跳过 Redis TLS 服务器证书验证（仅开发/测试环境使用）。
     * 生产环境必须为 false。
     * 对应环境变量：REDIS_TLS_REJECT_UNAUTHORIZED
     */
    tlsRejectUnauthorized:
      (process.env.REDIS_TLS_REJECT_UNAUTHORIZED ?? 'true') === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  scanOrdering: {
    qrTokenEncryptionKey:
      process.env.SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY ?? '',
    /**
     * 上一代桌码加密密钥（可选）。
     * 用于密钥轮换 / JWT_SECRET 轮换后仍能解密历史桌码的 tokenCiphertext，
     * 否则商家端「重新下载桌码 / 批量导出」会对全部历史桌码抛 500。
     */
    qrTokenEncryptionKeyPrevious:
      process.env.SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '',
    /** 待接单超时阈值（毫秒）：支付后超过该时长未接单，系统自动退款 */
    acceptanceTimeoutMs: parseInt(
      process.env.SCAN_ORDERING_ACCEPTANCE_TIMEOUT_MS ?? '1800000',
      10,
    ),
    /** 制作中超时阈值（毫秒）：接单后超过该时长未出餐，系统自动退款 */
    preparingTimeoutMs: parseInt(
      process.env.SCAN_ORDERING_PREPARING_TIMEOUT_MS ?? '7200000',
      10,
    ),
    /** 超时自动退款扫描间隔（毫秒） */
    acceptanceExpirationIntervalMs: parseInt(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_INTERVAL_MS ?? '60000',
      10,
    ),
    /** 单次超时退款扫描的最大并发数 */
    acceptanceExpirationConcurrency: parseInt(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_CONCURRENCY ?? '8',
      10,
    ),
    /** 退款中订单的自动重试间隔（毫秒） */
    acceptanceExpirationRetryDelayMs: parseInt(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_RETRY_DELAY_MS ??
        '300000',
      10,
    ),
    /** 单笔微信退款的最大自动重试次数 */
    acceptanceExpirationMaxRetries: parseInt(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_MAX_RETRIES ?? '3',
      10,
    ),
    /**
     * 自动清桌阈值（毫秒，日间）：最后一笔订单履约（或会话最后活跃）落在日间时段时，
     * 超过该时长即归档会话并把桌台置为空桌。
     * 只看最后活动、不等会话 TTL 过期 —— 否则 4 小时 TTL 会成为下限，
     * 午市 12 点的单要拖到 18 点才释放，翻台与统计口径都被拖慢。
     * 默认 2 小时；联调时可临时设 SCAN_ORDERING_SESSION_ARCHIVE_IDLE_MS=180000（3 分钟）加速验证。
     */
    sessionArchiveIdleMs: parseInt(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_IDLE_MS ?? '7200000',
      10,
    ),
    /**
     * 自动清桌阈值（毫秒，夜间）：最后活动落在夜间窗口时改用该阈值，
     * 并且额外要求会话 expiresAt 已过期，避免把还在座的夜宵 / 火锅客人清掉。
     */
    sessionArchiveNightIdleMs: parseInt(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_NIGHT_IDLE_MS ?? '7200000',
      10,
    ),
    /** 夜间窗口起始小时（上海时区，含）：最后活动小时 >= 该值按夜间口径处理。 */
    sessionArchiveNightStartHour: parseInt(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_NIGHT_START_HOUR ?? '22',
      10,
    ),
    /** 夜间窗口结束小时（上海时区，不含）：最后活动小时 < 该值按夜间口径处理。 */
    sessionArchiveNightEndHour: parseInt(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_NIGHT_END_HOUR ?? '6',
      10,
    ),
    /**
     * 扫码点餐桌台会话有效期（毫秒）：决定会话 expiresAt 与 diningRound 复用窗口。
     * 默认 4 小时（与改造前硬编码一致）；仅联调期临时调小以压缩自动清桌观察周期，生产不要改。
     * 归档时刻 ≈ 会话创建 + 本值 + sessionArchiveIdleMs。
     */
    sessionTtlMs: parseInt(
      process.env.SCAN_ORDERING_SESSION_TTL_MS ?? '14400000',
      10,
    ),
  },

  /**
   * 空间码（呼叫服务 / 自助下单）二维码 token 加密密钥。
   *
   * 空间码改为「哈希查表」后，商家端「预览 / 下载」要用原始 token 重建二维码内容，
   * 因此明文以密文形式留存（`space_qr_codes.token_ciphertext`），本密钥即用于该密文。
   * 解析查表走 sha256 摘要，不需要本密钥 —— 未配置只影响重新出图，不影响扫码。
   */
  space: {
    qrTokenEncryptionKey: process.env.SPACE_QR_TOKEN_ENCRYPTION_KEY ?? '',
    /**
     * 上一代空间码加密密钥（可选）。
     * 用于密钥轮换 / JWT_SECRET 轮换后仍能解密历史空间码的密文，
     * 否则商家端「预览 / 下载」会对全部历史空间码抛错。
     */
    qrTokenEncryptionKeyPrevious:
      process.env.SPACE_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '',
  },

  /**
   * 扫码点餐打印代理发布配置。
   * 发版时同步更新 latestVersion（与 print-agent 源码 Version 常量一致），
   * 商家端设置页据此提示客户下载新版代理。
   */
  printAgent: {
    /** 最新可下载的代理版本号（与 Go 代理 Version 常量保持一致） */
    latestVersion: process.env.PRINT_AGENT_LATEST_VERSION ?? '0.1.0',
  },

  /**
   * 飞鹅云打印配置（商家扫码点餐云打印通道）。
   * 未配置时云打印接口降级为不可用，不影响浏览器打印通道。
   */
  feiePrint: {
    /** 飞鹅云后台注册的开发者账号名 */
    user: process.env.FEIE_PRINT_USER ?? '',
    /** 飞鹅云后台注册后生成的 UKEY（签名用，严禁泄露） */
    ukey: process.env.FEIE_PRINT_UKEY ?? '',
    /** 飞鹅开放接口地址（中国站正式地址；2026-01 起官方按接口路径分流，此处为 base，业务按接口名拼接路径） */
    apiUrl:
      process.env.FEIE_PRINT_API_URL ?? 'https://api.feieyun.cn/Api/Open/',
    /** 单次飞鹅接口请求超时（毫秒）：云端挂起时快速失败，避免拖到全局 HTTP 超时 */
    timeoutMs: parseInt(process.env.FEIE_PRINT_TIMEOUT_MS ?? '10000', 10),
  },

  /**
   * USB 小票打印机配置（扫码点餐 usb 打印通道）。
   * 打印机需连接在服务器本机；Linux 走 /dev/usb/lp* 设备文件，macOS/Linux 走 CUPS（lp -o raw）。
   */
  usbPrint: {
    /** 默认打印机标识：Linux 设备路径（如 /dev/usb/lp0）或 CUPS 打印机名；门店未配置时使用，留空自动探测 */
    device: process.env.USB_PRINT_DEVICE ?? '',
    /** 小票文本编码：gbk（默认，兼容国产热敏机）/ utf8 */
    encoding: process.env.USB_PRINT_ENCODING ?? 'gbk',
    /** 调用系统打印命令超时（毫秒） */
    timeoutMs: parseInt(process.env.USB_PRINT_TIMEOUT_MS ?? '10000', 10),
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
     * Refresh token 有效期（秒），默认 30 天。
     * 对应环境变量：AUTH_REFRESH_TOKEN_TTL_SECONDS
     */
    refreshTokenTtlSeconds: parseInt(
      process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS ?? '2592000',
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
  },

  pulse: {
    devAccountEmails: parseStringList(process.env.PULSE_DEV_ACCOUNT_EMAILS),
  },

  profit: {
    /**
     * 商家端（purelyProfit）是否默认允许「跳过真实扣款、订单直接生效」。
     *
     * 这是配套的技术方案开关，不是业务开关：历史上有几条链路（平台会员开通/续费、
     * 新客额度充值）没有接入真实支付，服务端直接把订单置为已生效。
     * 接入真实支付后，这个值应该在各环境都设为 false（= 真实模式）。
     *
     * 默认值策略与 club 侧保持一致（fail-closed）：仅 `development` / `test`
     * 两个环境默认 true；staging / pre / 预发等未列入白名单的环境默认 false，
     * 避免「NODE_ENV 不叫 production」就自动放开免费开通会员 / 免费充值额度。
     * 生产环境无论环境变量如何配置都会被启动校验强制拦下。
     * 对应环境变量：PROFIT_MANUAL_PAID_ENABLED
     */
    manualPaidEnabled:
      (process.env.PROFIT_MANUAL_PAID_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * 是否允许通过 dev-only 接口在运行期切换支付模式（test / live）。
     * 默认值策略与上一项一致（仅 development / test 默认开启）。
     * 生产环境无论环境变量如何配置都强制禁用。
     * 对应环境变量：PROFIT_PAYMENT_MODE_SWITCH_ENABLED
     */
    paymentModeSwitchEnabled:
      (process.env.PROFIT_PAYMENT_MODE_SWITCH_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * dev-only 支付模式开关接口的访问令牌。
     * 未配置时切换请求一律拒绝，防止测试环境公网可达时被任意切到真实扣款。
     * 对应环境变量：PROFIT_PAYMENT_MODE_DEV_TOKEN
     */
    paymentModeDevToken: process.env.PROFIT_PAYMENT_MODE_DEV_TOKEN ?? '',

    /**
     * 平台收款的**统一**回调地址（`POST /profit/payments/wechat/callback`）。
     *
     * 会员开通 / 新客额度充值两条链路共用这个入口：回调里按支付单号反查
     * `platform_payment_orders.bizType` 再分发，省掉一份重复的验签解密实现。
     *
     * ⚠️ 短信钱包充值**不在其中**：它的订单落在 `sms_recharge_orders`（SM 前缀），
     * 统一回调按 platform_payment_orders 反查会查不到。短信链路必须配
     * `SMS_WECHAT_PAY_NOTIFY_URL`（/api/marketing/sms/wechat/callback），两者不可混用。
     *
     * 必须是公网可达 HTTPS。
     * 对应环境变量：PROFIT_WECHAT_PAY_NOTIFY_URL
     * 示例：https://api.yourdomain.com/api/profit/payments/wechat/callback
     */
    wechatPayNotifyUrl: process.env.PROFIT_WECHAT_PAY_NOTIFY_URL ?? '',
  },

  club: {
    wechatCallbackSecret:
      process.env.CLUB_WECHAT_CALLBACK_SECRET ?? 'club_wechat_callback_secret',
    wechatCallbackMaxAgeSeconds: parseInt(
      process.env.CLUB_WECHAT_CALLBACK_MAX_AGE_SECONDS ?? '300',
      10,
    ),
    /**
     * 开发态兜底开关：为 true 表示默认处于**测试支付模式**（允许跳过微信扣款、
     * 由 confirm-paid 直接把订单置为已支付）。
     *
     * 默认值只在 `development` / `test` 两个环境为 true；
     * staging / pre / 预发等非白名单环境默认 false（fail-closed），
     * 避免「NODE_ENV 不叫 production」就自动放开免费下单。
     * 生产环境无论环境变量如何配置都会被启动校验强制拦下
     * （`bootstrap/production-config.utils.ts`）。
     * 对应环境变量：CLUB_MANUAL_CONFIRM_PAID_ENABLED
     */
    manualConfirmPaidEnabled:
      (process.env.CLUB_MANUAL_CONFIRM_PAID_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * 是否允许通过 dev-only 开关接口在运行期切换支付模式（test / live）。
     * 默认值策略与 manualConfirmPaidEnabled 一致：仅 development / test 默认开启。
     * 生产环境无论环境变量如何配置都强制禁用。
     * 对应环境变量：CLUB_PAYMENT_MODE_SWITCH_ENABLED
     */
    paymentModeSwitchEnabled:
      (process.env.CLUB_PAYMENT_MODE_SWITCH_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * dev-only 支付模式开关接口的访问令牌。
     * 未配置时切换请求一律拒绝，避免测试环境公网可达时被任意切到真实扣款。
     * 前端需通过构建期注入的同值令牌携带 `x-payment-dev-token` 请求头。
     * 对应环境变量：CLUB_PAYMENT_MODE_DEV_TOKEN
     */
    paymentModeDevToken: process.env.CLUB_PAYMENT_MODE_DEV_TOKEN ?? '',
    /**
     * 邀请二维码使用的俱乐部公共域名（长期稳定、公网可达、不随环境/部署变动）。
     * 未配置时二维码回退为裸邀请码（legacy）格式，避免把 localhost / 内网地址写入二维码。
     * 对应环境变量：CLUB_PUBLIC_BASE_URL
     * 示例：https://club.purelyprofit.com
     *
     * ⚠️ 上线提醒：生产部署前必须将该值替换为真实公网域名。
     * 本机联调允许填写 http://localhost:3000（生成形如 http://localhost:3000/i/v1/{code}
     * 的二维码），但生产环境（NODE_ENV=production）下：
     * - localhost / 内网 IP / 私有网段会被 sanitize 拒绝，二维码自动回退 legacy 裸码格式；
     * - 渠道二维码创建接口（POST /marketing/invite-code/issues）会直接报错拒绝创建；
     * - 严禁将 localhost、内网地址、临时 preview URL 写进已发行二维码（会导致已印刷物料失效）。
     *
     * ⚠️ 该域名一经印刷即视为永久资产（只增不换）：换域名、备案注销、微信规则被删
     * 都会让全部已印进店码同时失效，且服务端无法补救。启动期由
     * `reportStoreInviteQrBaseUrlStatus` 播报状态（未配置 warn、被 sanitize 拒绝 error）。
     */
    publicBaseUrl: process.env.CLUB_PUBLIC_BASE_URL ?? '',
    /**
     * 邀请二维码稳定入口路径前缀，默认 /i，最终二维码形如
     * {publicBaseUrl}/i/v1/{inviteCode}。
     * 对应环境变量：CLUB_STORE_INVITE_QR_ENTRY_PATH
     *
     * ⚠️ 与 publicBaseUrl 一样是**永久资产**：入口段被烧进每一张已印刷的进店码，
     * 改动后旧物料指向的路径不再被生成侧 / 解析侧任何一方承认（服务端
     * `V1_PATH_PATTERN` 与前端 `SCAN_PATH_KINDS.storeInvite` 都只认 `i` / `invite`），
     * 且**不会报错**——只能等顾客扫不出来才发现。
     *
     * 因此只接受 `STORE_INVITE_QR_ENTRY_SEGMENTS`（`i` / `invite`）白名单内的取值，
     * 其它取值会被拒绝并回退 `i`、同时记 error；新增入口段必须前后端与微信
     * 公众平台规则一起改，并由 `npm run scan:qr:contract:check` 对齐两侧常量。
     */
    storeInviteQrEntryPath: process.env.CLUB_STORE_INVITE_QR_ENTRY_PATH ?? '/i',
    /**
     * 扫码点餐桌码 / 空间码使用的公共域名。
     * 对应环境变量：SCAN_QR_BASE_URL
     * 示例：https://scan.purelyprofit.com
     *
     * 二维码形如 {scanQrBaseUrl}/t/{qrToken}（桌码）、{scanQrBaseUrl}/p/{spaceToken}（空间码）。
     *
     * ⚠️ 刻意与邀请二维码的 CLUB_PUBLIC_BASE_URL 分开配置：
     * 「扫普通链接二维码打开小程序」按「域名 + 路径前缀」下发规则，共用域名时
     * 规则很容易把 {base}/i/... 一并唤起小程序，导致邀请二维码无法再落地到 H5。
     *
     * ⚠️ 未配置时二维码回退历史格式（桌码裸 token、空间码 purelyclub:// 自定义协议），
     * 即本项配置缺失不会改变现有行为，也不会让已印刷物料失效。
     *
     * 生产环境（NODE_ENV=production）下 localhost / 内网 IP / 私有网段会被 sanitize
     * 拒绝并自动回退，避免把不可达地址写进物料。
     *
     * ⚠️ 该域名一经印刷即视为永久资产（只增不换）：换域名、备案注销、微信规则被删
     * 都会让全部已印物料同时失效，且服务端无法补救（微信按 URL 文本前缀匹配规则，
     * 不会 fetch 旧域名做跳转）。换域名时必须保留旧域名解析与旧规则。
     */
    scanQrBaseUrl: process.env.SCAN_QR_BASE_URL ?? '',
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

    /**
     * 是否允许在**未配置平台公钥**的情况下跳过 RSA 验签处理支付回调。
     *
     * fail-closed：默认仅 `development` / `test` 打开，staging / 预发等环境默认关闭。
     * 关闭时若公钥缺失，回调一律拒绝 —— 只靠时间戳 + 必填头是可伪造的，
     * 任何公网可达的非生产环境都不该接受这种报文。
     * 生产环境强制为 false（启动校验会拦下显式开启）。
     * 对应环境变量：WECHAT_ALLOW_INSECURE_CALLBACK
     */
    allowInsecureCallback:
      (process.env.WECHAT_ALLOW_INSECURE_CALLBACK ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',

    /**
     * **平台收款商户号**（商家向平台付费的场景：短信钱包充值等）。
     *
     * ⚠️ 与门店微信收款（stores_wechat_pay，C 端顾客付钱给商家）是两条
     * 完全独立的资金流，严禁混用：短信充值下单用这里的商户号，
     * 回调也用这里的 APIv3Key 解密。
     * 对应环境变量：WECHAT_PAY_MCH_ID
     */
    payMchId: process.env.WECHAT_PAY_MCH_ID ?? '',

    /**
     * 平台收款商户号的 APIv3 密钥（32 字节），用于解密短信充值回调报文。
     * 对应环境变量：WECHAT_PAY_API_V3_KEY
     */
    payApiV3Key: process.env.WECHAT_PAY_API_V3_KEY ?? '',

    /**
     * 【服务商模式 · 增量隔离】C 端门店微信收款（链路 a）专用配置组。
     *
     * ⚠️ 隔离铁律（红线 1）：本组内所有配置**新增不替换**。
     * 上面那套（appId / mchSerialNo / privateKey* / platformPublicKeyContent /
     * payMchId / payApiV3Key）继续服务短信钱包充值（链路 b）与平台会员/额度（链路 c），
     * 其取值与消费方一个都不能改。两套配置语义完全不同：
     *   - 上面那套 = 商家向平台付费，资金进平台商户号；
     *   - 下面这套 = C 端用户向商家付费，请求主体是服务商商户号，资金进子商户号。
     * 即便未来确认两套取值相同（同一商户号既做平台收款又做服务商），
     * 也必须保留两份独立配置项并在此注明复用理由，禁止合并。
     *
     * 灰度开关默认关闭：enabled=false 时链路 a 维持旧直连行为，保证可回滚。
     *
     * 【已确认事实 2026-10-29】`wechat.payMchId`（WECHAT_PAY_MCH_ID）本身就是
     * 平台的**微信支付服务商商户号**，链路 b/c 也在这同一个商户号下收款。
     * ⇒ `spMchId` 与 `payMchId` **取值相同是被允许的**，启动自检需通过
     *   `WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID=true` 显式豁免并填写原因。
     * ⇒ 同一个商户号意味着平台罗盘/证书也是同一份：`partner.serialNo`、
     *   `partner.privateKey*`、`partner.platformPublicKeyContent` 的**取值**
     *   与上方全局项相同，但**配置项必须保持独立**（资金语义不同、灰度互不牵连）。
     * ⚠️ 若未来平台新增「非服务商」的自收商户号，此处结论失效，必须重新评估平台证书维度。
     */
    partner: {
      /**
       * 服务商模式开关。true=链路 a 走服务商（Partner）接口；false=回落旧直连逻辑。
       * 对应环境变量：WECHAT_PARTNER_ENABLED
       */
      enabled: (process.env.WECHAT_PARTNER_ENABLED ?? 'false') === 'true',

      /**
       * 服务商商户号（sp_mchid），服务商模式下所有 APIv3 请求的**请求主体**。
       *
       * ⚠️ 资金归属红线：正常情况下禁止与 wechat.payMchId（平台自收商户号）混用。
       * 两者相等意味着「C 端付款落进平台账户」而非子商户，属资金归属事故，
       * 启动自检会拦截（除非显式豁免，见 allowSharedPlatformMchId）。
       *
       * 已确认：本平台的 payMchId 本身即服务商商户号，因此两者相等是**预期配置**，
       * 不是事故；但仍必须显式豁免，理由是「防止有人因为填错/抄错而静默同号」。
       * 真正的资金去向由子商户号 sub_mchid 决定，而不是这个字段。
       * 对应环境变量：WECHAT_PARTNER_SP_MCH_ID
       */
      spMchId: process.env.WECHAT_PARTNER_SP_MCH_ID ?? '',

      /**
       * 服务商 APIv3 密钥（32 字节）。
       *
       * 服务商模式下**回调报文解密的唯一密钥**：特约商户/二级商户在微信侧不存在
       * 自己的 APIv3 密钥也不会自行设置，回调统一由服务商密钥加密后发给服务商。
       * 因此这里**禁止**回落到任何门店维度的密钥。
       * 对应环境变量：WECHAT_PARTNER_API_V3_KEY
       */
      apiV3Key: process.env.WECHAT_PARTNER_API_V3_KEY ?? '',

      /**
       * 服务商 API 证书序列号（serial_no），用于 Authorization 头。
       *
       * 独立配置项而非复用 wechat.mchSerialNo：两者虽可能取同一份证书，
       * 但消费方（签名链路）不同，独立命名才能做到「改一份不影响另一条链路」。
       * 对应环境变量：WECHAT_PARTNER_MCH_SERIAL_NO
       */
      serialNo: process.env.WECHAT_PARTNER_MCH_SERIAL_NO ?? '',

      /**
       * 服务商 API RSA 私钥文件路径（PEM），优先使用文件路径。
       * 对应环境变量：WECHAT_PARTNER_PRIVATE_KEY_PATH
       */
      privateKeyPath: process.env.WECHAT_PARTNER_PRIVATE_KEY_PATH ?? '',

      /**
       * 服务商 API RSA 私钥内容（PEM 内联），次优先级，用于 Docker secret 注入。
       * 对应环境变量：WECHAT_PARTNER_PRIVATE_KEY_CONTENT
       */
      privateKeyContent: process.env.WECHAT_PARTNER_PRIVATE_KEY_CONTENT ?? '',

      /**
       * 微信支付平台证书公钥（服务商商户号维度下载，PEM 内联），
       * 用于校验链路 a 回调的 Wechatpay-Signature。
       *
       * ⚠️ 平台证书是**按商户号维度**下发的：sp_mchid ≠ payMchId 时，
       * 服务商维度的平台证书与平台商户号的平台证书是两份不同证书，
       * 共用一份必然导致其中一条链路验签失败。
       * 对应环境变量：WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT
       */
      platformPublicKeyContent:
        process.env.WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT ?? '',

      /**
       * 服务商模式下发起支付的小程序 appid（sp_appid）。
       *
       * 未显式配置时回落 wechat.appId（purelyClub 小程序 AppID）——单向读取、
       * 不改动原配置；待 Q2 确认「purelyClub AppID 是否直接作为 sp_appid」后
       * 再决定是否需要按商家收集 sub_appid。
       * 对应环境变量：WECHAT_PARTNER_SP_APP_ID
       */
      spAppId:
        process.env.WECHAT_PARTNER_SP_APP_ID?.trim() ||
        process.env.WECHAT_APP_ID ||
        '',

      /**
       * 服务商模式的支付回调通知地址：必须是已备案的 HTTPS 公网地址，
       * 且指向 C 端订单回调路由 `/api/club/payments/wechat/callback`。
       * 对应环境变量：WECHAT_PARTNER_PAY_NOTIFY_URL
       */
      notifyUrl: process.env.WECHAT_PARTNER_PAY_NOTIFY_URL ?? '',

      /**
       * 豁免开关：允许 spMchId 与 wechat.payMchId 相等。
       *
       * 仅在确认「现有平台收款商户号本身就是微信支付服务商商户号」时才可开启，
       * 且必须同时填写 sharedMchIdReason 留档。禁止为了绕过启动校验随手打开。
       * 对应环境变量：WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID
       */
      allowSharedPlatformMchId:
        (process.env.WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID ?? 'false') ===
        'true',

      /**
       * 豁免原因留档（配合 allowSharedPlatformMchId 使用），空值视为未留档。
       * 对应环境变量：WECHAT_PARTNER_SHARED_MCH_ID_REASON
       */
      sharedMchIdReason: process.env.WECHAT_PARTNER_SHARED_MCH_ID_REASON ?? '',
    },
  },

  /**
   * 腾讯云短信服务配置。
   * 用于注册、登录、找回密码等场景的验证码发送。
   * 未配置时 AuthSmsService 降级为仅打印日志（开发模式）。
   */
  tencentSms: {
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
  },

  /**
   * 群发短信（营销中心 → 短信钱包）配置。
   *
   * 全部走配置而非硬编码：单价、告警阈值、充值档位都属于运营口径，
   * 改动不应触发发版。未配置时回落到 sms.constants.ts 的兜底值。
   */
  sms: {
    /** 短信单价（分/条），对应 SMS_UNIT_PRICE_FEN */
    unitPriceFen: parseInt(process.env.SMS_UNIT_PRICE_FEN ?? '5', 10),
    /** 余额告警阈值（分），对应 SMS_WARNING_THRESHOLD_FEN */
    warningThresholdFen: parseInt(
      process.env.SMS_WARNING_THRESHOLD_FEN ?? '500',
      10,
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
      .map((value) => parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
    /** 单条短信字数上限（超出按长短信拆分） */
    segmentSingleLimit: parseInt(
      process.env.SMS_SEGMENT_SINGLE_LIMIT ?? '70',
      10,
    ),
    /** 长短信每段字数上限 */
    segmentLongLimit: parseInt(process.env.SMS_SEGMENT_LONG_LIMIT ?? '67', 10),
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
    costPriceFen: parseInt(process.env.SMS_COST_PRICE_FEN ?? '0', 10),
  },

  /**
   * 腾讯云 COS 对象存储配置。
   * 用于头像、商品图等文件上传。
   * 未配置时上传接口返回 501（功能未启用）。
   */
  tencentCos: {
    /** 腾讯云 SecretId */
    secretId: process.env.TENCENT_COS_SECRET_ID ?? '',
    /** 腾讯云 SecretKey */
    secretKey: process.env.TENCENT_COS_SECRET_KEY ?? '',
    /** COS 存储桶地域（如 ap-shanghai、ap-guangzhou） */
    region: process.env.TENCENT_COS_REGION ?? '',
    /** COS 存储桶名称（格式：BucketName-AppId） */
    bucket: process.env.TENCENT_COS_BUCKET ?? '',
    /** CDN 加速域名（可选，配置后返回 CDN URL 而非 COS 原始 URL） */
    cdnDomain: process.env.TENCENT_COS_CDN_DOMAIN ?? '',
    /** 上传文件路径前缀（如 'uploads/'，末尾需带 /） */
    pathPrefix: process.env.TENCENT_COS_PATH_PREFIX ?? 'uploads/',
  },

  /**
   * 资金链路告警配置。
   *
   * 只服务需要人工立刻介入的资金事故（回调重试耗尽、落账失败、验签失败突增）：
   * 这类事件之前只进日志，等到用户投诉「钱扣了没到账」才被发现。
   *
   * 未配置 webhookUrl 时退化为结构化日志（见 AlertService），
   * 本地与未接入告警通道的环境不会因为告警而报错。
   * 对应环境变量：ALERT_WEBHOOK_URL
   * 示例：https://open.feishu.cn/open-apis/bot/v2/hook/xxx
   */
  alert: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
  },
});
