// 客存验证码 Redis key 前缀与 TTL 常量：所有业务语义常量集中于此，禁止在业务文件写魔法数字
/** 取件码 key 前缀（客户生成 → 店员输入核销） */
export const CUSTODY_PICKUP_CODE_KEY_PREFIX = 'custody:pickup:';

/** 核销预留令牌 key 前缀（取件码校验成功后签发，用于确认取出阶段防重放） */
export const CUSTODY_VERIFY_TOKEN_KEY_PREFIX = 'custody:verify:';

/** 存单 → 取件码绑定 key 前缀（客户取消或重复签发时定位上一枚码） */
export const CUSTODY_PICKUP_ORDER_KEY_PREFIX = 'custody:pickup-order:';

/** 核销校验失败计数 key 前缀（B 端店员侧，防止暴力枚举 6 位取件码） */
export const CUSTODY_CONFIRM_FAIL_KEY_PREFIX = 'custody:confirm:fail:';

/** 门店统计缓存 key 前缀（任何客存写操作都需要失效该 key） */
export const CUSTODY_SUMMARY_KEY_PREFIX = 'custody:summary:';

/** 业务码长度（6 位纯数字） */
export const CUSTODY_CODE_LENGTH = 6;

/** 取件码有效期（秒）：客户出示后需在此时间内被核销 */
export const PICKUP_CODE_TTL_SECONDS = 60;

/** 核销预留令牌有效期（秒）：留给门店店员确认取出 */
export const VERIFY_TOKEN_TTL_SECONDS = 300;

/** 核销失败计数窗口（秒）：窗口内连续失败达到阈值即锁定该店员 */
export const CONFIRM_FAIL_WINDOW_TTL_SECONDS = 600;

/** 核销连续失败锁定阈值 */
export const CONFIRM_FAIL_MAX_ATTEMPTS = 5;

/** 连续失败锁定后需等待的时长（秒） */
export const CONFIRM_FAIL_LOCK_SECONDS = 600;

/** 核销预留令牌长度 */
export const VERIFY_TOKEN_LENGTH = 32;

/** 生成短码时的最大重试次数（极低概率撞码时重试） */
export const CODE_ISSUE_MAX_RETRY = 5;

/**
 * 门店客存统计缓存有效期（秒）。
 *
 * 独立常量而非复用取件码 TTL：统计口径与取件码生命周期无关，
 * 且惰性过期会让统计随时间漂移，缓存不宜过长。
 */
export const CUSTODY_SUMMARY_CACHE_TTL_SECONDS = 60;
