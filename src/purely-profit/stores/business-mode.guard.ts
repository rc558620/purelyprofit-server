import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StoreBusinessCapabilityService } from './store-business-capability.service';
import {
  BUSINESS_MODE_KEY,
  type BusinessModeRequirement,
} from './business-mode.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * 门店业态守卫。
 *
 * 配合 `@RequireBusinessMode()` 装饰器使用：
 * - `@RequireBusinessMode('general')` → 仅非餐饮门店可访问
 * - `@RequireBusinessMode('catering')` → 仅餐饮门店可访问
 *
 * 守卫从数据库读取门店 businessMode，不依赖 Redis 缓存。
 * 判断依据是门店注册业态，不是当前账号类型。
 */
@Injectable()
export class BusinessModeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly storeBusinessCapabilityService: StoreBusinessCapabilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<
      BusinessModeRequirement | undefined
    >(BUSINESS_MODE_KEY, [context.getHandler(), context.getClass()]);

    // 未声明业态要求的接口直接放行
    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('请先登录后再操作');
    }

    const capabilities =
      await this.storeBusinessCapabilityService.getCapabilities(user);

    if (requirement === 'catering' && !capabilities.isCateringStore) {
      throw new ForbiddenException('该功能仅适用于餐饮门店');
    }

    if (requirement === 'general' && !capabilities.isGeneralStore) {
      throw new ForbiddenException('该功能仅适用于非餐饮门店');
    }

    return true;
  }
}
