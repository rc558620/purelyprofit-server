import { ForbiddenException } from '@nestjs/common';
import {
  ensureResourceBelongsToStore,
  ensureUserHasStore,
  ensureUserIsStoreOwner,
} from './resource-ownership.utils';

describe('resource-ownership.utils', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    email: 'test@example.com',
    phone: '13800138000',
    name: '测试用户',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: {
      staffId: 10,
      storeId: 18,
      role: 'owner',
      permissions: ['finance:view'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
    ...overrides,
  });

  describe('ensureUserHasStore', () => {
    it('有门店时返回 storeId', () => {
      const user = buildUser();
      expect(ensureUserHasStore(user as any)).toBe(18);
    });

    it('无门店时抛出 ForbiddenException', () => {
      const user = buildUser({ currentMembership: null });
      expect(() => ensureUserHasStore(user as any)).toThrow(ForbiddenException);
    });

    it('membership 无 storeId 时抛出 ForbiddenException', () => {
      const user = buildUser({
        currentMembership: {
          ...buildUser().currentMembership,
          storeId: undefined,
        },
      });
      expect(() => ensureUserHasStore(user as any)).toThrow(ForbiddenException);
    });
  });

  describe('ensureUserIsStoreOwner', () => {
    it('owner 角色不抛异常', () => {
      const user = buildUser();
      expect(() => ensureUserIsStoreOwner(user as any)).not.toThrow();
    });

    it('staff 角色抛出 ForbiddenException', () => {
      const user = buildUser({
        currentMembership: { ...buildUser().currentMembership, role: 'staff' },
      });
      expect(() => ensureUserIsStoreOwner(user as any)).toThrow(
        ForbiddenException,
      );
    });

    it('currentMembership 为 null 时抛出 ForbiddenException', () => {
      const user = buildUser({ currentMembership: null });
      expect(() => ensureUserIsStoreOwner(user as any)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('ensureResourceBelongsToStore', () => {
    it('资源归属同一门店不抛异常', () => {
      const user = buildUser();
      expect(() => ensureResourceBelongsToStore(user as any, 18)).not.toThrow();
    });

    it('资源归属不同门店抛出 ForbiddenException', () => {
      const user = buildUser();
      expect(() => ensureResourceBelongsToStore(user as any, 99)).toThrow(
        ForbiddenException,
      );
    });

    it('用户无门店时抛出 ForbiddenException', () => {
      const user = buildUser({ currentMembership: null });
      expect(() => ensureResourceBelongsToStore(user as any, 18)).toThrow(
        ForbiddenException,
      );
    });
  });
});
