import { Test, TestingModule } from '@nestjs/testing';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubMemberService } from '../member/club-member.service';
import { ClubPromotionsService } from '../promotions/club-promotions.service';
import { ClubProductsService } from '../products/club-products.service';
import { RedisReadPrefetchService } from '../../redis/redis-read-prefetch.service';
import { ClubHomeService } from './club-home.service';

/**
 * 3-B-4：一次 `getHome` 只解析一次会员等级配置。
 *
 * 等级列表 / 账户等级 / 商品定价三条分支读的是同一份
 * `marketing_member_level_settings`，必须由 `getHome` 统一解析一次后透传，
 * 且解析失败时三条分支各自降级、互不连坐。
 */
describe('ClubHomeService 等级配置请求级种子', () => {
  let service: ClubHomeService;

  const clubStoresService = { getCurrent: jest.fn() };
  const clubMemberService = {
    getAccount: jest.fn(),
    getLevels: jest.fn(),
    loadLevelSettings: jest.fn(),
  };
  const clubPromotionsService = { list: jest.fn() };
  const clubProductsService = { list: jest.fn() };
  /** 预取容器替身：run 透传任务，start / peekJson 记录调用 */
  const redisReadPrefetch = {
    run: jest.fn((task: () => Promise<unknown>) => task()),
    start: jest.fn(),
    peekJson: jest.fn().mockResolvedValue(undefined),
  };

  const mockStore = { id: 11, name: '望京旗舰店', address: '北京市朝阳区' };
  const mockAccount = { id: '201', storeId: '11', level: 'gold' };

  /** 请求级等级配置种子（原始配置口径，含 enabled 标记） */
  const mockLevelSettings = [
    {
      id: 'gold' as const,
      name: '黄金会员',
      discountRate: 0.9,
      discountRatePct: 90,
      spendThreshold: 0,
      description: '充值即享 9 折优惠',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
  ];

  const currentContext = {
    user: { id: 201, phone: '13800138000' },
    store: { id: 11, businessMode: 'general' },
  } as unknown as ClubCurrentContext;

  const cateringContext = {
    user: { id: 201, phone: '13800138000' },
    store: { id: 11, businessMode: 'catering' },
  } as unknown as ClubCurrentContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    clubStoresService.getCurrent.mockResolvedValue(mockStore);
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubMemberService.getLevels.mockResolvedValue([]);
    clubMemberService.loadLevelSettings.mockResolvedValue(mockLevelSettings);
    clubPromotionsService.list.mockResolvedValue({ items: [] });
    clubProductsService.list.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubHomeService,
        { provide: ClubStoresService, useValue: clubStoresService },
        { provide: ClubMemberService, useValue: clubMemberService },
        { provide: ClubPromotionsService, useValue: clubPromotionsService },
        { provide: ClubProductsService, useValue: clubProductsService },
        { provide: RedisReadPrefetchService, useValue: redisReadPrefetch },
      ],
    }).compile();

    service = module.get<ClubHomeService>(ClubHomeService);
  });

  it('一次加载只解析一次配置，并把同一份种子透传给三条分支', async () => {
    await service.getHome(currentContext);

    expect(clubMemberService.loadLevelSettings).toHaveBeenCalledTimes(1);
    expect(clubMemberService.loadLevelSettings).toHaveBeenCalledWith(
      currentContext.store.id,
    );

    // 三条分支拿到的是同一次解析结果（同一引用），不是各自回源
    const accountSeed = clubMemberService.getAccount.mock.calls[0][1];
    const levelsSeed = clubMemberService.getLevels.mock.calls[0][1];
    const productsSeed = clubProductsService.list.mock.calls[0][2];
    expect(accountSeed).toBe(mockLevelSettings);
    expect(levelsSeed).toBe(accountSeed);
    expect(productsSeed).toBe(accountSeed);
  });

  it('餐饮门店跳过商品查询时仍然只解析一次配置', async () => {
    await service.getHome(cateringContext);

    expect(clubMemberService.loadLevelSettings).toHaveBeenCalledTimes(1);
    expect(clubProductsService.list).not.toHaveBeenCalled();
  });

  it('解析失败时三条分支各自降级，互不连坐', async () => {
    clubMemberService.loadLevelSettings.mockRejectedValue(
      new Error('等级配置表不可用'),
    );

    const result = await service.getHome(currentContext);

    // 降级口径与改动前一致：等级 []、账户 unavailable、商品 []
    expect(result.levelConfigs).toEqual([]);
    expect(result.account).toBeNull();
    expect(result.accountStatus).toBe('unavailable');
    expect(result.featuredProducts).toEqual([]);
    // 非等级配置依赖的分支不受牵连
    expect(result.currentStore).toEqual(mockStore);
    expect(result.promotions).toEqual([]);
    // 配置都没拿到时不应再调用依赖它的下游
    expect(clubMemberService.getAccount).not.toHaveBeenCalled();
    expect(clubMemberService.getLevels).not.toHaveBeenCalled();
    expect(clubProductsService.list).not.toHaveBeenCalled();
  });
});
