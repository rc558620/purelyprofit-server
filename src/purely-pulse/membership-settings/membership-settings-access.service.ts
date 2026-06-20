import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseDevModeAccessService } from '../dev-mode/pulse-dev-mode-access.service';

@Injectable()
export class PulseMembershipSettingsAccessService {
  ensureDeveloperOrThrow(user: AuthenticatedUser): void {
    if (this.isDeveloper(user)) {
      return;
    }

    throw new ForbiddenException('仅 Pulse 开发者可维护会员套餐配置');
  }

  isDeveloper(user: AuthenticatedUser): boolean {
    return PulseDevModeAccessService.isDeveloper(user);
  }
}
