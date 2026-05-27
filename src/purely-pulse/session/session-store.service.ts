import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseSwitchCurrentStoreResponseDto } from './dto/session-bootstrap.dto';
import { buildStoreDto } from './session.utils';

@Injectable()
export class SessionStoreService {
  constructor(
    private readonly pulseStoreContextService: PulseStoreContextService,
  ) {}

  async switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    const store = await this.pulseStoreContextService.switchTargetStore(
      user,
      storeId,
    );

    return {
      success: true,
      store: buildStoreDto(store),
    };
  }
}
