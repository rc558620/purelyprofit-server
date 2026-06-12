import { Test, TestingModule } from '@nestjs/testing';
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

  it('getHome 聚合首页需要的门店、会员、活动和精选商品数据', async () => {
    clubStoresService.getCurrent.mockResolvedValue({
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
    });
    clubMemberService.getAccount.mockResolvedValue({
      id: '201',
      storeId: '11',
      balance: 350,
      level: 'gold',
      points: 1280,
      memberCode: 'PC20240601001',
      joinDate: '2024-06-01',
      totalConsume: 3200,
    });
    clubPromotionsService.list.mockResolvedValue({
      items: [
        {
          id: '8',
          name: '首单 8 折',
          type: 'first_order_discount',
          description: '',
          benefitText: '首单 8折',
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
    });
    clubProductsService.list.mockResolvedValue({
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
    });

    await expect(service.getHome(currentContext)).resolves.toEqual({
      currentStore: {
        id: 11,
        name: '望京旗舰店',
        address: '北京市朝阳区望京 SOHO T3 B1',
      },
      account: {
        id: '201',
        storeId: '11',
        balance: 350,
        level: 'gold',
        points: 1280,
        memberCode: 'PC20240601001',
        joinDate: '2024-06-01',
        totalConsume: 3200,
      },
      promotions: [
        expect.objectContaining({
          id: '8',
          actionTarget: 'club_products',
        }),
      ],
      featuredProducts: [
        expect.objectContaining({
          id: '31',
          isHot: true,
        }),
      ],
    });

    expect(clubStoresService.getCurrent).toHaveBeenCalledWith(currentContext);
    expect(clubMemberService.getAccount).toHaveBeenCalledWith(currentContext);
    expect(clubPromotionsService.list).toHaveBeenCalledWith(currentContext);
    expect(clubProductsService.list).toHaveBeenCalledWith(currentContext, {
      featured: true,
    });
  });
});
