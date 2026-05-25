import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

@Injectable()
export class PulseDevModeAccessService {
  isEnabled(user: AuthenticatedUser): boolean {
    return user.pulseMode === 'developer' || user.isPulseDeveloper === true;
  }

  throwUnsupported(message: string): never {
    throw new ForbiddenException(message);
  }
}
