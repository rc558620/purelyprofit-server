export const AUTH_TOKEN_VERSION_KEY_PREFIX = 'auth:token-version:';
export const AUTH_PASSWORD_RESET_CODE_KEY_PREFIX = 'auth:password-reset:';
export const AUTH_REGISTER_CODE_KEY_PREFIX = 'auth:register:';
export const AUTH_SMS_SEND_COOLDOWN_KEY_PREFIX = 'auth:sms-cooldown:';
/** 验证码校验尝试次数 key 前缀 */
export const AUTH_CODE_ATTEMPTS_KEY_PREFIX = 'auth:code-attempts:';
/** 验证码最大尝试次数，超过后验证码自动失效 */
export const AUTH_CODE_MAX_ATTEMPTS = 5;
/** 验证码尝试次数锁定 TTL（秒），与验证码 TTL 对齐 */
export const AUTH_CODE_ATTEMPTS_LOCK_TTL_SECONDS = 600;

/** 登录失败计数 key 前缀 */
export const AUTH_LOGIN_FAIL_KEY_PREFIX = 'auth:login-fail:';
/** 登录最大连续失败次数，超过后临时锁定账号 */
export const AUTH_LOGIN_FAIL_MAX_ATTEMPTS = 5;
/** 登录失败达到此次数时，错误消息中附带剩余尝试次数提醒 */
export const AUTH_LOGIN_FAIL_WARNING_THRESHOLD = 2;
/** 登录失败锁定时长（秒） */
export const AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS = 900;
export const AUTH_PASSWORD_RESET_CODE_LENGTH = 6;
export const DEFAULT_PASSWORD_RESET_CODE_TTL_SECONDS = 600;
export const DEFAULT_REGISTER_CODE_TTL_SECONDS = 600;
export const DEFAULT_SMS_SEND_COOLDOWN_SECONDS = 60;
export const AUTH_PASSWORD_SALT_ROUNDS = 10;
export const AUTH_USER_CACHE_KEY_PREFIX = 'auth:user-cache:';
/** JWT validate 中 user 信息缓存的 TTL（秒），与 lastActiveAt 节流窗口对齐 */
export const AUTH_USER_CACHE_TTL_SECONDS = 300;
/** JWT validate 链路中 membership rows 缓存的 key 前缀 */
export const AUTH_MEMBERSHIP_ROWS_CACHE_KEY_PREFIX = 'auth:membership-rows:';
/** JWT validate 链路中 membership rows 缓存的 TTL（秒），比 user 缓存更短以确保权限及时更新 */
export const AUTH_MEMBERSHIP_ROWS_CACHE_TTL_SECONDS = 120;
/** JWT validate 链路中用户关联门店 ID 缓存的 key 前缀 */
export const AUTH_USER_RELATED_STORE_IDS_CACHE_KEY_PREFIX =
  'auth:user-related-stores:';
/** JWT validate 链路中用户关联门店 ID 缓存的 TTL（秒），用户加入/退出门店时主动失效 */
export const AUTH_USER_RELATED_STORE_IDS_CACHE_TTL_SECONDS = 300;

export const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';
export const ADMIN_LOGIN_ALIAS = 'admin';
export const ADMIN_LOGIN_PHONE = '13619654020';
export const PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX =
  'pulse:membership:admin:member:';

/** 活跃会话列表 Redis sorted set key 前缀 */
export const AUTH_SESSION_SET_KEY_PREFIX = 'auth:sessions:';
/** 会话 ID → refresh token hash 映射 key 前缀，用于淘汰时精确清理 refresh token */
export const AUTH_SESSION_TOKEN_HASH_KEY_PREFIX = 'auth:session-token-hash:';
/** 会话列表 key 的 TTL（秒）：30 天，与 refresh token 最大有效期对齐 */
export const AUTH_SESSION_SET_TTL_SECONDS = 30 * 24 * 60 * 60;
/** purely_profit 主账号最大并发会话数 */
export const MAX_SESSIONS_PROFIT_MAIN = 3;
/** purely_profit 子账号最大并发会话数 */
export const MAX_SESSIONS_PROFIT_SUB = 1;
/** purely_club 账号最大并发会话数 */
export const MAX_SESSIONS_CLUB = 1;
