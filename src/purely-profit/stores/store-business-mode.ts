/**
 * 门店业态（businessMode）推导的单一事实源。
 *
 * 背景：业态曾由三处各自硬编码 `storeType === '餐饮'` 推导（前端 addStore.types.ts、
 * 后端 stores.utils.ts、回填脚本 backfill-business-mode.ts）。任一侧调整门店类型文案
 * 都会造成前后端静默撕裂，故统一收敛到本文件。
 *
 * 项目规则：门店业态在注册时确定，注册后不可切换。
 * - 创建路径：由 storeType 推导并落库（见 resolveBusinessMode）
 * - 更新路径：拒绝跨业态变更（见 StoresWriteService.updateCurrent）
 *
 * 注意：本文件必须保持零依赖（不 import @nestjs/* 或 @prisma/client），
 * 以便 prisma/scripts 下的 ts-node 脚本直接引用。
 */

/** 门店业态取值。 */
export type StoreBusinessModeValue = 'catering' | 'general';

/** 划分为餐饮业态的门店类型白名单（与前端 STORE_TYPE_OPTIONS 的 businessMode 字段一一对应）。 */
export const CATERING_STORE_TYPES: readonly string[] = ['餐饮'];

/**
 * 划分为非餐饮业态的门店类型。
 * 仅用于文档说明与前端选项同步核对；推导时按「白名单之外皆为非餐饮」处理，
 * 因此新增门店类型无需同步修改本文件即可安全落到 general。
 */
export const GENERAL_STORE_TYPES: readonly string[] = [
  '零售',
  '服务',
  '便利店',
  'SPA/养生/美容/',
  '其他',
];

/**
 * 启用「会员护理档案」的门店类型白名单。
 *
 * 「SPA/养生/美容/」是**一种**门店模式（不是三种），注册时选定后注册后不可变更。
 * 与前端 `STORE_TYPE_OPTIONS` 的 `MEMBER_CARE_STORE_TYPE` 必须保持一致。
 */
export const MEMBER_CARE_STORE_TYPES: readonly string[] = ['SPA/养生/美容/'];

/** 归一化门店类型：去首尾空白 + 去结尾斜杠，避免文案微调导致功能开关静默失效。 */
const normalizeStoreTypeKey = (value: string): string =>
  value.trim().replace(/\/+$/, '');

/**
 * 判断门店类型是否为「SPA/养生/美容/」：会员护理档案的启用条件。
 *
 * 与 businessMode 无关——该模式属于非餐饮业态下的细分类型，
 * 因此不能用 `isGeneralStore` 代替本判断。
 */
export function isMemberCareStoreType(storeType: unknown): boolean {
  if (typeof storeType !== 'string') {
    return false;
  }

  const normalizedStoreType = normalizeStoreTypeKey(storeType);
  if (normalizedStoreType === '') {
    return false;
  }

  return MEMBER_CARE_STORE_TYPES.some(
    (candidate) => normalizeStoreTypeKey(candidate) === normalizedStoreType,
  );
}

/** 无法判定业态时的兜底值（最小权限原则：非餐饮不开放扫码点餐等餐饮专属能力）。 */
const FALLBACK_BUSINESS_MODE: StoreBusinessModeValue = 'general';

/**
 * 由门店类型推导业态。
 * @param storeType - 门店展示类型（中文，如「餐饮」「零售」）。
 * @returns 命中餐饮白名单返回 catering；其余非空值返回 general；空值返回 null 表示无法判定。
 */
export function deriveBusinessModeFromStoreType(
  storeType: unknown,
): StoreBusinessModeValue | null {
  if (typeof storeType !== 'string') {
    return null;
  }

  const normalizedStoreType = storeType.trim();
  if (normalizedStoreType === '') {
    return null;
  }

  return CATERING_STORE_TYPES.includes(normalizedStoreType)
    ? 'catering'
    : 'general';
}

/**
 * 解析门店业态：storeType 优先，businessMode 仅作兜底。
 *
 * storeType 是用户在注册页的真实选择（事实源），businessMode 是派生字段。
 * 两者冲突时以 storeType 推导结果为准，避免前端传参错误污染业态。
 */
export function resolveBusinessMode(
  storeType: unknown,
  businessMode: unknown,
): StoreBusinessModeValue {
  const derivedMode = deriveBusinessModeFromStoreType(storeType);
  if (derivedMode !== null) {
    return derivedMode;
  }

  return businessMode === 'catering' ? 'catering' : FALLBACK_BUSINESS_MODE;
}
