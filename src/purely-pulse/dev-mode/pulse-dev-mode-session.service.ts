import { Injectable } from '@nestjs/common';
import type { OnboardingStatusResponseDto } from '../onboarding/dto/onboarding-status.dto';
import type {
  PulseSessionBootstrapResponseDto,
  PulseSessionUserDto,
} from '../session/dto/session-bootstrap.dto';
import {
  DEV_EXPIRES_AT,
  DEV_MODE_NAME,
  DEV_REMAINING_DAYS,
} from './pulse-dev-mode.constants';

@Injectable()
export class PulseDevModeSessionService {
  buildSessionBootstrap(
    sessionUser: PulseSessionUserDto,
  ): PulseSessionBootstrapResponseDto {
    return {
      mode: 'developer',
      user: sessionUser,
      store: null,
      membership: {
        isActive: true,
        planId: 'developer',
        planName: DEV_MODE_NAME,
        remainingDays: DEV_REMAINING_DAYS,
        expiresAt: DEV_EXPIRES_AT,
      },
      unreadNotificationCount: 0,
      targetStoreSelected: false,
      hasOnboarded: true,
    };
  }

  buildOnboardingStatus(): OnboardingStatusResponseDto {
    return {
      isCompleted: true,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName: true,
        hasCreatedStore: true,
        hasMembership: true,
      },
      targetStatus: {
        isReady: true,
        storeSelected: false,
        merchantVerified: true,
        membershipActive: true,
        storeId: null,
        storeName: DEV_MODE_NAME,
      },
      storeId: null,
      storeName: DEV_MODE_NAME,
    };
  }
}
