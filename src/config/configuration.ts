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
    /** SQL metrics 采样率：1 = 全量记录，10 = 每 10 条采样 1 条 */
    sqlMetricsSampleRate: parseInt(
      process.env.APP_SQL_METRICS_SAMPLE_RATE ?? '1',
      10,
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
    /** 飞鹅开放接口地址（默认正式地址） */
    apiUrl:
      process.env.FEIE_PRINT_API_URL ?? 'https://api.de.feieyun.com/Api/Open/',
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
     */
    publicBaseUrl: process.env.CLUB_PUBLIC_BASE_URL ?? '',
    /**
     * 邀请二维码稳定入口路径前缀，默认 /i，最终二维码形如
     * {publicBaseUrl}/i/v1/{inviteCode}。
     * 对应环境变量：CLUB_STORE_INVITE_QR_ENTRY_PATH
     */
    storeInviteQrEntryPath: process.env.CLUB_STORE_INVITE_QR_ENTRY_PATH ?? '/i',
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
    /** 登录验证码模板 ID */
    loginTemplateId: process.env.TENCENT_SMS_LOGIN_TEMPLATE_ID ?? '',
    /** 找回密码验证码模板 ID */
    passwordResetTemplateId:
      process.env.TENCENT_SMS_PASSWORD_RESET_TEMPLATE_ID ?? '',
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
});
