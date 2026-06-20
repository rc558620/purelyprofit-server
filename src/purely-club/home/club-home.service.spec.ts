import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubMemberService } from '../member/club-member.service';
import { ClubPromotionsService } from '../promotions/club-promotions.service';
import { ClubProductsService } from '../products/club-products.service';
import { ClubHomeService } from './club-home.service';

describe('ClubHomeService', () => {
  let service: ClubHomeService;

  const clubStoresService = {
    getCurrent: jest.fn(),
  };
  const clubMemberService = {
    getAccount: jest.fn(),
  };
  const clubPromotionsService = {
    list: jest.fn(),
  };
  const clubProductsService = {
    list: jest.fn(),
  };

  const currentContext = {
    user: {
      id: 201,
      email: 'club_phone_13800138000@purelyprofit.local',
      phone: '13800138000',
      name: '俱乐部用户',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      accountScope: 'purely_club',
      currentMembership: null,
    },
    store: {
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  } satisfies ClubCurrentContext;

  const mockStore = {
    id: 11,
    name: '望京旗舰店',
    address: '北京市朝阳区望京 SOHO T3 B1',
  };

  const mockAccount = {
    id: '201',
    storeId: '11',
    balance: 350,
    level: 'gold' as const,
    points: 1280,
    memberCode: 'PC20240601001',
    joinDate: '2024-06-01',
    totalConsume: 3200,
    heldLevel: 'gold' as const,
    heldLevelLabel: '黄金会员',
    heldLevelVisible: true,
  };

  const mockPromotions = {
    items: [
      {
        id: '8',
        name: '首单 8 折',
        type: 'first_order_discount',
        description: '',
        benefitText: '',
        params: { discountRate: 80 },
        startAt: 1780272000000,
        endAt: 1782863999000,
        statusText: '进行中',
        timeRangeText: '06.01-07.01',
        priority: 100,
        sort: 10,
        actionText: '去下单',
        actionType: 'view_products',
        actionTarget: 'club_products',
      },
    ],
  };

  const mockProducts = {
    items: [
      {
        id: '31',
        name: '经典养护套餐',
        description: '深层清洁 + 补水保湿',
        coverImage: '',
        originalPrice: 288,
        memberPrice: 199,
        type: 'package',
        tags: ['热销'],
        isHot: true,
        details: ['深层清洁 + 补水保湿'],
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubHomeService,
        { provide: ClubStoresService, useValue: clubStoresService },
        { provide: ClubMemberService, useValue: clubMemberService },
        { provide: ClubPromotionsService, useValue: clubPromotionsService },
        { provide: ClubProductsService, useValue: clubProductsService },
      ],
    }).compile();

    service = module.get<ClubHomeService>(ClubHomeService);
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('getHome 聚合首页需要的门店、会员、活动和精选商品数据', async () => {
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubPromotionsService.list.mockResolvedValue(mockPromotions);
    clubProductsService.list.mockResolvedValue(mockProducts);

    const result = await service.getHome(currentContext);

    expect(result).toEqual({
      currentStore: mockStore,
      account: mockAccount,
      accountStatus: 'active',
      promotions: mockPromotions.items,
      featuredProducts: mockProducts.items,
    });

    expect(clubStoresService.getCurrent).toHaveBeenCalledWith(currentContext);
    expect(clubMemberService.getAccount).toHaveBeenCalledWith(currentContext);
    expect(clubPromotionsService.list).toHaveBeenCalledWith(currentContext);
    expect(clubProductsService.list).toHaveBeenCalledWith(currentContext, {
      featured: true,
    });
  });

  // ─── 防御性校验 ──────────────────────────────────────────────────────────

  it('getHome 在 currentContext 缺少 user 时抛出 BadRequestException', async () => {
    const invalidContext = {
      ...currentContext,
      user: null,
    } as unknown as ClubCurrentContext;

    await expect(service.getHome(invalidContext)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getHome(invalidContext)).rejects.toThrow(
      '当前请求缺少 purely-club 上下文',
    );
  });

  it('getHome 在 currentContext 缺少 store 时抛出 BadRequestException', async () => {
    const invalidContext = {
      ...currentContext,
      store: null,
    } as unknown as ClubCurrentContext;

    await expect(service.getHome(invalidContext)).rejects.toThrow(
      BadRequestException,
    );
  });

  // ─── 降级场景 ──────────────────────────────────────────────────────────

  it('getHome 会员账户获取失败时降级返回 account=null, accountStatus=unavailable', async () => {
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockRejectedValue(new Error('会员服务异常'));
    clubPromotionsService.list.mockResolvedValue(mockPromotions);
    clubProductsService.list.mockResolvedValue(mockProducts);

    const result = await service.getHome(currentContext);

    expect(result.account).toBeNull();
    expect(result.accountStatus).toBe('unavailable');
    expect(result.currentStore).toEqual(mockStore);
    expect(result.promotions).toEqual(mockPromotions.items);
    expect(result.featuredProducts).toEqual(mockProducts.items);
  });

  it('getHome 活动列表获取失败时降级返回空列表', async () => {
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubPromotionsService.list.mockRejectedValue(new Error('活动服务异常'));
    clubProductsService.list.mockResolvedValue(mockProducts);

    const result = await service.getHome(currentContext);

    expect(result.promotions).toEqual([]);
    expect(result.accountStatus).toBe('active');
  });

  it('getHome 推荐商品获取失败时降级返回空列表', async () => {
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubPromotionsService.list.mockResolvedValue(mockPromotions);
    clubProductsService.list.mockRejectedValue(new Error('商品服务异常'));

    const result = await service.getHome(currentContext);

    expect(result.featuredProducts).toEqual([]);
    expect(result.accountStatus).toBe('active');
  });

  // ─── 关键服务不可用 ──────────────────────────────────────────────────

  it('getHome 门店信息获取失败且无法降级时抛出 ServiceUnavailableException', async () => {
    clubStoresService.getCurrent.mockRejectedValue(new Error('门店服务异常'));
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubPromotionsService.list.mockResolvedValue(mockPromotions);
    clubProductsService.list.mockResolvedValue(mockProducts);

    await expect(service.getHome(currentContext)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.getHome(currentContext)).rejects.toThrow(
      '首页门店信息暂时不可用',
    );
  });

  it('getHome 所有子服务均失败时抛出 ServiceUnavailableException', async () => {
    clubStoresService.getCurrent.mockRejectedValue(new Error('门店服务异常'));
    clubMemberService.getAccount.mockRejectedValue(new Error('会员服务异常'));
    clubPromotionsService.list.mockRejectedValue(new Error('活动服务异常'));
    clubProductsService.list.mockRejectedValue(new Error('商品服务异常'));

    await expect(service.getHome(currentContext)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ─── 空数据场景 ──────────────────────────────────────────────────────

  it('getHome 活动和商品均为空列表时正常返回', async () => {
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubPromotionsService.list.mockResolvedValue({ items: [] });
    clubProductsService.list.mockResolvedValue({ items: [] });

    const result = await service.getHome(currentContext);

    expect(result.promotions).toEqual([]);
    expect(result.featuredProducts).toEqual([]);
    expect(result.accountStatus).toBe('active');
  });

  it('getHome 会员账户为 null 且活动为空时 accountStatus 为 unavailable', async () => {
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockRejectedValue(new Error('无会员记录'));
    clubPromotionsService.list.mockResolvedValue({ items: [] });
    clubProductsService.list.mockResolvedValue({ items: [] });

    const result = await service.getHome(currentContext);

    expect(result.account).toBeNull();
    expect(result.accountStatus).toBe('unavailable');
    expect(result.promotions).toEqual([]);
    expect(result.featuredProducts).toEqual([]);
  });
});
