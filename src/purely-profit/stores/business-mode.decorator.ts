import { SetMetadata } from '@nestjs/common';

/**
 * 业态断言类型。
 * - 'catering'：仅餐饮门店可访问
 * - 'general'：仅非餐饮门店可访问
 */
export type BusinessModeRequirement = 'catering' | 'general';

export const BUSINESS_MODE_KEY = 'businessModeRequirement';

/**
 * 装饰器：声明当前接口需要满足的门店业态。
 *
 * 用法示例：
 * ```ts
 * @RequireBusinessMode('general') // 仅非餐饮门店可访问
 * @RequireBusinessMode('catering') // 仅餐饮门店可访问
 * ```
 *
 * 需配合 `BusinessModeGuard` 使用。
 */
export const RequireBusinessMode = (mode: BusinessModeRequirement) =>
  SetMetadata(BUSINESS_MODE_KEY, mode);
