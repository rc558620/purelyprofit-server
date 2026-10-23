import { SetMetadata } from '@nestjs/common';

export const MEMBER_CARE_KEY = 'memberCareRequired';

/**
 * 装饰器：声明当前接口仅对「SPA/养生/美容」模式门店开放。
 *
 * 会员护理档案不是业态能力（businessMode 只有 catering / general 两态），
 * 而是注册时选定的**门店模式档位**，因此不能用 `@RequireBusinessMode` 表达，
 * 需要独立的装饰器 + `MemberCareGuard` 配合。
 *
 * 用法示例：
 * ```ts
 * @UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard, MemberCareGuard)
 * @RequireBusinessMode('general')
 * @RequireMemberCare()
 * ```
 */
export const RequireMemberCare = (): MethodDecorator & ClassDecorator =>
  SetMetadata(MEMBER_CARE_KEY, true);
