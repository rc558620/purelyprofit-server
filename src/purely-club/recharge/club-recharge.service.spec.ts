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
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubRechargeService } from './club-recharge.service';

describe('ClubRechargeService', () => {
  let service: ClubRechargeService;

  const prismaService = {
    $transaction: jest.fn(),
    marketingPromotion: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    marketingCustomer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    marketingRecharge: {
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
    clubOrderDraftsService.toOrderStatusResponse.mockImplementation((draft) => ({
      id: draft.id,
      orderNo: draft.orderNo,
      orderType: 'recharge',
      title: draft.title,
      amount: 500,
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
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubRechargeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: ClubStoresService, useValue: clubStoresService },
        { provide: ClubOrderDraftsService, useValue: clubOrderDraftsService },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
      ],
    }).compile();

    service = module.get<ClubRechargeService>(ClubRechargeService);
  });

  it('listPackages 优先返回当前门店有效充赠活动映射出的套餐', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      createPromotion({
        id: 18,
        name: '储值赠 20%',
        description: '最受欢迎',
        params: { rechargeAmount: 50000, giftRatio: 0.2 },
      }),
      createPromotion({
        id: 17,
        name: '储值赠 50',
        description: '送 ¥50',
        params: { rechargeAmount: 30000, giftAmount: 5000 },
      }),
    ]);

    await expect(service.listPackages(user, {})).resolves.toEqual({
      items: [
        {
          id: '18',
          amount: 500,
          bonusAmount: 100,
          tag: '最受欢迎',
          recommended: true,
        },
        {
          id: '17',
          amount: 300,
          bonusAmount: 50,
          tag: '送 ¥50',
          recommended: false,
        },
      ],
    });
  });

  it('listPackages 在 preview=true 时仅返回前三条套餐', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);

    await expect(service.listPackages(user, { preview: true })).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 'default-100' }),
        expect.objectContaining({ id: 'default-200' }),
        expect.objectContaining({ id: 'default-500' }),
      ],
    });
  });

  it('listPackages 在没有可用活动时回落到默认套餐', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      createPromotion({
        id: 20,
        params: { giftRatio: 0.2 },
      }),
    ]);

    await expect(service.listPackages(user, {})).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 'default-100' }),
        expect.objectContaining({ id: 'default-200' }),
        expect.objectContaining({ id: 'default-500', recommended: true }),
        expect.objectContaining({ id: 'default-1000' }),
        expect.objectContaining({ id: 'default-2000' }),
        expect.objectContaining({ id: 'default-5000' }),
      ],
    });
  });

  it('createOrder 使用套餐创建充值订单草稿并返回支付参数', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      createPromotion({
        id: 18,
        name: '储值赠 20%',
        description: '最受欢迎',
        params: { rechargeAmount: 50000, giftRatio: 0.2 },
      }),
    ]);
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    clubOrderDraftsService.createDraft.mockResolvedValue({
      id: 'RC123',
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'pending',
      storeId: 11,
      storeName: '望京旗舰店',
      userId: 201,
      phone: '13800138000',
      customerId: 36,
      title: '会员充值',
      amountFen: 50000,
      paymentChannel: 'wechat',
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
        package: 'prepay_id=club_RC123',
        signType: 'RSA',
        paySign: 'SIGN',
      },
      metadata: {
        packageId: '18',
        promotionId: 18,
        rechargeAmountFen: 50000,
        bonusAmountFen: 10000,
        customAmountFen: null,
      },
    });

    await expect(
      service.createOrder(user, { storeId: 11, packageId: '18' }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'RC123',
        rechargeAmount: 500,
        bonusAmount: 100,
        packageId: '18',
      }),
    );
    expect(clubOrderDraftsService.createDraft).toHaveBeenCalledWith({
      user,
      orderType: 'recharge',
      storeId: 11,
      storeName: '望京旗舰店',
      customerId: 36,
      title: '会员充值',
      amountFen: 50000,
      metadata: {
        packageId: '18',
        promotionId: 18,
        rechargeAmountFen: 50000,
        bonusAmountFen: 10000,
        customAmountFen: null,
      },
    });
  });

  it('createOrder 支持自定义充值金额', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });
    clubOrderDraftsService.createDraft.mockResolvedValue({
      id: 'RC124',
      orderNo: 'RC124',
      orderType: 'recharge',
      status: 'pending',
      storeId: 11,
      storeName: '望京旗舰店',
      userId: 201,
      phone: '13800138000',
      customerId: 36,
      title: '会员充值',
      amountFen: 26800,
      paymentChannel: 'wechat',
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
        package: 'prepay_id=club_RC124',
        signType: 'RSA',
        paySign: 'SIGN',
      },
      metadata: {
        packageId: null,
        promotionId: null,
        rechargeAmountFen: 26800,
        bonusAmountFen: 0,
        customAmountFen: 26800,
      },
    });

    await expect(
      service.createOrder(user, { storeId: 11, customAmount: 268 }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'RC124',
        rechargeAmount: 268,
        bonusAmount: 0,
        packageId: null,
      }),
    );
  });

  it('createOrder 在 packageId 和 customAmount 同时传入时抛出 BadRequestException', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });

    await expect(
      service.createOrder(user, {
        storeId: 11,
        packageId: 'default-500',
        customAmount: 200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createOrder 在套餐不存在时抛出 NotFoundException', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.marketingCustomer.findUnique.mockResolvedValue({ id: 36 });

    await expect(
      service.createOrder(user, { storeId: 11, packageId: '404' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOrderStatus 返回充值订单状态', async () => {
    clubOrderDraftsService.getDraft.mockResolvedValue({
      id: 'RC123',
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'pending',
      storeId: 11,
      storeName: '望京旗舰店',
      userId: 201,
      phone: '13800138000',
      customerId: 36,
      title: '会员充值',
      amountFen: 50000,
      paymentChannel: 'wechat',
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
        package: 'prepay_id=club_RC123',
        signType: 'RSA',
        paySign: 'SIGN',
      },
      metadata: {
        packageId: '18',
        promotionId: 18,
        rechargeAmountFen: 50000,
        bonusAmountFen: 10000,
        customAmountFen: null,
      },
    });

    await expect(service.getOrderStatus(user, 'RC123')).resolves.toEqual(
      expect.objectContaining({
        id: 'RC123',
        status: 'pending',
      }),
    );
    expect(clubOrderDraftsService.getDraft).toHaveBeenCalledWith(
      user,
      'RC123',
      'recharge',
    );
  });

  it('confirmOrderPaid 真实写入充值流水并更新订单状态', async () => {
    const draft = createRechargeDraft();
    clubOrderDraftsService.getDraft.mockResolvedValue(draft);
    prismaService.marketingCustomer.findFirst.mockResolvedValue({ id: 36 });
    clubOrderDraftsService.markPaid.mockResolvedValue({
      ...draft,
      status: 'paid',
      paidAtMs: Date.now(),
    });

    await expect(service.confirmOrderPaid(user, 'RC123')).resolves.toEqual(
      expect.objectContaining({
        id: 'RC123',
        packageId: '18',
        rechargeAmount: 500,
        bonusAmount: 100,
      }),
    );
    expect(prismaService.marketingRecharge.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 36,
        amount: 50000,
        giftAmount: 10000,
        type: 'recharge',
        promotionId: 18,
        note: 'club充值订单 RC123',
      },
    });
    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 36 },
      data: {
        balance: { increment: 60000 },
      },
    });
    expect(prismaService.marketingPromotion.updateMany).toHaveBeenCalledWith({
      where: { id: 18, storeId: 11 },
      data: { usageCount: { increment: 1 } },
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

    await expect(service.confirmOrderPaid(user, 'RC123')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(clubOrderDraftsService.getDraft).not.toHaveBeenCalled();
  });

  it('confirmOrderPaid 对已支付订单直接返回，不重复落账', async () => {
    const draft = {
      ...createRechargeDraft(),
      status: 'paid',
      paidAtMs: Date.now(),
    };
    clubOrderDraftsService.getDraft.mockResolvedValue(draft);

    await expect(service.confirmOrderPaid(user, 'RC123')).resolves.toEqual(
      expect.objectContaining({
        id: 'RC123',
      }),
    );
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(clubOrderDraftsService.markPaid).not.toHaveBeenCalled();
  });
});

function createPromotion(
  overrides?: Partial<{
    id: number;
    name: string;
    description: string;
    params: unknown;
    createdAt: Date;
  }>,
): {
  id: number;
  name: string;
  description: string;
  params: unknown;
  createdAt: Date;
} {
  return {
    id: 1,
    name: '储值赠 20%',
    description: '充100送20',
    params: { rechargeAmount: 10000, giftRatio: 0.2 },
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createRechargeDraft() {
  return {
    id: 'RC123',
    orderNo: 'RC123',
    orderType: 'recharge' as const,
    status: 'pending' as const,
    storeId: 11,
    storeName: '望京旗舰店',
    userId: 201,
    phone: '13800138000',
    customerId: 36,
    title: '会员充值',
    amountFen: 50000,
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
      package: 'prepay_id=club_RC123',
      signType: 'RSA',
      paySign: 'SIGN',
    },
    metadata: {
      packageId: '18',
      promotionId: 18,
      rechargeAmountFen: 50000,
      bonusAmountFen: 10000,
      customAmountFen: null,
    },
  };
}
