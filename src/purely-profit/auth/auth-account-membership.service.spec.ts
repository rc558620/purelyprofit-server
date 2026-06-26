import { StaffRole, StaffStatus } from '@prisma/client';
import { AuthAccountMembershipService } from './auth-account-membership.service';
import type { AuthenticatedMembership } from '../access-control/access-control.service';

describe('AuthAccountMembershipService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    store: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
    mgetJson: jest.fn().mockResolvedValue([]),
    delByPattern: jest.fn().mockResolvedValue(undefined),
  };

  const accessControlService = {
    buildMembershipContext: jest.fn(),
  };

  const createService = (): AuthAccountMembershipService =>
    new AuthAccountMembershipService(
      prisma as never,
      redisService as never,
      accessControlService as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.store.findMany.mockResolvedValue([]);
  });

  it('老店主仅存在 stores.ownerId 时会自动补齐 OWNER staff 并返回 membership', async () => {
    const service = createService();
    const membership = {
      staffId: 21,
      storeId: 9,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    } satisfies AuthenticatedMembership;

    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 21,
        storeId: 9,
        role: 'owner',
        permissions: ['*'],
        isActive: true,
        linkedEmployeeId: null,
        subAccountId: null,
        subAccountRole: null,
        subAccountStatus: null,
        subAccountAssigned: null,
        subAccountCanAccessHome: null,
        subAccountCanUseHandover: null,
      },
    ]);
    prisma.store.findFirst.mockResolvedValue({
      id: 9,
      owner: {
        id: 1,
        email: 'owner@example.com',
        name: '老店主',
      },
    });
    prisma.staff.findFirst.mockResolvedValue(null);
    prisma.staff.create.mockResolvedValue({
      id: 21,
      storeId: 9,
    });
    accessControlService.buildMembershipContext.mockReturnValue(membership);

    await expect(
      service.resolveAuthenticatedMembership(
        {
          sub: 1,
          phone: '13800138000',
          sessionVersion: 0,
        },
        'owner@example.com',
      ),
    ).resolves.toEqual(membership);

    expect(prisma.staff.create).toHaveBeenCalledWith({
      data: {
        storeId: 9,
        userId: 1,
        email: 'owner@example.com',
        phone: '13800138000',
        name: '老店主',
        role: StaffRole.owner,
        permissions: ['*'],
        status: StaffStatus.active,
        isSeatActive: true,
        isActive: true,
      },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('若命中其他门店 staff 记录则跳过补齐，避免覆盖错误上下文', async () => {
    const service = createService();

    prisma.$queryRaw.mockResolvedValue([]);
    prisma.store.findFirst.mockResolvedValue({
      id: 9,
      owner: {
        id: 1,
        email: 'owner@example.com',
        name: '老店主',
      },
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 30,
      storeId: 99,
    });

    await expect(
      service.resolveAuthenticatedMembership(
        {
          sub: 1,
          phone: '13800138000',
          sessionVersion: 0,
        },
        'owner@example.com',
      ),
    ).resolves.toBeNull();

    expect(prisma.staff.create).not.toHaveBeenCalled();
    expect(prisma.staff.update).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
