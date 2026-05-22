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
    slowRequestLogEnabled:
      (process.env.APP_SLOW_REQUEST_LOG_ENABLED ?? 'true') === 'true',
    slowRequestThresholdMs: parseInt(
      process.env.APP_SLOW_REQUEST_THRESHOLD_MS ?? '800',
      10,
    ),
    defaultPageSize: parseInt(process.env.APP_DEFAULT_PAGE_SIZE ?? '20', 10),
    maxPageSize: parseInt(process.env.APP_MAX_PAGE_SIZE ?? '100', 10),
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
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
});
