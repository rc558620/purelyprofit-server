import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';
import { ClubOrderPromotionsService } from './club-order-promotions.service';

const STORE_ID = 11;
const CUSTOMER_ID = 36;
const BASE_FEN = 10000;

/** 首单 8 折：consumptionCount > 0 时不生效（见 toDiscountCandidate）。 */
const firstOrderPromotion = {
  id: 5,
  name: '新客首单',
  type: 'first_order_discount' as const,
  params: { discountRate: 80 },
};

describe('ClubOrderPromotionsService', () => {
  let service: ClubOrderPromotionsService;

  const prisma = { marketingConsumption: { count: jest.fn() } };
  const clubPromotionRepository = { loadActivePromotions: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    clubPromotionRepository.loadActivePromotions.mockResolvedValue([
      firstOrderPromotion,
    ]);
    prisma.marketingConsumption.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubOrderPromotionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubPromotionRepository, useValue: clubPromotionRepository },
        { provide: ClubMemberProfileService, useValue: {} },
        { provide: ClubMemberLevelsService, useValue: {} },
      ],
    }).compile();
    service = module.get(ClubOrderPromotionsService);
  });

  it('preloadPricingContext 一次加载活动与消费次数', async () => {
    const context = await service.preloadPricingContext(STORE_ID, CUSTOMER_ID);

    expect(clubPromotionRepository.loadActivePromotions).toHaveBeenCalledTimes(
      1,
    );
    expect(prisma.marketingConsumption.count).toHaveBeenCalledTimes(1);
    expect(context).toEqual({
      promotions: [firstOrderPromotion],
      consumptionCount: 0,
    });
  });

  it('传入 context 时不再重复查活动与消费次数（多行复用同一份上下文）', async () => {
    const context = await service.preloadPricingContext(STORE_ID, CUSTOMER_ID);
    jest.clearAllMocks();

    const [first, second] = await Promise.all([
      service.resolvePricing(STORE_ID, CUSTOMER_ID, BASE_FEN, {
        skipReduce: true,
        context,
      }),
      service.resolvePricing(STORE_ID, CUSTOMER_ID, 8800, {
        skipReduce: true,
        context,
      }),
    ]);

    expect(clubPromotionRepository.loadActivePromotions).not.toHaveBeenCalled();
    expect(prisma.marketingConsumption.count).not.toHaveBeenCalled();
    expect(first.amountFen).toBe(8000);
    expect(second.amountFen).toBe(7040);
  });

  it('首单资格按 context 里的消费次数判定（预加载不改变语义）', async () => {
    const firstOrder = await service.resolvePricing(
      STORE_ID,
      CUSTOMER_ID,
      BASE_FEN,
      {
        skipReduce: true,
        context: { promotions: [firstOrderPromotion], consumptionCount: 0 },
      },
    );
    const notFirstOrder = await service.resolvePricing(
      STORE_ID,
      CUSTOMER_ID,
      BASE_FEN,
      {
        skipReduce: true,
        context: { promotions: [firstOrderPromotion], consumptionCount: 1 },
      },
    );

    expect(firstOrder.promotionType).toBe('first_order_discount');
    expect(firstOrder.amountFen).toBe(8000);
    expect(notFirstOrder.promotionType).toBeNull();
    expect(notFirstOrder.amountFen).toBe(BASE_FEN);
  });

  it('未传 context 时自行加载（单行调用方无感知）', async () => {
    const resolution = await service.resolvePricing(
      STORE_ID,
      CUSTOMER_ID,
      BASE_FEN,
      { skipReduce: true },
    );

    expect(clubPromotionRepository.loadActivePromotions).toHaveBeenCalledTimes(
      1,
    );
    expect(prisma.marketingConsumption.count).toHaveBeenCalledTimes(1);
    expect(resolution.amountFen).toBe(8000);
  });

  it('resolveOrderReduceDetail 复用已加载的活动列表', async () => {
    const detail = await service.resolveOrderReduceDetail(STORE_ID, 20000, []);

    expect(clubPromotionRepository.loadActivePromotions).not.toHaveBeenCalled();
    expect(detail.totalReduceFen).toBe(0);
  });
});
