import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubRecordsService } from '../records/club-records.service';
import { ClubMemberService } from './club-member.service';
import { ClubMemberBenefitsService } from './member-benefits/club-member-benefits.service';
import { ClubMemberLevelsService } from './member-levels/club-member-levels.service';
import { ClubMemberProfileService } from './member-profile/club-member-profile.service';
import { ClubMemberTransactionsService } from './member-transactions/club-member-transactions.service';

describe('ClubMemberService', () => {
  let service: ClubMemberService;

  const prismaService = {
    member: {
      findFirst: jest.fn(),
    },
    marketingCustomer: {
      findUnique: jest.fn(),
    },
  };

  const clubRecordsService = {
    list: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const currentContext: ClubCurrentContext = {
    user,
    store: {
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubMemberProfileService,
        ClubMemberLevelsService,
        ClubMemberBenefitsService,
        ClubMemberTransactionsService,
        ClubMemberService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubRecordsService, useValue: clubRecordsService },
      ],
    }).compile();

    service = module.get<ClubMemberService>(ClubMemberService);
  });

  it('getAccount 优先返回当前门店营销顾客余额与等级信息', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 28,
        level: 'free',
        points: 260,
        totalConsumeAmount: new Decimal('3200.50'),
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(
      createMarketingCustomer({
        balance: 35000,
        points: 1280,
        tier: 'gold',
        totalSpent: 320000,
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );

    await expect(service.getAccount(currentContext)).resolves.toEqual({
      id: '28',
      storeId: '11',
      balance: 350,
      level: 'gold',
      points: 1280,
      memberCode: 'PC20240528028',
      joinDate: '2024-05-28',
      totalConsume: 3200,
    });
    expect(prismaService.member.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        phone: '13800138000',
        status: { not: 'BANNED' },
      },
      select: {
        id: true,
        level: true,
        points: true,
        totalConsumeAmount: true,
        createdAt: true,
      },
    });
    expect(prismaService.marketingCustomer.findUnique).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 11,
          phone: '13800138000',
        },
      },
      select: {
        balance: true,
        points: true,
        tier: true,
        totalSpent: true,
        createdAt: true,
      },
    });
  });

  it('getAccount 在没有营销顾客档案时回落到 Member 基础字段', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 8,
        level: 'platinum',
        points: 680,
        totalConsumeAmount: new Decimal('1888.60'),
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(null);

    await expect(service.getAccount(currentContext)).resolves.toEqual({
      id: '8',
      storeId: '11',
      balance: 0,
      level: 'platinum',
      points: 680,
      memberCode: 'PC20240601008',
      joinDate: '2024-06-01',
      totalConsume: 1888.6,
    });
  });

  it('getLevelStatus 返回当前等级、下一等级与升级进度', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 28,
        level: 'gold',
        points: 260,
        totalConsumeAmount: new Decimal('3200.50'),
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(
      createMarketingCustomer({
        balance: 35000,
        points: 1280,
        tier: 'gold',
        totalSpent: 320000,
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );

    await expect(service.getLevelStatus(currentContext)).resolves.toEqual({
      currentLevel: 'gold',
      currentLevelLabel: '黄金会员',
      currentRequiredConsume: 3000,
      totalConsume: 3200,
      nextLevel: 'platinum',
      nextLevelLabel: '铂金会员',
      nextRequiredConsume: 5000,
      amountToNextLevel: 1800,
      progressPct: 64,
      isTopLevel: false,
    });
  });

  it('getLevelStatus 在最高等级时返回顶级状态', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 88,
        level: 'diamond',
        points: 2880,
        totalConsumeAmount: new Decimal('10088.88'),
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(
      createMarketingCustomer({
        balance: 88000,
        points: 2880,
        tier: 'diamond',
        totalSpent: 1200000,
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );

    await expect(service.getLevelStatus(currentContext)).resolves.toEqual({
      currentLevel: 'diamond',
      currentLevelLabel: '钻石会员',
      currentRequiredConsume: 10000,
      totalConsume: 12000,
      nextLevel: null,
      nextLevelLabel: null,
      nextRequiredConsume: null,
      amountToNextLevel: 0,
      progressPct: 100,
      isTopLevel: true,
    });
  });

  it('getLevels 返回 purely-club 前端展示所需的等级配置列表', () => {
    expect(service.getLevels()).toEqual([
      expect.objectContaining({
        level: 'bronze',
        label: '普通会员',
        requiredConsume: 0,
      }),
      expect.objectContaining({
        level: 'silver',
        label: '白银会员',
        requiredConsume: 1000,
      }),
      expect.objectContaining({
        level: 'gold',
        label: '黄金会员',
        requiredConsume: 3000,
      }),
      expect.objectContaining({
        level: 'platinum',
        label: '铂金会员',
        requiredConsume: 5000,
      }),
      expect.objectContaining({
        level: 'diamond',
        label: '钻石会员',
        requiredConsume: 10000,
      }),
    ]);
    expect(prismaService.member.findFirst).not.toHaveBeenCalled();
    expect(prismaService.marketingCustomer.findUnique).not.toHaveBeenCalled();
  });

  it('getBenefits 返回当前等级与分层权益解锁状态', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 28,
        level: 'free',
        points: 260,
        totalConsumeAmount: new Decimal('3200.50'),
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(
      createMarketingCustomer({
        balance: 35000,
        points: 1280,
        tier: 'gold',
        totalSpent: 320000,
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );

    await expect(service.getBenefits(currentContext)).resolves.toEqual(
      expect.objectContaining({
        currentLevel: 'gold',
        currentLevelLabel: '黄金会员',
        items: expect.arrayContaining([
          expect.objectContaining({ level: 'bronze', unlocked: true }),
          expect.objectContaining({ level: 'gold', unlocked: true }),
          expect.objectContaining({ level: 'platinum', unlocked: false }),
        ]),
      }),
    );
  });

  it('listTransactions 复用 records 子域返回会员交易流水', async () => {
    clubRecordsService.list.mockResolvedValue({
      items: [
        {
          id: 'recharge-18',
          type: 'recharge',
          amount: 500,
          description: '充值 ¥500 赠 ¥80',
          createdAt: '2024-11-20T10:30:00.000Z',
          balanceSnapshot: 580,
          storeName: '望京旗舰店',
        },
      ],
    });

    await expect(
      service.listTransactions(currentContext, { type: 'recharge' }),
    ).resolves.toEqual({
      items: [
        {
          id: 'recharge-18',
          type: 'recharge',
          amount: 500,
          description: '充值 ¥500 赠 ¥80',
          createdAt: '2024-11-20T10:30:00.000Z',
          balanceSnapshot: 580,
          storeName: '望京旗舰店',
        },
      ],
    });
    expect(clubRecordsService.list).toHaveBeenCalledWith(currentContext, {
      type: 'recharge',
    });
  });

  it('getAccount 在当前门店没有会员档案时抛出 NotFoundException', async () => {
    prismaService.member.findFirst.mockResolvedValue(null);

    await expect(service.getAccount(currentContext)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaService.marketingCustomer.findUnique).not.toHaveBeenCalled();
  });
});

function createMember(
  overrides?: Partial<{
    id: number;
    storeId: number;
    level: string;
    points: number;
    totalConsumeAmount: Decimal;
    createdAt: Date;
  }>,
): {
  id: number;
  storeId: number;
  level: string;
  points: number;
  totalConsumeAmount: Decimal;
  createdAt: Date;
} {
  return {
    id: 1,
    storeId: 11,
    level: 'free',
    points: 0,
    totalConsumeAmount: new Decimal('0'),
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    ...overrides,
  };
}

function createMarketingCustomer(
  overrides?: Partial<{
    balance: number;
    points: number;
    tier: string;
    totalSpent: number;
    createdAt: Date;
  }>,
): {
  balance: number;
  points: number;
  tier: string;
  totalSpent: number;
  createdAt: Date;
} {
  return {
    balance: 0,
    points: 0,
    tier: 'regular',
    totalSpent: 0,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    ...overrides,
  };
}
