/**
 * 提成模块常量。
 */

/** 单笔提成金额上限（元），与前端 COMMISSION_MAX 保持一致。 */
export const COMMISSION_AMOUNT_MAX = 100_000;

/** 服务名最大长度（字符）。 */
export const COMMISSION_SERVICE_NAME_MAX_LENGTH = 20;

/** 明细列表默认分页大小（前端固定传 8）。 */
export const COMMISSION_RECORDS_DEFAULT_PAGE_SIZE = 8;

/** 明细列表分页大小上限。 */
export const COMMISSION_RECORDS_MAX_PAGE_SIZE = 100;

/** 提成记录状态枚举值。 */
export const COMMISSION_RECORD_STATUS_VALUES = [
  'pending',
  'settled',
  'included',
  'cancelled',
] as const;

/** 结账后计入工资的提成状态集合（结算口径 settled+included）。 */
export const COMMISSION_SETTLED_STATUS_VALUES = [
  'settled',
  'included',
] as const;
