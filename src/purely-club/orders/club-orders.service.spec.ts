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
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrdersService } from './club-orders.service';

describe('ClubOrdersService', () => {
  let service: ClubOrdersService;

  const prismaService = {
    $transaction: jest.fn(),
    marketingCustomer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    marketingProduct: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    marketingConsumption: {
      create: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn((key: string) => {
      const configMap: Record<string, boolean> = {
        'club.manualConfirmPaidEnabled': true,
      };
      return configMap[key];
    }),
  };

  const clubStoresService = {
    getCurrent: jest.fn(),
  };

  const clubOrderDraftsService = {
    createDraft: jest.fn(),
    getDraft: jest.fn(),
    markPaid: jest.fn(),
    toOrderStatusResponse: jest.fn(),
    toServiceOrderResponse: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateMarketingOverview: jest.fn(),
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
    clubStoresService.getCurrent.mockResolvedValue({
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      coverImage: 'https://cdn.example.com/store-cover.png',
    });
    clubOrderDraftsService.toServiceOrderResponse.mockImplementation((draft) => ({
      id: draft.id,
      orderNo: draft.orderNo,
      orderType: 'service',
      title: draft.title,
      amount: 499,
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
      productId: '18',
      productName: '黄金焕肤疗程',
      originalAmount: 688,
      paymentParams: {
        timeStamp: '1773556800',
        nonceStr: 'nonce',
        package: 'prepay_id=club_SV123',
        signType: 'RSA',
        paySign: 'SIGN',
      },
    }));
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubOrdersService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: ClubStoresService, useValue: clubStoresService },
        { provide: ClubOrderDraftsService, useValue: clubOrderDraftsService },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
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
      service.createServiceOrder(user, { storeId: 11, productId: 18 }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'SV123',
        productId: '18',
        productName: '黄金焕肤疗程',
        amount: 499,
      }),
    );
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith({
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
      },
    });
  });

  it('createServiceOrder 在当前门店变化时抛出 BadRequestException', async () => {
    await expect(
      service.createServiceOrder(user, { storeId: 12, productId: 18 }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
      service.createServiceOrder(user, { storeId: 11, productId: 18 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOrderStatus 读取当前用户的服务订单状态', async () => {
    clubOrderDraftsService.getDraft.mockResolvedValue(createServiceDraft());

    await expect(service.getOrderStatus(user, 'SV123')).resolves.toEqual(
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

    await expect(service.confirmOrderPaid(user, 'SV123')).resolves.toEqual(
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
        balancePaid: 0,
        pointsDeducted: 0,
        payType: 'wechat',
        itemsSummary: '黄金焕肤疗程',
        promotionId: null,
      },
    });
    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 36 },
      data: {
        totalSpent: { increment: 49900 },
        visitCount: { increment: 1 },
        lastVisitAt: expect.any(Date),
        tier: 'silver',
      },
    });
    expect(prismaService.marketingProduct.updateMany).toHaveBeenCalledWith({
      where: {
        id: 18,
        storeId: 11,
      },
      data: {
        stock: { decrement: 1 },
      },
    });
    expect(cacheInvalidatorService.invalidateMarketingOverview).toHaveBeenCalledWith(11);
    expect(clubOrderDraftsService.markPaid).toHaveBeenCalledWith(draft, {
      paymentConfirmationSource: 'manual_confirm_paid',
    });
  });

  it('confirmOrderPaid 在关闭开发态兜底时拒绝调用', async () => {
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, boolean> = {
        'club.manualConfirmPaidEnabled': false,
      };
      return configMap[key];
    });

    await expect(service.confirmOrderPaid(user, 'SV123')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(clubOrderDraftsService.getDraft).not.toHaveBeenCalled();
  });

  it('confirmOrderPaid 对已支付订单直接返回，不重复落账', async () => {
    const draft = {
      ...createServiceDraft(),
      status: 'paid',
      paidAtMs: Date.now(),
    };
    clubOrderDraftsService.getDraft.mockResolvedValue(draft);

    await expect(service.confirmOrderPaid(user, 'SV123')).resolves.toEqual(
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
    },
  };
}
