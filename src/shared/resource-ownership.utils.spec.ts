import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../purely-profit/auth/strategies/jwt.strategy';
import type { AuthenticatedMembership } from '../purely-profit/access-control/access-control.service';
import {
  ensureResourceBelongsToStore,
  ensureUserHasStore,
  ensureUserIsStoreOwner,
} from './resource-ownership.utils';

type UserOverride = Partial<Omit<AuthenticatedUser, 'currentMembership'>> & {
  currentMembership?: Partial<AuthenticatedMembership> | null;
};

const defaultMembership: AuthenticatedMembership = {
  staffId: 10,
  storeId: 18,
  role: 'owner',
  permissions: ['finance:view'],
  isActive: true,
  subjectType: 'owner',
  linkedEmployeeId: null,
  subAccountId: null,
  subAccountRole: null,
  subAccountStatus: null,
  subAccountAssigned: false,
  canAccessHome: true,
  canUseHandover: true,
};

describe('resource-ownership.utils', () => {
  const buildUser = (overrides: UserOverride = {}): AuthenticatedUser => {
    const base: AuthenticatedUser = {
      id: 1,
      email: 'test@example.com',
      phone: '13800138000',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
      currentMembership: defaultMembership,
    };
    return { ...base, ...overrides } as unknown as AuthenticatedUser;
  };

  describe('ensureUserHasStore', () => {
    it('有门店时返回 storeId', () => {
      const user = buildUser();
      expect(ensureUserHasStore(user)).toBe(18);
    });

    it('无门店时抛出 ForbiddenException', () => {
      const user = buildUser({ currentMembership: null });
      expect(() => ensureUserHasStore(user)).toThrow(ForbiddenException);
    });

    it('membership 无 storeId 时抛出 ForbiddenException', () => {
      const user = buildUser({
        currentMembership: {
          ...defaultMembership,
          storeId: undefined,
        } as unknown as AuthenticatedMembership,
      });
      expect(() => ensureUserHasStore(user)).toThrow(ForbiddenException);
    });
  });

  describe('ensureUserIsStoreOwner', () => {
    it('owner 角色不抛异常', () => {
      const user = buildUser();
      expect(() => ensureUserIsStoreOwner(user)).not.toThrow();
    });

    it('staff 角色抛出 ForbiddenException', () => {
      const user = buildUser({
        currentMembership: { ...defaultMembership, role: 'staff' },
      });
      expect(() => ensureUserIsStoreOwner(user)).toThrow(ForbiddenException);
    });

    it('currentMembership 为 null 时抛出 ForbiddenException', () => {
      const user = buildUser({ currentMembership: null });
      expect(() => ensureUserIsStoreOwner(user)).toThrow(ForbiddenException);
    });
  });

  describe('ensureResourceBelongsToStore', () => {
    it('资源归属同一门店不抛异常', () => {
      const user = buildUser();
      expect(() => ensureResourceBelongsToStore(user, 18)).not.toThrow();
    });

    it('资源归属不同门店抛出 ForbiddenException', () => {
      const user = buildUser();
      expect(() => ensureResourceBelongsToStore(user, 99)).toThrow(
        ForbiddenException,
      );
    });

    it('用户无门店时抛出 ForbiddenException', () => {
      const user = buildUser({ currentMembership: null });
      expect(() => ensureResourceBelongsToStore(user, 18)).toThrow(
        ForbiddenException,
      );
    });
  });
});
