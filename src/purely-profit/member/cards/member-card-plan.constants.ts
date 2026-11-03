// 会员卡模板领域常量：枚举取值即接口契约，DTO / service / 映射层统一引用这里

/**
 * 卡类型：monthly/quarterly/yearly 为时长卡（有效期内不限次），times 为次数卡（按次扣减）。
 * 与前端 purelyProfit `memberCard.types.ts` 的 MemberCardKind 一一对应。
 */
export const MEMBER_CARD_KIND_VALUES = [
  'monthly',
  'quarterly',
  'yearly',
  'times',
] as const;

export type MemberCardKindValue = (typeof MEMBER_CARD_KIND_VALUES)[number];

/** 次数卡：唯一需要 totalTimes 的卡类型 */
export const MEMBER_CARD_TIMES_KIND: MemberCardKindValue = 'times';

/** 卡名称长度上限 */
export const MEMBER_CARD_PLAN_NAME_MAX_LENGTH = 30;

/** 有效天数上限（10 年）：既挡住明显录入错误，也避免 DateTime 溢出 */
export const MEMBER_CARD_PLAN_VALID_DAYS_MAX = 3650;

/** 总次数 / 单次扣次 / 单次人数 / 每人限购的上限 */
export const MEMBER_CARD_PLAN_TIMES_MAX = 9999;

/** 售价与划线价的元上限（再大的金额没有业务意义，同时防溢出） */
export const MEMBER_CARD_PLAN_PRICE_MAX = 9999999;

/** 可用空间类型编码条数上限 */
export const MEMBER_CARD_PLAN_SPACE_TYPES_MAX = 20;

/** 单个空间类型编码长度上限 */
export const MEMBER_CARD_PLAN_SPACE_TYPE_MAX_LENGTH = 32;
