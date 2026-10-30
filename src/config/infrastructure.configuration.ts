import { parseIntValue } from './env.utils';

/** `database` 配置块：数据库连接与连接池预算。 */
export interface DatabaseConfig {
  url: string | undefined;
  poolMax: number;
  poolMin: number;
  poolIdleTimeoutMs: number;
  poolConnectionTimeoutMs: number;
  /** 单条 SQL 语句超时（毫秒），防止单条慢查询无限占用连接池连接 */
  statementTimeoutMs: number;
  /** PostgreSQL 侧 max_connections 配置值，集群模式据此调整每 worker 的 poolMax */
  pgMaxConnections: number;
}

/** `cluster` 配置块：进程集群。 */
export interface ClusterConfig {
  /** 集群 worker 进程数；未配置时为 undefined（由启动器回退到 CPU 核数） */
  workers: number | undefined;
}

/** `redis` 配置块：缓存与分布式锁通道。 */
export interface RedisConfig {
  host: string;
  port: number;
  password: string;
  db: number;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  maxRetriesPerRequest: number;
  tlsEnabled: boolean;
  /** Redis TLS CA 证书路径（PEM 格式），未配置时使用系统默认 CA 证书库 */
  tlsCaCertPath: string;
  /** 是否校验 Redis TLS 服务器证书（生产环境必须为 true） */
  tlsRejectUnauthorized: boolean;
}

/** `jwt` 配置块：令牌签发。 */
export interface JwtConfig {
  secret: string | undefined;
  expiresIn: string;
}

/** 基础设施层配置：数据库、集群、Redis、JWT。 */
export interface InfrastructureConfig {
  database: DatabaseConfig;
  cluster: ClusterConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
}

/** 解析数据库配置块。 */
export function resolveDatabaseConfig(): DatabaseConfig {
  return {
    url: process.env.DATABASE_URL,
    poolMax: parseIntValue(process.env.DATABASE_POOL_MAX, 20),
    poolMin: parseIntValue(process.env.DATABASE_POOL_MIN, 5),
    poolIdleTimeoutMs: parseIntValue(
      process.env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      30000,
    ),
    poolConnectionTimeoutMs: parseIntValue(
      process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      5000,
    ),
    /** 单条 SQL 语句超时（毫秒），防止单条慢查询无限占用连接池连接 */
    statementTimeoutMs: parseIntValue(
      process.env.DATABASE_STATEMENT_TIMEOUT_MS,
      10000,
    ),
    /**
     * PostgreSQL 侧 max_connections 配置值。
     * 集群模式下 PrismaService 会据此自动调整每 worker 的 poolMax，
     * 确保 workers × poolMax 不超过此值。
     * 未配置时默认 100（即 PostgreSQL 默认值）。
     */
    pgMaxConnections: parseIntValue(
      process.env.DATABASE_PG_MAX_CONNECTIONS,
      100,
    ),
  };
}

/** 解析集群配置块。 */
export function resolveClusterConfig(): ClusterConfig {
  return {
    /**
     * 集群 worker 进程数。未配置时默认跟随 CPU 核数。
     * 生产环境建议显式配置（如 4），避免自动跟随核数导致连接池总量超出 PG 限制。
     */
    workers: parseIntValue(process.env.CLUSTER_WORKERS, 0) || undefined,
  };
}

/** 解析 Redis 配置块。 */
export function resolveRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseIntValue(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD ?? '',
    db: parseIntValue(process.env.REDIS_DB, 0),
    connectTimeoutMs: parseIntValue(process.env.REDIS_CONNECT_TIMEOUT_MS, 5000),
    commandTimeoutMs: parseIntValue(process.env.REDIS_COMMAND_TIMEOUT_MS, 3000),
    maxRetriesPerRequest: parseIntValue(
      process.env.REDIS_MAX_RETRIES_PER_REQUEST,
      3,
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
  };
}

/** 解析 JWT 配置块。 */
export function resolveJwtConfig(): JwtConfig {
  return {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  };
}

/** 解析基础设施层配置（database / cluster / redis / jwt）。 */
export function resolveInfrastructureConfig(): InfrastructureConfig {
  return {
    database: resolveDatabaseConfig(),
    cluster: resolveClusterConfig(),
    redis: resolveRedisConfig(),
    jwt: resolveJwtConfig(),
  };
}
