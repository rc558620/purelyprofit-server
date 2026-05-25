import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseDevModeAccessService } from './pulse-dev-mode-access.service';
import { PulseDevModeDashboardService } from './pulse-dev-mode-dashboard.service';
import { PulseDevModeGrowthService } from './pulse-dev-mode-growth.service';
import { PulseDevModeMembershipService } from './pulse-dev-mode-membership.service';
import { PulseDevModeSessionService } from './pulse-dev-mode-session.service';
import { PulseDevModeService } from './pulse-dev-mode.service';

describe('PulseDevModeService', () => {
  const service = new PulseDevModeService(
    new PulseDevModeAccessService(),
    new PulseDevModeSessionService(),
    new PulseDevModeDashboardService(),
    new PulseDevModeMembershipService(),
    new PulseDevModeGrowthService(),
  );

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'developer',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  it('buildSessionBootstrap 返回开发者兼容态字段', () => {
    expect(
      service.buildSessionBootstrap({
        id: 101,
        phone: '13800138000',
        name: '开发者',
        avatar: '',
        verified: true,
      }),
    ).toEqual({
      mode: 'developer',
      user: {
        id: 101,
        phone: '13800138000',
        name: '开发者',
        avatar: '',
        verified: true,
      },
      store: null,
      membership: {
        isActive: true,
        planId: 'developer',
        planName: '开发者模式',
        remainingDays: 36500,
        expiresAt: new Date('2099-12-31T23:59:59.999Z'),
      },
      unreadNotificationCount: 0,
      targetStoreSelected: false,
      hasOnboarded: true,
    });
  });

  it('buildOnboardingStatus 保持开发者模式的新旧字段语义', () => {
    expect(service.buildOnboardingStatus()).toEqual({
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
        storeName: '开发者模式',
      },
      storeId: null,
      storeName: '开发者模式',
    });
  });

  it('isEnabled 识别开发者账号', () => {
    expect(service.isEnabled(user)).toBe(true);
    expect(
      service.isEnabled({
        ...user,
        pulseMode: 'normal',
        isPulseDeveloper: false,
      }),
    ).toBe(false);
  });

  it('throwUnsupported 抛出禁止操作异常', () => {
    expect(() => service.throwUnsupported('禁止代目标商家操作')).toThrow(
      ForbiddenException,
    );
  });
});
