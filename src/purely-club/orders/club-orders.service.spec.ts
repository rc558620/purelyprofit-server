import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import { ClubOrderServiceCreationService } from './club-order-service-creation.service';
import { ClubOrderServicePaymentService } from './club-order-service-payment.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import { ClubOrderSettlementService } from './club-order-settlement.service';
import { ClubOrdersService } from './club-orders.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';

describe('ClubOrdersService', () => {
  let service: ClubOrdersService;

  const prismaService = {
    $transaction: jest.fn(),
    marketingCustomer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    marketingProduct: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    marketingPromotion: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    marketingConsumption: {
      create: jest.fn(),
      count: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
    },
    marketingMemberLevelSetting: {
      findUnique: jest.fn(),
    },
    marketingPointsRecord: {
      create: jest.fn(),
    },
  };

  const clubMemberProfileService = {
    getSnapshotByStoreAndPhone: jest.fn(),
  };

  const clubMemberLevelsService = {
    resolveCurrentLevelConfig: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string) => {
      const configMap: Record<string, boolean> = {
        'club.manualConfirmPaidEnabled': true,
      };
      return configMap[key];
    }),
  };

  const clubOrderDraftsService = {
    createDraft: jest.fn(),
    getDraft: jest.fn(),
    getDraftByOrderId: jest.fn(),
    markPaid: jest.fn(),
    toOrderStatusResponse: jest.fn(),
    toServiceOrderResponse: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateMarketingOverview: jest.fn(),
  };

  const clubWechatJsapiService = {
    createJsapiPaymentParams: jest.fn(),
  };

  const clubPaymentLockService = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
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

  const wechatUser: AuthenticatedUser = {
    id: 301,
    email: 'club_wechat_oOPENID123@purelyprofit.local',
    phone: 'club_wechat:oOPENID123',
    name: '微信昵称',
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

  const wechatCurrentContext: ClubCurrentContext = {
    user: wechatUser,
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
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, boolean> = {
        'club.manualConfirmPaidEnabled': true,
      };
      return configMap[key];
    });
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );
    clubOrderDraftsService.toServiceOrderResponse.mockImplementation(
      (draft) => ({
        id: draft.id,
        orderNo: draft.orderNo,
        orderType: 'service',
        title: draft.title,
        amount: draft.amountFen / 100,
        paymentChannel: 'wechat',
        status: draft.status,
        createdAt: '2026-06-10T12:30:00.000Z',
        expiresAt: '2026-06-10T12:45:00.000Z',
        paidAt: draft.paidAtMs ? '2026-06-10T12:31:00.000Z' : null,
        paymentTransactionId: draft.paymentTransactionId,
        callbackReceivedAt: draft.callbackReceivedAtMs
          ? '2026-06-10T12:31:03.000Z'
          : null,
        paymentConfirmationSource: draft.paymentConfirmationSource,
        statusReason:
          draft.paymentConfirmationSource === 'wechat_callback'
            ? '微信支付回调已确认并完成落账'
            : draft.paymentConfirmationSource === 'manual_confirm_paid'
              ? '开发态 confirm-paid 已兜底确认支付'
              : '待支付，等待微信支付结果',
        productId: String(draft.metadata.productId),
        productName: draft.metadata.productName,
        originalAmount: draft.metadata.originalAmountFen / 100,
        discountAmount: draft.metadata.discountAmountFen / 100,
        promotionId: draft.metadata.promotionId
          ? String(draft.metadata.promotionId)
          : null,
        promotionType: draft.metadata.promotionType,
        discountRate: draft.metadata.discountRate,
        promotionTag: draft.metadata.promotionTag,
        paymentParams: {
          timeStamp: '1773556800',
          nonceStr: 'nonce',
          package: 'prepay_id=club_SV123',
          signType: 'RSA',
          paySign: 'SIGN',
        },
      }),
    );
    clubOrderDraftsService.toOrderStatusResponse.mockReturnValue({
      id: 'SV123',
      orderNo: 'SV123',
      orderType: 'service',
      title: '购买黄金焕肤疗程',
      amount: 499,
      paymentChannel: 'wechat',
      status: 'pending',
      createdAt: '2026-06-10T12:30:00.000Z',
      expiresAt: '2026-06-10T12:45:00.000Z',
      paidAt: null,
      paymentTransactionId: null,
      callbackReceivedAt: null,
      paymentConfirmationSource: null,
      statusReason: '待支付，等待微信支付结果',
    });
    prismaService.marketingConsumption.count.mockResolvedValue(0);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    // 默认无会员折扣
    clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubOrderPromotionsService,
        ClubOrderServiceContextService,
        ClubOrderServiceCreationService,
        ClubOrderServiceQueryService,
        ClubOrderServicePaymentService,
        ClubOrderSettlementService,
        ClubOrdersService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: ClubOrderDraftsService, useValue: clubOrderDraftsService },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
        { provide: ClubWechatJsapiService, useValue: clubWechatJsapiService },
        { provide: ClubPaymentLockService, useValue: clubPaymentLockService },
        {
          provide: ClubMemberProfileService,
          useValue: clubMemberProfileService,
        },
        { provide: ClubMemberLevelsService, useValue: clubMemberLevelsService },
      ],
    }).compile();

    service = module.get<ClubOrdersService>(ClubOrdersService);
  });

  it('createServiceOrder 创建服务购买订单草稿并返回支付参数', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: 'https://cdn.example.com/products/18.png',
      stock: 20,
    });
    clubOrderDraftsService.createDraft.mockResolvedValue(createServiceDraft());

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SV123',
        productId: '18',
        productName: '黄金焕肤疗程',
        amount: 499,
      }),
    );
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        orderType: 'service',
        storeId: 11,
        storeName: '望京旗舰店',
        customerId: 36,
        title: '购买黄金焕肤疗程',
        amountFen: 49900,
        metadata: {
          productId: 18,
          productName: '黄金焕肤疗程',
          originalAmountFen: 68800,
          coverImage: 'https://cdn.example.com/products/18.png',
          memberBaselineFen: 49900,
          promotionId: null,
          promotionType: null,
          discountRate: null,
          discountAmountFen: 0,
          promotionDiscountAmountFen: 0,
          totalReduceFen: 0,
          promotionTag: null,
          pointsDeductFen: 0,
          pointsUsed: 0,
        },
      }),
    );
  });

  it('createServiceOrder 会员 8 折时按折后价创建订单草稿', async () => {
    // 会员快照存在，等级配置 discountRate = 0.8
    clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue({
      memberId: 1,
      storeId: 11,
      balance: 200000,
      level: 'gold',
      points: 0,
      memberCode: 'MC001',
      joinDate: '2026-01-01',
      totalConsume: 100000,
    });
    clubMemberLevelsService.resolveCurrentLevelConfig.mockResolvedValue({
      level: 'gold',
      label: '黄金会员',
      color: '#b7862f',
      bgColor: '#fbf3df',
      requiredConsume: 0,
      discountRate: 0.8,
      benefits: ['8折会员专属价'],
    });

    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: 'https://cdn.example.com/products/18.png',
      stock: 20,
    });

    // 会员折后价 49900 * 0.8 = 39920
    const memberPriceDraft = {
      ...createServiceDraft(),
      amountFen: 39920,
      metadata: {
        ...createServiceDraft().metadata,
        discountAmountFen: 9980,
        promotionDiscountAmountFen: 0,
      },
    };
    clubOrderDraftsService.createDraft.mockResolvedValue(memberPriceDraft);

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'SV123', amount: 399.2 }));
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        amountFen: 39920,
        metadata: expect.objectContaining({
          promotionId: null,
          promotionType: null,
          discountRate: null,
          discountAmountFen: 9980,
          promotionDiscountAmountFen: 0,
          promotionTag: null,
        }),
      }),
    );
  });

  it('createServiceOrder 对微信登录用户使用稳定标识查顾客并走 JSAPI 下单', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      id: 66,
      points: 300,
    });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: 'https://cdn.example.com/products/18.png',
      stock: 20,
    });
    clubWechatJsapiService.createJsapiPaymentParams.mockResolvedValue({
      timeStamp: '1773556800',
      nonceStr: 'wx-nonce',
      package: 'prepay_id=club_SVWX123',
      signType: 'RSA',
      paySign: 'WX-SIGN',
    });
    clubOrderDraftsService.createDraft.mockResolvedValue({
      ...createServiceDraft(),
      id: 'SVWX123',
      orderNo: 'SVWX123',
      userId: 301,
      phone: 'club_wechat:oOPENID123',
      customerId: 66,
      paymentParams: {
        timeStamp: '1773556800',
        nonceStr: 'wx-nonce',
        package: 'prepay_id=club_SVWX123',
        signType: 'RSA',
        paySign: 'WX-SIGN',
      },
    });

    await expect(
      service.createServiceOrder(wechatCurrentContext, {
        storeId: 11,
        productId: 18,
        openid: 'oOPENID123',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SVWX123',
        productId: '18',
        productName: '黄金焕肤疗程',
      }),
    );
    expect(prismaService.marketingCustomer.findUnique).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 11,
          phone: 'club_wechat:oOPENID123',
        },
      },
      select: {
        id: true,
      },
    });
    expect(
      clubWechatJsapiService.createJsapiPaymentParams,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 11,
        description: '购买黄金焕肤疗程',
        amountFen: 49900,
        openid: 'oOPENID123',
      }),
    );
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        user: wechatUser,
        customerId: 66,
        amountFen: 49900,
      }),
    );
  });

  it('createServiceOrder 命中首单优惠时按折后价创建订单草稿', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: 'https://cdn.example.com/products/18.png',
      stock: 20,
    });
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 88,
        name: '首单 7.5 折',
        type: 'first_order_discount',
        params: { discountRate: 75 },
      },
    ]);
    clubOrderDraftsService.createDraft.mockResolvedValue({
      ...createServiceDraft(),
      amountFen: 37425,
      metadata: {
        ...createServiceDraft().metadata,
        promotionId: 88,
        promotionType: 'first_order_discount',
        discountRate: 75,
        discountAmountFen: 12475,
        promotionDiscountAmountFen: 12475,
        promotionTag: '首单 7.5 折',
      },
    });

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        amount: 374.25,
        discountAmount: 124.75,
        promotionId: '88',
        promotionType: 'first_order_discount',
        discountRate: 75,
      }),
    );
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        orderType: 'service',
        storeId: 11,
        storeName: '望京旗舰店',
        customerId: 36,
        title: '购买黄金焕肤疗程',
        amountFen: 37425,
        metadata: expect.objectContaining({
          memberBaselineFen: 49900,
          promotionId: 88,
          promotionType: 'first_order_discount',
          discountRate: 75,
          discountAmountFen: 12475,
          promotionDiscountAmountFen: 12475,
          totalReduceFen: 0,
          promotionTag: '首单 7.5 折',
        }),
      }),
    );
  });

  it('createServiceOrder 活动折扣(7折)优于会员折扣(8折)时覆盖会员折扣', async () => {
    // 会员 8 折
    clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue({
      memberId: 1,
      storeId: 11,
      balance: 200000,
      level: 'gold',
      points: 0,
      memberCode: 'MC001',
      joinDate: '2026-01-01',
      totalConsume: 100000,
    });
    clubMemberLevelsService.resolveCurrentLevelConfig.mockResolvedValue({
      level: 'gold',
      label: '黄金会员',
      color: '#b7862f',
      bgColor: '#fbf3df',
      requiredConsume: 0,
      discountRate: 0.8,
      benefits: ['8折会员专属价'],
    });
    // 活动 7 折，力度更大
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 99,
        name: '限时 7 折',
        type: 'discount',
        params: { discountRate: 70 },
      },
    ]);
    prismaService.marketingConsumption.count.mockResolvedValue(1);

    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: null,
      stock: 5,
    });

    // 活动 7 折: 49900 * 70 / 100 = 34930，优于会员 8 折 39920，取活动价
    const activePriceDraft = {
      ...createServiceDraft(),
      amountFen: 34930,
      metadata: {
        ...createServiceDraft().metadata,
        coverImage: null,
        memberBaselineFen: 39920,
        promotionId: 99,
        promotionType: 'discount' as const,
        discountRate: 70,
        discountAmountFen: 14970,
        promotionDiscountAmountFen: 14970,
        totalReduceFen: 0,
        promotionTag: '限时 7 折',
      },
    };
    clubOrderDraftsService.createDraft.mockResolvedValue(activePriceDraft);

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'SV123' }));
    // 应以活动折扣价 34930 下单，不用会员折扣价
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        amountFen: 34930,
        metadata: expect.objectContaining({
          promotionId: 99,
          promotionType: 'discount',
          discountRate: 70,
        }),
      }),
    );
  });

  it('createServiceOrder 活动折扣(8.5折)不如会员折扣(8折)时沿用会员折扣', async () => {
    // 会员 8 折
    clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue({
      memberId: 1,
      storeId: 11,
      balance: 200000,
      level: 'gold',
      points: 0,
      memberCode: 'MC001',
      joinDate: '2026-01-01',
      totalConsume: 100000,
    });
    clubMemberLevelsService.resolveCurrentLevelConfig.mockResolvedValue({
      level: 'gold',
      label: '黄金会员',
      color: '#b7862f',
      bgColor: '#fbf3df',
      requiredConsume: 0,
      discountRate: 0.8,
      benefits: ['8折会员专属价'],
    });
    // 活动 8.5 折，力度不如会员
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 100,
        name: '限时 8.5 折',
        type: 'discount',
        params: { discountRate: 85 },
      },
    ]);
    prismaService.marketingConsumption.count.mockResolvedValue(1);

    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: null,
      stock: 5,
    });

    // 会员 8 折: 39920，活动 8.5 折: 42415，会员折扣更优，活动不生效
    const memberOnlyDraft = {
      ...createServiceDraft(),
      amountFen: 39920,
      metadata: {
        ...createServiceDraft().metadata,
        coverImage: null,
        memberBaselineFen: 39920,
        discountAmountFen: 9980,
        promotionDiscountAmountFen: 0,
        totalReduceFen: 0,
      },
    };
    clubOrderDraftsService.createDraft.mockResolvedValue(memberOnlyDraft);

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'SV123' }));
    // 不命中活动，以会员折后价下单
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        amountFen: 39920,
        metadata: expect.objectContaining({
          promotionId: null,
          promotionType: null,
        }),
      }),
    );
  });

  it('createServiceOrder 会员 8 折叠加满减优惠时同时扣减', async () => {
    // 会员 8 折
    clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue({
      memberId: 1,
      storeId: 11,
      balance: 200000,
      level: 'gold',
      points: 0,
      memberCode: 'MC001',
      joinDate: '2026-01-01',
      totalConsume: 100000,
    });
    clubMemberLevelsService.resolveCurrentLevelConfig.mockResolvedValue({
      level: 'gold',
      label: '黄金会员',
      color: '#b7862f',
      bgColor: '#fbf3df',
      requiredConsume: 0,
      discountRate: 0.8,
      benefits: ['8折会员专属价'],
    });
    // 满 200 减 30（threshold=20000, reduceAmount=3000）
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 101,
        name: '满200减30',
        type: 'reduce',
        params: { threshold: 20000, reduceAmount: 3000 },
      },
    ]);
    prismaService.marketingConsumption.count.mockResolvedValue(1);

    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: null,
      stock: 5,
    });

    // 会员 8 折: 39920，满减再减 3000 = 36920
    const memberPlusReduceDraft = {
      ...createServiceDraft(),
      amountFen: 36920,
      metadata: {
        ...createServiceDraft().metadata,
        coverImage: null,
        memberBaselineFen: 39920,
        discountAmountFen: 12980,
        promotionDiscountAmountFen: 0,
        totalReduceFen: 3000,
      },
    };
    clubOrderDraftsService.createDraft.mockResolvedValue(memberPlusReduceDraft);

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'SV123' }));
    // 满减叠加会员折扣
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        amountFen: 36920,
        metadata: expect.objectContaining({
          promotionId: null,
          promotionType: null,
          totalReduceFen: 3000,
          memberBaselineFen: 39920,
        }),
      }),
    );
  });

  it('createServiceOrder 在当前门店变化时抛出 BadRequestException', async () => {
    const contextWithDifferentStore: ClubCurrentContext = {
      ...currentContext,
      store: { ...currentContext.store, id: 12 },
    };

    await expect(
      service.createServiceOrder(contextWithDifferentStore, {
        storeId: 11,
        productId: 18,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(clubOrderDraftsService.createDraft).not.toHaveBeenCalled();
  });

  it('createServiceOrder 在商品不存在或库存不足时抛出 NotFoundException', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    prismaService.marketingProduct.findFirst.mockResolvedValue({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      image: null,
      stock: 0,
    });

    await expect(
      service.createServiceOrder(currentContext, {
        storeId: 11,
        productId: 18,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOrderStatus 读取当前用户的服务订单状态', async () => {
    clubOrderDraftsService.getDraft.mockResolvedValue(createServiceDraft());

    await expect(
      service.getOrderStatus(currentContext, 'SV123'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SV123',
        status: 'pending',
      }),
    );
    expect(clubOrderDraftsService.getDraft).toHaveBeenCalledWith(
      user,
      'SV123',
      'service',
    );
  });

  it('confirmOrderPaid 真实写入消费流水并更新顾客累计消费', async () => {
    const draft = createServiceDraft();
    clubOrderDraftsService.getDraft.mockResolvedValue(draft);
    prismaService.marketingCustomer.findFirst.mockResolvedValueOnce({
      id: 36,
      balance: 100000,
      totalSpent: 52000,
    });
    prismaService.marketingProduct.findFirst.mockResolvedValueOnce({
      id: 18,
      stock: 20,
    });
    clubOrderDraftsService.markPaid.mockResolvedValue({
      ...draft,
      status: 'paid',
      paidAtMs: Date.now(),
    });

    await expect(
      service.confirmOrderPaid(currentContext, 'SV123'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SV123',
        productId: '18',
        productName: '黄金焕肤疗程',
      }),
    );
    expect(prismaService.marketingConsumption.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 36,
        amount: 49900,
        balancePaid: 49900,
        pointsDeducted: 0,
        payType: 'balance',
        itemsSummary: '黄金焕肤疗程',
        promotionId: null,
      },
    });
    // BUG-1 修复后使用 updateMany + balance>=amountFen 条件防止并发扣减为负
    expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 36,
        balance: { gte: 49900 },
      },
      data: {
        balance: { decrement: 49900 },
        totalSpent: { increment: 49900 },
        visitCount: { increment: 1 },
        lastVisitAt: expect.any(Date),
        tier: 'silver',
      },
    });
    // BUG-2 修复后使用 stock > 0 条件防止并发库存为负
    expect(prismaService.marketingProduct.updateMany).toHaveBeenCalledWith({
      where: {
        id: 18,
        storeId: 11,
        stock: { gt: 0 },
      },
      data: {
        stock: { decrement: 1 },
      },
    });
    expect(
      cacheInvalidatorService.invalidateMarketingOverview,
    ).toHaveBeenCalledWith(11);
    expect(clubOrderDraftsService.markPaid).toHaveBeenCalledWith(draft, {
      paymentConfirmationSource: 'manual_confirm_paid',
    });
  });

  it('confirmOrderPaid 命中首单优惠时写入活动关联并回写统计', async () => {
    const draft = {
      ...createServiceDraft(),
      amountFen: 37425,
      metadata: {
        ...createServiceDraft().metadata,
        promotionId: 88,
        promotionType: 'first_order_discount' as const,
        discountRate: 75,
        discountAmountFen: 12475,
        promotionDiscountAmountFen: 12475,
        promotionTag: '首单 7.5 折',
      },
    };
    clubOrderDraftsService.getDraft.mockResolvedValue(draft);
    prismaService.marketingCustomer.findFirst.mockResolvedValueOnce({
      id: 36,
      balance: 100000,
      totalSpent: 52000,
    });
    prismaService.marketingProduct.findFirst.mockResolvedValueOnce({
      id: 18,
      stock: 20,
    });
    clubOrderDraftsService.markPaid.mockResolvedValue({
      ...draft,
      status: 'paid',
      paidAtMs: Date.now(),
    });

    await service.confirmOrderPaid(currentContext, 'SV123');

    expect(prismaService.marketingConsumption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 37425,
        promotionId: 88,
      }),
    });
    expect(prismaService.marketingPromotion.updateMany).toHaveBeenCalledWith({
      where: {
        id: 88,
        storeId: 11,
      },
      data: {
        usageCount: { increment: 1 },
        totalDiscount: { increment: 12475 },
      },
    });
  });

  it('confirmOrderPaidByCallback 对微信登录用户订单也能完成消费落账', async () => {
    const draft = {
      ...createServiceDraft(),
      id: 'SVWX123',
      orderNo: 'SVWX123',
      userId: 301,
      phone: 'club_wechat:oOPENID123',
      customerId: 66,
    };
    clubOrderDraftsService.getDraftByOrderId.mockResolvedValue(draft);
    prismaService.marketingCustomer.findFirst.mockResolvedValueOnce({
      id: 66,
      balance: 90000,
      totalSpent: 120000,
    });
    prismaService.marketingProduct.findFirst.mockResolvedValueOnce({
      id: 18,
      stock: 12,
    });
    clubOrderDraftsService.markPaid.mockResolvedValue({
      ...draft,
      status: 'paid',
      paidAtMs: 1773558660000,
      paymentTransactionId: 'wx_txn_wechat_001',
      callbackReceivedAtMs: 1773558663000,
      paymentConfirmationSource: 'wechat_callback',
    });

    await expect(
      service.confirmOrderPaidByCallback('SVWX123', {
        amountFen: 49900,
        transactionId: 'wx_txn_wechat_001',
        paidAtMs: 1773558660000,
        callbackReceivedAtMs: 1773558663000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SVWX123',
        paymentConfirmationSource: 'wechat_callback',
      }),
    );
    expect(prismaService.marketingConsumption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 11,
        customerId: 66,
        amount: 49900,
      }),
    });
    // BUG-1 修复后使用 updateMany + balance>=amountFen 条件防止并发扣减为负
    expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 66,
        balance: { gte: 49900 },
      },
      data: expect.objectContaining({
        balance: { decrement: 49900 },
        totalSpent: { increment: 49900 },
      }),
    });
    expect(clubOrderDraftsService.markPaid).toHaveBeenCalledWith(draft, {
      paymentConfirmationSource: 'wechat_callback',
      paymentTransactionId: 'wx_txn_wechat_001',
      paidAtMs: 1773558660000,
      callbackReceivedAtMs: 1773558663000,
    });
  });

  it('confirmOrderPaid 在关闭开发态兜底时拒绝调用', async () => {
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, boolean> = {
        'club.manualConfirmPaidEnabled': false,
      };
      return configMap[key];
    });

    await expect(
      service.confirmOrderPaid(currentContext, 'SV123'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(clubOrderDraftsService.getDraft).not.toHaveBeenCalled();
  });

  it('confirmOrderPaidByCallback 校验金额后驱动回调落账', async () => {
    const draft = createServiceDraft();
    clubOrderDraftsService.getDraftByOrderId.mockResolvedValue(draft);
    prismaService.marketingCustomer.findFirst.mockResolvedValueOnce({
      id: 36,
      balance: 100000,
      totalSpent: 52000,
    });
    prismaService.marketingProduct.findFirst.mockResolvedValueOnce({
      id: 18,
      stock: 20,
    });
    clubOrderDraftsService.markPaid.mockResolvedValue({
      ...draft,
      status: 'paid',
      paidAtMs: 1773558660000,
      paymentTransactionId: 'wx_txn_002',
      callbackReceivedAtMs: 1773558663000,
      paymentConfirmationSource: 'wechat_callback',
    });

    await expect(
      service.confirmOrderPaidByCallback('SV123', {
        amountFen: 49900,
        transactionId: 'wx_txn_002',
        paidAtMs: 1773558660000,
        callbackReceivedAtMs: 1773558663000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SV123',
        paymentConfirmationSource: 'wechat_callback',
      }),
    );
    expect(clubOrderDraftsService.getDraftByOrderId).toHaveBeenCalledWith(
      'SV123',
      'service',
    );
  });

  it('confirmOrderPaidByCallback 在金额不一致时抛出 BadRequestException', async () => {
    clubOrderDraftsService.getDraftByOrderId.mockResolvedValue(
      createServiceDraft(),
    );

    await expect(
      service.confirmOrderPaidByCallback('SV123', {
        amountFen: 49901,
        transactionId: 'wx_txn_002',
        paidAtMs: 1773558660000,
        callbackReceivedAtMs: 1773558663000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirmOrderPaid 对已支付订单直接返回，不重复落账', async () => {
    const draft = {
      ...createServiceDraft(),
      status: 'paid',
      paidAtMs: Date.now(),
    };
    clubOrderDraftsService.getDraft.mockResolvedValue(draft);

    await expect(
      service.confirmOrderPaid(currentContext, 'SV123'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SV123',
      }),
    );
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(clubOrderDraftsService.markPaid).not.toHaveBeenCalled();
  });
});

function createServiceDraft() {
  return {
    id: 'SV123',
    orderNo: 'SV123',
    orderType: 'service' as const,
    status: 'pending' as const,
    storeId: 11,
    storeName: '望京旗舰店',
    userId: 201,
    phone: '13800138000',
    customerId: 36,
    title: '购买黄金焕肤疗程',
    amountFen: 49900,
    paymentChannel: 'wechat' as const,
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 900000,
    paidAtMs: null,
    paymentTransactionId: null,
    callbackReceivedAtMs: null,
    paymentConfirmationSource: null,
    failureReason: null,
    paymentParams: {
      timeStamp: '1773556800',
      nonceStr: 'nonce',
      package: 'prepay_id=club_SV123',
      signType: 'RSA',
      paySign: 'SIGN',
    },
    metadata: {
      productId: 18,
      productName: '黄金焕肤疗程',
      originalAmountFen: 68800,
      coverImage: 'https://cdn.example.com/products/18.png',
      memberBaselineFen: 49900,
      promotionId: null,
      promotionType: null,
      discountRate: null,
      discountAmountFen: 0,
      promotionDiscountAmountFen: 0,
      totalReduceFen: 0,
      promotionTag: null,
      pointsDeductFen: 0,
      pointsUsed: 0,
    },
  };
}
