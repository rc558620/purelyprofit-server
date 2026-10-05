import { Injectable } from '@nestjs/common';
import type { OnboardingStatusResponseDto } from '../onboarding/dto/onboarding-status.dto';
import type {
  PulseSessionBootstrapResponseDto,
  PulseSessionUserDto,
} from '../session/dto/session-bootstrap.dto';
import {
  DEV_EXPIRES_AT,
  DEV_MODE_NAME,
  DEV_PLAN_ID,
  getDevRemainingDays,
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
        planId: DEV_PLAN_ID,
        planName: DEV_MODE_NAME,
        remainingDays: getDevRemainingDays(),
        // DTO 字段为 ISO 字符串（与真实链路缓存回读后的形态一致）
        expiresAt: DEV_EXPIRES_AT.toISOString(),
      },
      unreadNotificationCount: 0,
      targetStoreSelected: false,
      hasOnboarded: false,
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
