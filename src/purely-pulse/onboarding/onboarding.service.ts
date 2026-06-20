import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseDevModeService } from '../dev-mode/pulse-dev-mode.service';
import type { OnboardingStatusResponseDto } from './dto/onboarding-status.dto';
import { OnboardingStatusService } from './onboarding-status.service';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly statusService: OnboardingStatusService,
    private readonly devModeService: PulseDevModeService,
  ) {}

  getStatus(user: AuthenticatedUser): Promise<OnboardingStatusResponseDto> {
    if (this.devModeService.isEnabled(user)) {
      return Promise.resolve(this.devModeService.buildOnboardingStatus());
    }

    return this.statusService.getStatus(user);
  }
}
