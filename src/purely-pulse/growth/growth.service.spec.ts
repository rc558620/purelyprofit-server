import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { PulseGrowthService } from './growth.service';

describe('PulseGrowthService', () => {
  let service: PulseGrowthService;

  const prismaService = {
    storePartner: {
      findUnique: jest.fn(),
    },
    storeMembershipPromoRecord: {
      findMany: jest.fn(),
    },
    partnerWithdrawal: {
      count: jest.fn(),
    },
    storePartnerBeanLog: {
      findMany: jest.fn(),
    },
  };

  const platformMembershipService = {
    getPromoCenterByStoreId: jest.fn(),
    getPartnerProfileByStoreId: jest.fn(),
  };

  const pulseStoreContextService = {
    resolveTargetStoreOrThrow: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseGrowthService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: PlatformMembershipService,
          useValue: platformMembershipService,
        },
        {
          provide: PulseStoreContextService,
          useValue: pulseStoreContextService,
        },
      ],
    }).compile();

    service = module.get<PulseGrowthService>(PulseGrowthService);
  });

  it('getPromoCenter 通过显式 storeId 查看目标商家增长中心', async () => {
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });
    platformMembershipService.getPromoCenterByStoreId.mockResolvedValue({
      memberInfo: {
        isActive: true,
        planId: 'quarterly',
        expiredAt: new Date('2026-05-30T00:00:00.000Z').getTime(),
        inviteCode: 'PP-18',
        totalPoints: 300,
        availablePoints: 120,
      },
      approvedPartner: null,
      level: {
        partnerLevel: null,
        monthChargedCount: 0,
        monthCountToNextLevel: null,
      },
      stats: {
        totalPromos: 0,
        chargedPromos: 0,
        promoRate: 0,
        earnedBeans: 0,
      },
      statsByPeriod: {
        all: { totalPromos: 0, chargedPromos: 0, promoRate: 0, earnedBeans: 0 },
        today: { totalPromos: 0, chargedPromos: 0, promoRate: 0, earnedBeans: 0 },
        month: { totalPromos: 0, chargedPromos: 0, promoRate: 0, earnedBeans: 0 },
        year: { totalPromos: 0, chargedPromos: 0, promoRate: 0, earnedBeans: 0 },
      },
      items: [],
    });

    const result = await service.getPromoCenter(user);

    expect(pulseStoreContextService.resolveTargetStoreOrThrow).toHaveBeenCalledWith(
      user,
      {
        notFoundMessage: '当前未选中目标商家门店，暂无法查看增长中心',
      },
    );
    expect(platformMembershipService.getPromoCenterByStoreId).toHaveBeenCalledWith(
      18,
    );
    expect(result.items).toEqual([]);
  });

  it('applyPartner 在观察态下显式拒绝代商家发起申请', async () => {
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });

    await expect(
      service.applyPartner(user, {
        name: '张老板',
        phone: '13800138000',
        idCard: '440301199001011234',
        region: ['广东省', '深圳市', '南山区'],
        intention: 'resource',
        applyReason: '熟悉门店经营',
        paymentMethod: 'wechat',
        paymentAccount: 'wx_123',
      }),
    ).rejects.toThrow(
      new ForbiddenException(
        'Pulse 当前按开发者观察态运行，暂不支持代目标商家提交合伙人申请',
      ),
    );
  });
});
