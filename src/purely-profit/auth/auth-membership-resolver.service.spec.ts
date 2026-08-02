import { AuthMembershipResolverService } from './auth-membership-resolver.service';
import type { AuthenticatedMembership } from '../access-control/access-control.service';

describe('AuthMembershipResolverService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    store: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
  };

  const accessControlService = {
    buildMembershipContext: jest.fn(),
  };

  const membershipQueryService = {
    findMembershipRows: jest.fn(),
  };

  const legacyOwnerRepairService = {
    repairLegacyOwnerMembership: jest.fn(),
  };

  const createService = (): AuthMembershipResolverService =>
    new AuthMembershipResolverService(
      prisma as never,
      redisService as never,
      accessControlService as never,
      membershipQueryService as never,
      legacyOwnerRepairService as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('会员行为空且遗留店主补齐成功后重新查询并返回 membership', async () => {
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

    membershipQueryService.findMembershipRows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 21,
          storeId: 9,
          userId: 1,
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
    legacyOwnerRepairService.repairLegacyOwnerMembership.mockResolvedValue(
      true,
    );
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

    expect(
      legacyOwnerRepairService.repairLegacyOwnerMembership,
    ).toHaveBeenCalledTimes(1);
    expect(membershipQueryService.findMembershipRows).toHaveBeenCalledTimes(2);
    expect(accessControlService.buildMembershipContext).toHaveBeenCalledTimes(1);
  });

  it('会员行为空且补齐失败时返回 null，不触发重新查询', async () => {
    const service = createService();

    membershipQueryService.findMembershipRows.mockResolvedValue([]);
    legacyOwnerRepairService.repairLegacyOwnerMembership.mockResolvedValue(
      false,
    );

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

    expect(
      legacyOwnerRepairService.repairLegacyOwnerMembership,
    ).toHaveBeenCalledTimes(1);
    expect(membershipQueryService.findMembershipRows).toHaveBeenCalledTimes(1);
    expect(accessControlService.buildMembershipContext).not.toHaveBeenCalled();
  });
});
