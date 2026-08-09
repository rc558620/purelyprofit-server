// ClubOrderPreviewService 价格预览回归测试：活动优惠按数量、满减订单级单次
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderPreviewBreakdownService } from './club-order-preview-breakdown.service';
import { ClubOrderPreviewService } from './club-order-preview.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';

describe('ClubOrderPreviewService', () => {
  let service: ClubOrderPreviewService;

  const prismaService = {
    marketingCustomer: {
      findUnique: jest.fn(),
    },
    marketingMemberLevelSetting: {
      findUnique: jest.fn(),
    },
  };

  const clubOrderServiceContextService = {
    resolveCreateServiceOrderContext: jest.fn(),
  };

  const clubOrderPromotionsService = {
    resolvePricing: jest.fn(),
    resolveOrderReduceFen: jest.fn(),
    resolveMemberDiscountRate: jest.fn().mockResolvedValue(null),
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
      businessMode: 'general' as const,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // 默认余额充足（¥1000），余额不足场景单独覆盖
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      balance: 100000,
    });
    clubOrderServiceContextService.resolveCreateServiceOrderContext.mockResolvedValue(
      {
        store: { id: 11, name: '望京旗舰店' },
        customer: { id: 36 },
        product: {
          id: 18,
          name: '黄金焕肤疗程',
          price: 10000,
          originalPrice: 10000,
          image: null,
          stock: 20,
        },
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubOrderPreviewService,
        ClubOrderPreviewBreakdownService,
        {
          provide: ClubOrderServiceContextService,
          useValue: clubOrderServiceContextService,
        },
        {
          provide: ClubOrderPromotionsService,
          useValue: clubOrderPromotionsService,
        },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubOrderPreviewService>(ClubOrderPreviewService);
  });

  it('previewServiceOrder 数量>1 仅满减时：满减明细不乘数量、总节省勾稽闭合', async () => {
    // 单价 ¥100、数量 3、满 ¥200 减 ¥20、无活动折扣
    clubOrderPromotionsService.resolvePricing.mockResolvedValue({
      amountFen: 10000,
      memberBaselineFen: 10000,
      discountAmountFen: 0,
      promotionId: null,
      promotionType: null,
      discountRate: null,
      promotionTag: null,
      promotionDiscountAmountFen: 0,
      totalReduceFen: 0,
      amountFenBeforeReduce: 10000,
    });
    clubOrderPromotionsService.resolveOrderReduceFen.mockResolvedValue(2000);

    const result = await service.previewServiceOrder(currentContext, {
      storeId: 11,
      productId: 18,
      quantity: 3,
    });

    expect(result.finalPrice).toBe(280);
    expect(result.reduceAmount).toBe(20);
    expect(result.totalSavingAmount).toBe(20);
    // 余额充足：由后端判断并返回结果与文案，前端仅展示
    expect(result.balanceEnough).toBe(true);
    expect(result.insufficientBalanceMessage).toBeNull();
    const reduceItem = result.breakdownItems.find(
      (item) => item.id === 'reduce',
    );
    // 修复前为 -¥60（2000 × 3），满减为订单级单次优惠不应乘数量
    expect(reduceItem?.value).toBe('-¥20');
    const priceBeforePoints = result.breakdownItems.find(
      (item) => item.id === 'price-before-points',
    );
    expect(priceBeforePoints?.value).toBe('¥280');
  });

  it('previewServiceOrder 数量>1 活动+满减时：活动按数量、满减单次、明细勾稽闭合', async () => {
    // 单价 ¥100、数量 3、活动 7 折（单件优惠 ¥30）、满 ¥200 减 ¥20
    clubOrderPromotionsService.resolvePricing.mockResolvedValue({
      amountFen: 7000,
      memberBaselineFen: 10000,
      discountAmountFen: 3000,
      promotionId: 5,
      promotionType: 'discount',
      discountRate: 70,
      promotionTag: '限时 7 折',
      promotionDiscountAmountFen: 3000,
      totalReduceFen: 0,
      amountFenBeforeReduce: 7000,
    });
    clubOrderPromotionsService.resolveOrderReduceFen.mockResolvedValue(2000);

    const result = await service.previewServiceOrder(currentContext, {
      storeId: 11,
      productId: 18,
      quantity: 3,
    });

    // 原价 300 - 活动优惠 90 - 满减 20 = 应付 190
    expect(result.finalPrice).toBe(190);
    expect(result.reduceAmount).toBe(20);
    expect(result.totalSavingAmount).toBe(110);
    expect(result.balanceEnough).toBe(true);
    expect(result.insufficientBalanceMessage).toBeNull();
    const promotionItem = result.breakdownItems.find((item) =>
      item.id.startsWith('promotion-'),
    );
    expect(promotionItem?.value).toBe('-¥90');
    const reduceItem = result.breakdownItems.find(
      (item) => item.id === 'reduce',
    );
    expect(reduceItem?.value).toBe('-¥20');
  });

  it('previewServiceOrder 余额不足时返回后端拼装的完整提示文案', async () => {
    // 单价 ¥100、数量 3、仅满减：应付 280；余额 0
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      balance: 0,
    });
    clubOrderPromotionsService.resolvePricing.mockResolvedValue({
      amountFen: 10000,
      memberBaselineFen: 10000,
      discountAmountFen: 0,
      promotionId: null,
      promotionType: null,
      discountRate: null,
      promotionTag: null,
      promotionDiscountAmountFen: 0,
      totalReduceFen: 0,
      amountFenBeforeReduce: 10000,
    });
    clubOrderPromotionsService.resolveOrderReduceFen.mockResolvedValue(2000);

    const result = await service.previewServiceOrder(currentContext, {
      storeId: 11,
      productId: 18,
      quantity: 3,
    });

    expect(result.balanceEnough).toBe(false);
    // 文案含当前余额与需支付金额，全部由后端拼装
    expect(result.insufficientBalanceMessage).toBe(
      '当前余额 ¥0.00，本次需支付 ¥280.00，请先充值',
    );
  });
});
