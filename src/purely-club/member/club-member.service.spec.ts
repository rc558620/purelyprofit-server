import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
      findFirst: jest.fn(),
    },
    marketingRecharge: {
      aggregate: jest.fn(),
    },
    marketingMemberLevelSetting: {
      findUnique: jest.fn(),
    },
  };

  const clubRecordsService = {
    list: jest.fn(),
  };

  const authService = {
    updateAvatar: jest.fn(),
    updateNickname: jest.fn(),
    getProfile: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
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

  const wechatCurrentContext: ClubCurrentContext = {
    user: {
      ...user,
      id: 301,
      email: 'club_wechat_oOPENID123@purelyprofit.local',
      phone: 'club_wechat:oOPENID123',
      name: '微信昵称',
    },
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
    prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue(
      null,
    );
    // 默认 aggregate 返回 0，避免未显式 mock 的测试报错
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: null, giftAmount: null },
    });
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
        lastActiveAt: null,
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
        lastActiveAt: null,
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

  it('getProfile 返回 purely-club 当前用户基础资料', async () => {
    authService.getProfile.mockResolvedValue({
      user: {
        id: 201,
        phone: '13800138000',
        email: 'club_phone_13800138000@purelyprofit.local',
        name: '俱乐部用户',
        avatar: 'https://cdn.example.com/avatar-profile.png',
        verified: false,
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
        lastActiveAt: null,
      },
      store: null,
      currentMembership: null,
    });

    await expect(service.getProfile(user)).resolves.toEqual({
      id: '201',
      phone: '13800138000',
      nickname: '俱乐部用户',
      avatar: 'https://cdn.example.com/avatar-profile.png',
    });
    expect(authService.getProfile).toHaveBeenCalledWith(user);
  });

  it('getAccount 优先返回当前门店营销顾客余额与等级信息', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 28,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        id: 36,
        balance: 35000,
        points: 1280,
        tier: 'gold',
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );
    // 从 marketingRecharge 聚合：充值 320000 分 = ¥3200
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 320000 },
    });

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
        status: { not: 'banned' },
        deletedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        phone: '13800138000',
        deletedAt: null,
      },
      select: {
        id: true,
        balance: true,
        points: true,
        tier: true,
        createdAt: true,
      },
    });
    expect(prismaService.marketingRecharge.aggregate).toHaveBeenCalledWith({
      where: { customerId: 36, type: 'recharge' },
      _sum: { amount: true },
    });
  });

  it('getAccount 在没有营销顾客档案时余额积分消费均为零', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 8,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);

    await expect(service.getAccount(currentContext)).resolves.toEqual({
      id: '8',
      storeId: '11',
      balance: 0,
      level: 'regular',
      points: 0,
      memberCode: 'PC20240601008',
      joinDate: '2024-06-01',
      totalConsume: 0,
      heldLevel: 'regular',
      heldLevelLabel: '普通会员',
      heldLevelVisible: false,
    });
  });

  it('getAccount 对微信登录用户使用稳定标识查询会员与顾客档案', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 58,
        createdAt: new Date('2024-08-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        id: 66,
        balance: 26800,
        points: 920,
        tier: 'gold',
        createdAt: new Date('2024-08-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 126000 },
    });

    await expect(
      service.getAccount(wechatCurrentContext),
    ).resolves.toMatchObject({
      id: '58',
      storeId: '11',
      balance: 268,
      points: 920,
      totalConsume: 1260,
      heldLevel: 'gold',
    });
    expect(prismaService.member.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        phone: 'club_wechat:oOPENID123',
        status: { not: 'banned' },
        deletedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        phone: 'club_wechat:oOPENID123',
        deletedAt: null,
      },
      select: {
        id: true,
        balance: true,
        points: true,
        tier: true,
        createdAt: true,
      },
    });
  });

  it('getAccount 将 regular 等级正确映射（有充值记录时升级为 gold）', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 38,
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        balance: 12800,
        points: 320,
        tier: 'regular',
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );
    // 充值流水聚合：68000 分 = ¥680
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 68000 },
    });

    await expect(service.getAccount(currentContext)).resolves.toEqual({
      id: '38',
      storeId: '11',
      balance: 128,
      level: 'gold',
      points: 320,
      memberCode: 'PC20240701038',
      joinDate: '2024-07-01',
      totalConsume: 680,
      heldLevel: 'regular',
      heldLevelLabel: '普通会员',
      heldLevelVisible: false,
    });
  });

  it('getLevelStatus 返回当前等级、下一等级与升级进度', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 28,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        balance: 35000,
        points: 1280,
        tier: 'gold',
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );
    // 充值流水聚合：320000 分 = ¥3200
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 320000 },
    });

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

  it('getLevelStatus 将 regular 等级正确映射（有充值记录时升级为 gold）', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 38,
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        balance: 12800,
        points: 320,
        tier: 'regular',
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
      }),
    );
    // 充值流水聚合：68000 分 = ¥680
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 68000 },
    });

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
      heldLevel: 'regular',
      heldLevelLabel: '普通会员',
      heldLevelVisible: false,
    });
  });

  it('getLevelStatus 在最高等级时返回顶级状态', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 88,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        balance: 88000,
        points: 2880,
        tier: 'diamond',
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );
    // 充值流水聚合：1200000 分 = ¥12000
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 1200000 },
    });

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
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);
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
      currentLevel: 'regular',
      currentLevelLabel: '普通会员',
      currentRequiredConsume: 0,
      totalConsume: 0,
      nextLevel: null,
      nextLevelLabel: null,
      nextRequiredConsume: null,
      amountToNextLevel: 0,
      progressPct: 100,
      isTopLevel: true,
      heldLevel: 'regular',
      heldLevelLabel: '普通会员',
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
    expect(prismaService.marketingCustomer.findFirst).not.toHaveBeenCalled();
    expect(
      prismaService.marketingMemberLevelSetting.findUnique,
    ).toHaveBeenCalledWith({
      where: { storeId: 11 },
      select: { levels: true },
    });
  });

  it('getBenefits 返回当前等级与分层权益解锁状态', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 28,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        balance: 35000,
        points: 1280,
        tier: 'gold',
        createdAt: new Date('2024-05-28T00:00:00.000Z'),
      }),
    );
    // 充值流水聚合：320000 分 = ¥3200（gold 默认等级 totalConsume>=0 即解锁）
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 320000 },
    });

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

  it('getBenefits 当 platinum 被禁用且顾客 tier 为 platinum 时，展示等级不包含 platinum', async () => {
    prismaService.member.findFirst.mockResolvedValue(
      createMember({
        id: 8,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    // 顾客 tier=platinum，但充値仅 1888，未达到 platinum 门槛 5000
    prismaService.marketingCustomer.findFirst.mockResolvedValue(
      createMarketingCustomer({
        id: 8,
        balance: 18886,
        points: 680,
        tier: 'platinum',
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      }),
    );
    // 充值流水 188600 分 = ¥1886（不足 platinum 门槛）
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 188600 },
    });
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
        // totalConsume=1886 >= gold(0) → currentLevel='gold'
        currentLevel: 'gold',
        currentLevelLabel: '黄金会员',
        // snapshot.level = 'platinum'（来自 tier），但 platinum 在配置中已禁用
        heldLevel: 'platinum',
        heldLevelLabel: '铂金会员',
        heldLevelVisible: false,
        // visibleConfigs = [gold, diamond]，currentLevel='gold'
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
      expect.objectContaining({
        level: 'gold',
        discountRate: 0.88,
        requiredConsume: 0,
      }),
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
    // marketingCustomer 查询与 member 查询在 Promise.all 中并行执行，
    // 因此即使 member 为 null，marketingCustomer.findUnique 仍会被调用
  });
});

function createMember(
  overrides?: Partial<{
    id: number;
    createdAt: Date;
  }>,
): {
  id: number;
  createdAt: Date;
} {
  return {
    id: 1,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    ...overrides,
  };
}

function createMarketingCustomer(
  overrides?: Partial<{
    id: number;
    balance: number;
    points: number;
    tier: string;
    createdAt: Date;
  }>,
): {
  id: number;
  balance: number;
  points: number;
  tier: string;
  createdAt: Date;
} {
  return {
    id: 1,
    balance: 0,
    points: 0,
    tier: 'regular',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    ...overrides,
  };
}
