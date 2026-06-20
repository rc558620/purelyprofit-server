import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

@Injectable()
export class PulseDevModeAccessService {
  /**
   * 判断当前用户是否为 Pulse 开发者。
   * 同时提供静态方法，供无法通过 DI 注入的场景直接调用，
   * 确保 isDeveloper 判定逻辑在全仓库只有一份事实来源。
   */
  isDeveloper(user: AuthenticatedUser): boolean {
    return PulseDevModeAccessService.isDeveloper(user);
  }

  /** 静态版本，供其他 access service 直接调用，无需 DI 注入 */
  static isDeveloper(user: AuthenticatedUser): boolean {
    return user.isPulseDeveloper === true || user.pulseMode === 'developer';
  }

  isEnabled(user: AuthenticatedUser): boolean {
    return this.isDeveloper(user);
  }

  throwUnsupported(message: string): never {
    throw new ForbiddenException(message);
  }
}
