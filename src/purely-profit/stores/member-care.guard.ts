import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StoreBusinessCapabilityService } from './store-business-capability.service';
import { MEMBER_CARE_KEY } from './member-care.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * 会员护理档案档位守卫。
 *
 * 配合 `@RequireMemberCare()` 装饰器使用：仅注册时选择「SPA/养生/美容/」
 * 模式的门店可访问，其余门店一律 403。
 *
 * 与 `BusinessModeGuard` 是**叠加**关系（最终可访问 = 业态允许 && 档位允许
 * && 原有账号权限允许），两者互不替代：
 * - `BusinessModeGuard('general')` 只保证「非餐饮」
 * - 非餐饮业态下的零售 / 服务 / 便利店 / 其他门店同样不开放护理档案
 */
@Injectable()
export class MemberCareGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly storeBusinessCapabilityService: StoreBusinessCapabilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      MEMBER_CARE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 未声明档位要求的接口直接放行
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('请先登录后再操作');
    }

    await this.storeBusinessCapabilityService.ensureMemberCareAccess(user);

    return true;
  }
}
