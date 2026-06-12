import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { AuthService } from '../../purely-profit/auth/auth.service';
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
    marketingMemberLevelSetting: {
      findUnique: jest.fn(),
    },
  };

  const clubRecordsService = {
    list: jest.fn(),
  };

  const authService = {
    changePassword: jest.fn(),
    updateAvatar: jest.fn(),
    updateNickname: jest.fn(),
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
    prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubMemberProfileService,
        ClubMemberLevelsService,
        ClubMemberBenefitsService,
        ClubMemberTransactionsService,
        ClubMemberService,
        { provide: AuthService, useValue: authService },
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubRecordsService, useValue: clubRecordsService },
      ],
    }).compile();

    service = module.get<ClubMemberService>(ClubMemberService);
  });

  it('changePassword 复用统一鉴权链路修改 purely-club 密码', async () => {
    authService.changePassword.mockResolvedValue({
      message: '密码修改成功，旧登录态已失效',
      access_token: 'club-next-token',
    });

    await expect(
      service.changePassword(user, {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
        confirmPassword: 'newPassword123',
      }),
    ).resolves.toEqual({
      message: '密码修改成功，旧登录态已失效',
      access_token: 'club-next-token',
    });
    expect(authService.changePassword).toHaveBeenCalledWith(user, {
      currentPassword: 'oldPassword123',
      newPassword: 'newPassword123',
      confirmPassword: 'newPassword123',
    });
  });

  it('updateAvatar 返回 purely-club 当前用户最新头像资料', async () => {
    authService.updateAvatar.mockResolvedValue({
      user: {
        id: 201,
        phone: '13800138000',
        email: 'club_phone_13800138000@purelyprofit.local',
        name: '俱乐部用户',
        avatar: 'https://cdn.example.com/avatar-new.png',
        verified: false,
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
      store: null,
      currentMembership: null,
    });

    await expect(
      service.updateAvatar(user, {
        avatar: 'https://cdn.example.com/avatar-new.png',
      }),
    ).resolves.toEqual({
      id: '201',
      phone: '13800138000',
      nickname: '俱乐部用户',
      avatar: 'https://cdn.example.com/avatar-new.png',
    });
    expect(authService.updateAvatar).toHaveBeenCalledWith(user, {
      avatar: 'https://cdn.example.com/avatar-new.png',
    });
  });

  it('updateNickname 返回 purely-club 当前用户最新昵称资料', async () => {
    authService.updateNickname.mockResolvedValue({
      user: {
        id: 201,
        phone: '13800138000',
        email: 'club_phone_13800138000@purelyprofit.local',
        name: '新昵称',
        avatar: '',
        verified: false,
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
      store: null,
      currentMembership: null,
    });

    await expect(
      service.updateNickname(user, { nickname: '新昵称' }),
    ).resolves.toEqual({
      id: '201',
      phone: '13800138000',
      nickname: '新昵称',
      avatar: '',
    });
    expect(authService.updateNickname).toHaveBeenCalledWith(user, '新昵称');
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
      heldLevel: 'gold',
      heldLevelLabel: '黄金会员',
      heldLevelVisible: true,
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
      level: 'gold',
      points: 680,
      memberCode: 'PC20240601008',
      joinDate: '2024-06-01',
      totalConsume: 1888.6,
      heldLevel: 'platinum',
      heldLevelLabel: '铂金会员',
      heldLevelVisible: true,
    });
  });

  it('getAccount 保留 regular 与 silver 的历史等级语义', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 38,
        level: 'free',
        points: 120,
        totalConsumeAmount: new Decimal('680.00'),
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(
      createMarketingCustomer({
        balance: 12800,
        points: 320,
        tier: 'silver',
        totalSpent: 68000,
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );

    await expect(service.getAccount(currentContext)).resolves.toEqual({
      id: '38',
      storeId: '11',
      balance: 128,
      level: 'gold',
      points: 320,
      memberCode: 'PC20240701038',
      joinDate: '2024-07-01',
      totalConsume: 680,
      heldLevel: 'silver',
      heldLevelLabel: '白银会员',
      heldLevelVisible: false,
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
      currentRequiredConsume: 0,
      totalConsume: 3200,
      nextLevel: 'platinum',
      nextLevelLabel: '铂金会员',
      nextRequiredConsume: 5000,
      amountToNextLevel: 1800,
      progressPct: 64,
      isTopLevel: false,
      heldLevel: 'gold',
      heldLevelLabel: '黄金会员',
      heldLevelVisible: true,
    });
  });

  it('getLevelStatus 对 regular 与 silver 兼容等级保留历史持有信息', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 38,
        level: 'free',
        points: 120,
        totalConsumeAmount: new Decimal('680.00'),
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findUnique.mockResolvedValue(
      createMarketingCustomer({
        balance: 12800,
        points: 320,
        tier: 'silver',
        totalSpent: 68000,
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );

    await expect(service.getLevelStatus(currentContext)).resolves.toEqual({
      currentLevel: 'gold',
      currentLevelLabel: '黄金会员',
      currentRequiredConsume: 0,
      totalConsume: 680,
      nextLevel: 'platinum',
      nextLevelLabel: '铂金会员',
      nextRequiredConsume: 5000,
      amountToNextLevel: 4320,
      progressPct: 13.6,
      isTopLevel: false,
      heldLevel: 'silver',
      heldLevelLabel: '白银会员',
      heldLevelVisible: false,
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
      heldLevel: 'diamond',
      heldLevelLabel: '钻石会员',
      heldLevelVisible: true,
    });
  });

  it('getLevelStatus 区分展示等级与历史持有等级', async () => {
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
    prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue({
      levels: [
        {
          id: 'gold',
          name: '黄金会员',
          discountRate: 0.9,
          spendThreshold: 0,
          description: '注册即享 9 折优惠',
          enabled: true,
          updatedAt: 1,
        },
        {
          id: 'platinum',
          name: '铂金会员',
          discountRate: 0.85,
          spendThreshold: 500000,
          description: '累计消费满 5000 元升级',
          enabled: false,
          updatedAt: 2,
        },
        {
          id: 'diamond',
          name: '钻石会员',
          discountRate: 0.8,
          spendThreshold: 1000000,
          description: '累计消费满 10000 元升级',
          enabled: true,
          updatedAt: 3,
        },
      ],
    });

    await expect(service.getLevelStatus(currentContext)).resolves.toEqual({
      currentLevel: 'gold',
      currentLevelLabel: '黄金会员',
      currentRequiredConsume: 0,
      totalConsume: 1888.6,
      nextLevel: 'diamond',
      nextLevelLabel: '钻石会员',
      nextRequiredConsume: 10000,
      amountToNextLevel: 8111.4,
      progressPct: 18.89,
      isTopLevel: false,
      heldLevel: 'platinum',
      heldLevelLabel: '铂金会员',
      heldLevelVisible: false,
    });
  });

  it('getLevels 返回当前门店的黄金铂金钻石等级配置列表', async () => {
    await expect(service.getLevels(currentContext)).resolves.toEqual([
      expect.objectContaining({
        level: 'gold',
        label: '黄金会员',
        requiredConsume: 0,
        discountRate: 0.9,
      }),
      expect.objectContaining({
        level: 'platinum',
        label: '铂金会员',
        requiredConsume: 5000,
        discountRate: 0.9,
      }),
      expect.objectContaining({
        level: 'diamond',
        label: '钻石会员',
        requiredConsume: 10000,
        discountRate: 0.8,
      }),
    ]);
    expect(prismaService.member.findFirst).not.toHaveBeenCalled();
    expect(prismaService.marketingCustomer.findUnique).not.toHaveBeenCalled();
    expect(prismaService.marketingMemberLevelSetting.findUnique).toHaveBeenCalledWith({
      where: { storeId: 11 },
      select: { levels: true },
    });
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
        heldLevel: 'gold',
        heldLevelLabel: '黄金会员',
        heldLevelVisible: true,
        items: expect.arrayContaining([
          expect.objectContaining({ level: 'gold', unlocked: true }),
          expect.objectContaining({ level: 'platinum', unlocked: false }),
          expect.objectContaining({ level: 'diamond', unlocked: false }),
        ]),
      }),
    );
  });

  it('getBenefits 区分可展示等级与历史持有等级', async () => {
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
    prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue({
      levels: [
        {
          id: 'gold',
          name: '黄金会员',
          discountRate: 0.9,
          spendThreshold: 0,
          description: '注册即享 9 折优惠',
          enabled: true,
          updatedAt: 1,
        },
        {
          id: 'platinum',
          name: '铂金会员',
          discountRate: 0.85,
          spendThreshold: 500000,
          description: '累计消费满 5000 元升级',
          enabled: false,
          updatedAt: 2,
        },
        {
          id: 'diamond',
          name: '钻石会员',
          discountRate: 0.8,
          spendThreshold: 1000000,
          description: '累计消费满 10000 元升级',
          enabled: true,
          updatedAt: 3,
        },
      ],
    });

    await expect(service.getBenefits(currentContext)).resolves.toEqual(
      expect.objectContaining({
        currentLevel: 'gold',
        currentLevelLabel: '黄金会员',
        heldLevel: 'platinum',
        heldLevelLabel: '铂金会员',
        heldLevelVisible: false,
        items: [
          expect.objectContaining({ level: 'gold', unlocked: true }),
          expect.objectContaining({ level: 'diamond', unlocked: false }),
        ],
      }),
    );
  });

  it('getLevels 对齐营销会员等级配置中的折扣与升级门槛', async () => {
    prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue({
      levels: [
        {
          id: 'gold',
          name: '黄金会员',
          discountRate: 0.88,
          spendThreshold: 0,
          description: '注册即享 8.8 折优惠',
          enabled: true,
          updatedAt: 1,
        },
        {
          id: 'platinum',
          name: '铂金会员',
          discountRate: 0.85,
          spendThreshold: 680000,
          description: '累计消费满 6800 元升级',
          enabled: true,
          updatedAt: 2,
        },
        {
          id: 'diamond',
          name: '钻石会员',
          discountRate: 0.78,
          spendThreshold: 1280000,
          description: '累计消费满 12800 元升级',
          enabled: true,
          updatedAt: 3,
        },
      ],
    });

    await expect(service.getLevels(currentContext)).resolves.toEqual([
      expect.objectContaining({ level: 'gold', discountRate: 0.88, requiredConsume: 0 }),
      expect.objectContaining({
        level: 'platinum',
        discountRate: 0.85,
        requiredConsume: 6800,
      }),
      expect.objectContaining({
        level: 'diamond',
        discountRate: 0.78,
        requiredConsume: 12800,
      }),
    ]);
  });

  it('getLevels 不返回已停用的高阶会员等级', async () => {
    prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue({
      levels: [
        {
          id: 'gold',
          name: '黄金会员',
          discountRate: 0.9,
          spendThreshold: 0,
          description: '注册即享 9 折优惠',
          enabled: true,
          updatedAt: 1,
        },
        {
          id: 'platinum',
          name: '铂金会员',
          discountRate: 0.85,
          spendThreshold: 680000,
          description: '累计消费满 6800 元升级',
          enabled: false,
          updatedAt: 2,
        },
        {
          id: 'diamond',
          name: '钻石会员',
          discountRate: 0.78,
          spendThreshold: 1280000,
          description: '累计消费满 12800 元升级',
          enabled: true,
          updatedAt: 3,
        },
      ],
    });

    await expect(service.getLevels(currentContext)).resolves.toEqual([
      expect.objectContaining({ level: 'gold' }),
      expect.objectContaining({ level: 'diamond' }),
    ]);
    await expect(service.getLevels(currentContext)).resolves.toHaveLength(2);
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
