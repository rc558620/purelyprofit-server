import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseSwitchCurrentStoreResponseDto } from './dto/session-bootstrap.dto';
import { buildStoreDto } from './session.utils';

@Injectable()
export class SessionStoreService {
  constructor(
    private readonly pulseStoreContextService: PulseStoreContextService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    const store = await this.pulseStoreContextService.switchTargetStore(
      user,
      storeId,
    );
    await Promise.all([
      this.cacheInvalidatorService.invalidatePulseSessionBootstrapByUser(
        user.id,
      ),
      this.cacheInvalidatorService.invalidatePulseOnboardingStatusByUser(
        user.id,
      ),
    ]);

    return {
      success: true,
      store: buildStoreDto(store),
    };
  }
}
