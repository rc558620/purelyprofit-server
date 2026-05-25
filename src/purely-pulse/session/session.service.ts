import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  PulseSessionBootstrapResponseDto,
  PulseSwitchCurrentStoreResponseDto,
} from './dto/session-bootstrap.dto';
import { SessionBootstrapService } from './session-bootstrap.service';
import { SessionStoreService } from './session-store.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly sessionBootstrapService: SessionBootstrapService,
    private readonly sessionStoreService: SessionStoreService,
  ) {}

  bootstrap(
    user: AuthenticatedUser,
  ): Promise<PulseSessionBootstrapResponseDto> {
    return this.sessionBootstrapService.bootstrap(user);
  }

  switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    return this.sessionStoreService.switchCurrentStore(user, storeId);
  }
}
