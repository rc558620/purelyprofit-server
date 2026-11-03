import { Test, TestingModule } from '@nestjs/testing';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthMembershipResolverService } from './auth-membership-resolver.service';
import { AuthProfileService } from './auth-profile.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

describe('AuthProfileService', () => {
  let service: AuthProfileService;

  const authAccountLookupService = {
    findProfileUserOrThrow: jest.fn(),
  };

  const prismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    staff: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    employee: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    marketingCustomer: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    member: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const redisService = {
    del: jest.fn().mockResolvedValue(1),
  };

  const authMembershipResolverService = {
    findCurrentMembership: jest.fn(),
    readStoreProfileMetadata: jest.fn(),
  };

  const accessControlService = {
    getEffectivePermissions: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidatePulseOnboardingStatusByUser: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'staff',
      permissions: ['marketing:view'],
      isActive: true,
      subjectType: 'sub_account',
      linkedEmployeeId: 12,
      subAccountId: 3,
      subAccountRole: 'manager',
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: false,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    authAccountLookupService.findProfileUserOrThrow.mockResolvedValue({
      id: 1,
      email: 'boss@example.com',
      name: '老板',
      avatar: null,
      realName: '张三',
      idNumber: '110101199001011234',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      lastActiveAt: null,
    });
    authMembershipResolverService.findCurrentMembership.mockResolvedValue({
      staffId: 8,
      storeId: 18,
      role: 'staff',
      permissions: ['marketing:view'],
      isActive: true,
      identityType: 'sub_account',
      subAccountRole: 'manager',
      storeName: '纯利宝测试门店',
      address: '北京市朝阳区望京街道 1 号',
      businessMode: 'general' as const,
      storeCreatedAt: new Date('2026-05-01T00:00:00.000Z'),
      storeUpdatedAt: new Date('2026-05-10T00:00:00.000Z'),
    });
    authMembershipResolverService.readStoreProfileMetadata.mockResolvedValue({
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      storeLogo: 'https://img.test/store.png',
      latitude: 39.984104,
      longitude: 116.307503,
    });
    accessControlService.getEffectivePermissions.mockReturnValue([
      'staff:view',
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthProfileService,
        {
          provide: AuthAccountLookupService,
          useValue: authAccountLookupService,
        },
        {
          provide: AuthMembershipResolverService,
          useValue: authMembershipResolverService,
        },
        { provide: AccessControlService, useValue: accessControlService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<AuthProfileService>(AuthProfileService);
  });

  it('返回完整的子账号 profile 契约字段', async () => {
    await expect(service.getProfile(user)).resolves.toEqual({
      user: {
        id: 1,
        phone: '13800138000',
        email: 'boss@example.com',
        name: '老板',
        avatar: '',
        verified: true,
        realName: '张三',
        idNumberMasked: '110101********1234',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
      store: {
        id: 18,
        storeName: '纯利宝测试门店',
        storeType: '零售',
        businessMode: 'general',
        region: ['北京市', '北京市', '朝阳区'],
        address: '北京市朝阳区望京街道 1 号',
        // mock 会员行未返回 technicianLabel → 兜底默认「技师」
        technicianLabel: '技师',
        storeLogo: 'https://img.test/store.png',
        latitude: 39.984104,
        longitude: 116.307503,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-10T00:00:00.000Z'),
      },
      currentMembership: {
        identityType: 'sub_account',
        subAccountRole: 'manager',
        subAccountRoleLabel: '店长',
        staffId: 8,
        linkedEmployeeId: 12,
        storeId: 18,
        role: 'staff',
        permissions: ['marketing:view'],
        isActive: true,
        subAccountId: 3,
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: false,
      },
    });
    expect(
      authAccountLookupService.findProfileUserOrThrow,
    ).toHaveBeenCalledWith(1);
    expect(
      authMembershipResolverService.findCurrentMembership,
    ).toHaveBeenCalledWith(user);
    expect(
      authMembershipResolverService.readStoreProfileMetadata,
    ).toHaveBeenCalledWith(18);
    expect(accessControlService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('修改昵称后返回最新 profile', async () => {
    prismaService.user.update.mockResolvedValue(undefined);

    await expect(service.updateNickname(user, '新老板')).resolves.toMatchObject(
      {
        user: {
          id: 1,
          phone: '13800138000',
        },
      },
    );

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: '新老板' },
    });
    expect(
      authAccountLookupService.findProfileUserOrThrow,
    ).toHaveBeenCalledWith(1);
  });

  it('修改昵称后把新名字同步到各门店顾客档案与会员档案', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      wechatPhone: '15919654010',
      email: 'club_phone_15919654011@purelyprofit.local',
    });
    prismaService.user.update.mockResolvedValue(undefined);

    await service.updateNickname(user, 'America');

    // 归属：clubUserId 精确命中 + clubUserId 为空的孤儿档案按关联手机号兜底
    const ownership = [
      { clubUserId: 1 },
      { clubUserId: null, phone: { in: ['15919654010', '15919654011'] } },
    ];

    expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
      where: { OR: ownership, deletedAt: null },
      data: { name: 'America' },
    });
    expect(prismaService.member.updateMany).toHaveBeenCalledWith({
      where: { OR: ownership, deletedAt: null },
      data: { name: 'America' },
    });
  });

  it('无关联手机号时只按 clubUserId 同步，不用手机号兜底', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      wechatPhone: null,
      email: 'boss@example.com',
    });
    prismaService.user.update.mockResolvedValue(undefined);

    await service.updateNickname(user, 'America');

    expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ clubUserId: 1 }], deletedAt: null },
      data: { name: 'America' },
    });
  });

  it('顾客档案同步失败不影响昵称更新结果', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      wechatPhone: null,
      email: 'boss@example.com',
    });
    prismaService.user.update.mockResolvedValue(undefined);
    prismaService.marketingCustomer.updateMany.mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(
      service.updateNickname(user, 'America'),
    ).resolves.toMatchObject({ user: { id: 1 } });
  });

  it('实名认证后会失效 Pulse onboarding 状态缓存', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);
    prismaService.user.update.mockResolvedValue(undefined);

    await service.verifyRealName(user, '李老板', '440301199001011234');

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { realName: '李老板', idNumber: '440301199001011234' },
    });
    expect(
      cacheInvalidatorService.invalidatePulseOnboardingStatusByUser,
    ).toHaveBeenCalledWith(1);
  });

  it('active membership 不匹配时回退到权限计算，但不返回子账号运行态字段', async () => {
    const staleUser: AuthenticatedUser = {
      ...user,
      currentMembership: user.currentMembership
        ? {
            ...user.currentMembership,
            staffId: 99,
          }
        : null,
    };

    await expect(service.getProfile(staleUser)).resolves.toMatchObject({
      currentMembership: {
        identityType: 'sub_account',
        subAccountRole: 'manager',
        staffId: 8,
        storeId: 18,
        role: 'staff',
        permissions: ['staff:view'],
        isActive: true,
      },
    });
    expect(accessControlService.getEffectivePermissions).toHaveBeenCalledWith({
      role: 'staff',
      permissions: ['marketing:view'],
    });
  });
});
