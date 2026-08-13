import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import { ClubInviteScanResolveService } from './club-invite-scan-resolve.service';
import { ClubMemberBindingService } from './club-member-binding.service';
import { ClubStoreAccessService } from './club-store-access.service';
import { aNonEmptyObject } from '../../spec-matchers';
import { ClubStoreViewService } from './club-store-view.service';
import { ClubStoresService } from './club-stores.service';

/** ClubCurrentStoreContextService 中 CLUB_SELECTED_STORE_TTL_SECONDS 的值 */
const CLUB_SELECTED_STORE_TTL = 30 * 24 * 60 * 60;

describe('ClubStoresService', () => {
  let service: ClubStoresService;

  const prismaService = {
    store: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    storeInviteCode: {
      findMany: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    marketingCustomer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
  };

  const storesProfileService = {
    readStoreProfileMetadata: jest.fn(),
    batchReadStoreProfileMetadata: jest.fn(),
  };

  const inviteAttributionService = {
    logInviteScan: jest.fn(),
    resolveIssueScanAttribution: jest.fn(),
    incrementIssueJoinedCount: jest.fn(),
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

  const wechatUser: AuthenticatedUser = {
    ...user,
    id: 301,
    email: 'club_wechat_oOPENID123@purelyprofit.local',
    phone: 'club_wechat:oOPENID123',
    name: '微信昵称',
  };

  const mockMetadata = {
    storeType: '',
    region: [],
    storeLogo: 'https://cdn.example.com/store-cover.png',
    latitude: 39.984104,
    longitude: 116.307503,
  };

  /** 期望的门店摘要结构 */
  const expectedStoreSummary = {
    address: '北京市朝阳区望京 SOHO T3 B1',
    businessMode: 'general',
    isOpen: true,
    coverImage: 'https://cdn.example.com/store-cover.png',
    latitude: 39.984104,
    longitude: 116.307503,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Mock $transaction to execute callback with prismaService as tx
    prismaService.$transaction.mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback(prismaService);
      }
      return Promise.all(callback);
    });
    storesProfileService.readStoreProfileMetadata.mockResolvedValue(
      mockMetadata,
    );
    storesProfileService.batchReadStoreProfileMetadata.mockResolvedValue([]);
    // 默认邀请码映射缓存未命中
    redisService.getJson.mockResolvedValue(null);
    // 真实事务链路：member / marketingCustomer 均不存在时走创建路径
    prismaService.member.findFirst.mockResolvedValue(null);
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);
    inviteAttributionService.resolveIssueScanAttribution.mockResolvedValue({
      continueScan: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubStoreAccessService,
        ClubCurrentStoreContextService,
        ClubStoreViewService,
        ClubStoresService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: StoresProfileService, useValue: storesProfileService },
        ClubInviteCodeMapService,
        {
          provide: ClubInviteAttributionService,
          useValue: inviteAttributionService,
        },
        { provide: ClubInviteScanResolveService, useValue: {} },
        ClubMemberBindingService,
      ],
    }).compile();

    service = module.get<ClubStoresService>(ClubStoresService);
  });

  it('list 在无历史选择时回落到第一个可访问门店并持久化', async () => {
    const store11 = createStore({ id: 11, name: '望京旗舰店' });
    const store12 = createStore({ id: 12, name: '三里屯店' });

    prismaService.store.findMany.mockResolvedValueOnce([store11, store12]);
    redisService.get.mockResolvedValue(null);
    storesProfileService.batchReadStoreProfileMetadata.mockResolvedValue([
      mockMetadata,
      mockMetadata,
    ]);

    await expect(service.list(user)).resolves.toEqual({
      items: [
        { id: 11, name: '望京旗舰店', ...expectedStoreSummary },
        { id: 12, name: '三里屯店', ...expectedStoreSummary },
      ],
      currentStoreId: 11,
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '11',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('list 会优先返回已保存且仍可访问的当前门店', async () => {
    const store11 = createStore({ id: 11, name: '望京旗舰店' });
    const store12 = createStore({ id: 12, name: '三里屯店' });

    prismaService.store.findMany.mockResolvedValueOnce([store11, store12]);
    redisService.get.mockResolvedValue('12');
    storesProfileService.batchReadStoreProfileMetadata.mockResolvedValue([
      mockMetadata,
      mockMetadata,
    ]);

    await expect(service.list(user)).resolves.toMatchObject({
      currentStoreId: 12,
    });
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('getCurrent 返回当前上下文中的门店信息', async () => {
    storesProfileService.readStoreProfileMetadata.mockResolvedValue(
      mockMetadata,
    );

    await expect(
      service.getCurrent({
        user,
        store: createStore({ id: 11, name: '望京旗舰店' }),
      }),
    ).resolves.toEqual({
      id: 11,
      name: '望京旗舰店',
      ...expectedStoreSummary,
    });
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('switchCurrent 只允许切换到本人可访问的门店', async () => {
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );

    await expect(service.switchCurrent(user, 18)).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
      },
    });
    expect(prismaService.store.findFirst).toHaveBeenCalledWith({
      where: {
        id: 18,
        deletedAt: null,
        members: {
          some: {
            phone: '13800138000',
            status: { not: 'banned' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        address: true,
        businessMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );

    prismaService.store.findFirst.mockResolvedValue(null);

    await expect(service.switchCurrent(user, 19)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('joinByScanCode 会识别二维码 URL 中的邀请码并切换门店', async () => {
    const inviteCode = 'AB23CD45'; // 持久化邀请码（8 位，新字符集）

    // 设置邀请码映射缓存命中
    redisService.getJson.mockResolvedValue({ [inviteCode]: 18 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findFirst.mockResolvedValue(null);
    prismaService.member.create.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.create.mockResolvedValue({ id: 3801 });

    await expect(
      service.joinByScanCode(
        user,
        `https://club.purelyprofit.local/pages/storeSelect/index?inviteCode=${inviteCode}`,
      ),
    ).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
      },
    });
    expect(prismaService.member.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
    });
    expect(prismaService.marketingCustomer.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
    });
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('joinByInviteCode 会自动入会并切换到邀请码对应门店', async () => {
    const inviteCode = 'AB23CD45'; // 持久化邀请码（8 位，新字符集）

    redisService.getJson.mockResolvedValue({ [inviteCode]: 18 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findFirst.mockResolvedValue(null);
    prismaService.member.create.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.create.mockResolvedValue({ id: 3801 });

    await expect(service.joinByInviteCode(user, inviteCode)).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
      },
    });
    expect(prismaService.member.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
    });
    expect(prismaService.marketingCustomer.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
    });
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('joinByInviteCode 对微信登录用户使用稳定标识建档', async () => {
    const inviteCode = 'AB23CD45'; // 持久化邀请码（8 位，新字符集）

    redisService.getJson.mockResolvedValue({ [inviteCode]: 18 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findFirst.mockResolvedValue(null);
    prismaService.member.create.mockResolvedValue({ id: 4801 });
    prismaService.marketingCustomer.create.mockResolvedValue({ id: 5801 });

    await expect(
      service.joinByInviteCode(wechatUser, inviteCode),
    ).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
      },
    });
    expect(prismaService.member.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '微信昵称',
        phone: 'club_wechat:oOPENID123',
      },
    });
    expect(prismaService.marketingCustomer.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '微信昵称',
        phone: 'club_wechat:oOPENID123',
      },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:301',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('joinByInviteCode 缓存未命中时从 store_invite_codes 表构建邀请码映射', async () => {
    const inviteCode = 'AB23CD45'; // 持久化邀请码（非 LCG 算法）

    // 缓存未命中：getJson 返回 null
    redisService.getJson.mockResolvedValue(null);
    // loadInviteCodeMap 内部调用 storeInviteCode.findMany
    prismaService.storeInviteCode.findMany.mockResolvedValue([
      { code: 'XY56ZW78', storeId: 11 },
      { code: inviteCode, storeId: 18 },
    ]);
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findFirst.mockResolvedValue(null);
    prismaService.member.create.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.create.mockResolvedValue({ id: 3801 });

    const result = await service.joinByInviteCode(user, inviteCode);
    expect(result.success).toBe(true);
    expect(result.store.id).toBe(18);

    // 验证映射已写入缓存
    expect(redisService.setJson).toHaveBeenCalledWith(
      'club:invite-code-map',
      aNonEmptyObject,
      3600,
    );
  });

  it('joinByScanCode 在扫码内容无法识别时拒绝加入', async () => {
    await expect(
      service.joinByScanCode(user, 'not-a-store-code'),
    ).rejects.toThrow('扫码结果无效，未识别到门店邀请码');
    expect(prismaService.store.findMany).not.toHaveBeenCalled();
  });

  it('joinByInviteCode 在邀请码无效时拒绝加入', async () => {
    redisService.getJson.mockResolvedValue({});

    await expect(
      service.joinByInviteCode(user, 'INVALID'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

const baseStore = {
  id: 1,
  name: '门店',
  address: '北京市朝阳区望京 SOHO T3 B1',
  businessMode: 'general' as const,
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
};

function createStore(overrides?: Partial<typeof baseStore>): typeof baseStore {
  return { ...baseStore, ...overrides };
}
