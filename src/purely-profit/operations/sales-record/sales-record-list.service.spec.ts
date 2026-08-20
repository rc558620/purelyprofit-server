import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordListService } from './sales-record-list.service';
import { getEndOfDay, getStartOfDay } from '../../commerce/commerce.utils';

describe('SalesRecordListService', () => {
  let service: SalesRecordListService;

  const prismaService = {
    $queryRaw: jest.fn(),
    saleOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    scanOrders: {
      findMany: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn(),
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };

  const platformMembershipAccessService = {
    clampHistoryRange: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    jest.clearAllMocks();
    prismaService.$queryRaw.mockResolvedValue([
      { revenue: 0, profit: 0, order_count: BigInt(0) },
    ]);
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number> = {
        'app.defaultPageSize': 20,
        'app.maxPageSize': 100,
      };

      return configMap[key];
    });
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) =>
        Promise.resolve({
          start: range.start,
          end: range.end,
          clamped: false,
          empty: false,
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordListService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<SalesRecordListService>(SalesRecordListService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('list 在无可访问门店时返回空分页', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(
      service.list(user, { storeId: 18, period: 'all' }),
    ).resolves.toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      },
      summary: {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      },
    });

    expect(prismaService.saleOrder.findMany).not.toHaveBeenCalled();
    expect(prismaService.saleOrder.count).not.toHaveBeenCalled();
  });

  it('list 按前端字段返回销售记录分页列表', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('3700'),
        totalProfit: new Prisma.Decimal('1040'),
        totalQuantity: 5,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '晚高峰补录',
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        items: [
          {
            id: 101,
            orderId: 11,
            storeId: 18,
            productId: null,
            productName: '手打柠檬茶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('1850'),
            profit: new Prisma.Decimal('520'),
            quantity: 2,
            image: null,
            createdAt,
          },
        ],
      },
    ]);

    await expect(
      service.list(user, {
        storeId: 18,
        period: 'all',
      }),
    ).resolves.toEqual({
      items: [
        {
          id: '11',
          orderNo: '#20260514-001',
          items: [
            {
              productId: 'manual_101',
              productName: '手打柠檬茶',
              categoryName: '饮品',
              salePrice: 18.5,
              profit: 5.2,
              quantity: 2,
              subtotal: 37,
            },
          ],
          totalRevenue: 37,
          totalProfit: 10.4,
          totalQuantity: 2,
          paymentMethod: 'cash',
          paymentLabel: '现金',
          calcMode: 'business',
          note: '晚高峰补录',
          date: saleDate.getTime(),
          createdAt: createdAt.getTime(),
          refundedAt: null,
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
      summary: {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      },
    });
    expect(prismaService.saleOrder.count).toHaveBeenCalled();
  });

  it('list 对扫码点餐订单返回增强字段（balance 支付 + 规格 + 金额汇总）', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 扫码订单销售单：余额支付（other）+ 两条商品行（数量展开）
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 12,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-002',
        totalRevenue: new Prisma.Decimal('6000'),
        totalProfit: new Prisma.Decimal('1200'),
        totalQuantity: 2,
        paymentMethod: 'other',
        calcMode: 'business',
        note: '扫码点餐订单 SO1001',
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: 1001,
        items: [
          {
            id: 102,
            orderId: 12,
            storeId: 18,
            productId: 51,
            productName: '金牌脆皮鸭',
            categoryName: '热菜',
            salePrice: new Prisma.Decimal('2500'),
            profit: new Prisma.Decimal('500'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 103,
            orderId: 12,
            storeId: 18,
            productId: 52,
            productName: '招牌水煮鱼',
            categoryName: '热菜',
            salePrice: new Prisma.Decimal('3500'),
            profit: new Prisma.Decimal('700'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
      },
    ]);
    // 关联扫码订单：营销快照（优惠清单）+ 两条商品（各带规格）
    prismaService.scanOrders.findMany.mockResolvedValue([
      {
        id: 1001,
        marketingSnapshot: {
          pointsDeductAmount: 500,
          breakdownItems: [
            {
              label: '会员等级折扣 8折',
              amount: -3200,
              isStrikethrough: false,
            },
            {
              label: '满50减8',
              amount: -800,
              isStrikethrough: true,
            },
            {
              label: '已失效优惠',
              amount: -100,
              isStrikethrough: true,
            },
          ],
        },
        itemOriginalAmount: 6000,
        specificationExtraAmount: 0,
        payableAmount: 5600,
        items: [
          {
            productNameSnapshot: '金牌脆皮鸭',
            quantity: 1,
            lineTotalAmount: 9800,
            payableLineAmount: 2500,
            specs: [{ specOptionNameSnapshot: '加辣' }],
          },
          {
            productNameSnapshot: '招牌水煮鱼',
            quantity: 1,
            lineTotalAmount: 9800,
            payableLineAmount: 3500,
            specs: [
              { specOptionNameSnapshot: '不辣' },
              { specOptionNameSnapshot: '加鱼丸' },
            ],
          },
        ],
      },
    ]);

    await expect(
      service.list(user, { storeId: 18, period: 'all' }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: '12',
            paymentMethod: 'balance',
            paymentLabel: '余额',
            items: [
              expect.objectContaining({
                productName: '金牌脆皮鸭',
                specs: ['加辣'],
                originalUnitPrice: 98,
              }),
              expect.objectContaining({
                productName: '招牌水煮鱼',
                specs: ['不辣', '加鱼丸'],
                originalUnitPrice: 98,
              }),
            ],
            amountSummary: {
              itemOriginalAmount: 60,
              specificationExtraAmount: 0,
              totalBeforeDiscount: 60,
              payableAmount: 56,
              discountAmount: 4,
              pointsDeductAmount: 5,
              discountItems: [
                {
                  label: '会员等级折扣 8折',
                  amount: -32,
                  isStrikethrough: false,
                },
                {
                  label: '满50减8',
                  amount: -8,
                  isStrikethrough: true,
                },
                {
                  label: '已失效优惠',
                  amount: -1,
                  isStrikethrough: true,
                },
              ],
            },
          }),
        ],
      }),
    );
    // 断言批量查询按扫码订单 ID 过滤
    expect(prismaService.scanOrders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1001] } },
      }),
    );
  });

  it('list 对扫码订单相同商品+规格叠加数量与金额，不同规格不合并', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 扫码订单销售单：同一商品按数量展开为多行 quantity=1（重庆小面 5+2 行、扬州炒饭 4 行）
    const buildItemRow = (
      id: number,
      productId: number,
      productName: string,
    ) => ({
      id,
      orderId: 12,
      storeId: 18,
      productId,
      productName,
      categoryName: productName === '扬州炒饭' ? '主食' : '面食',
      salePrice: new Prisma.Decimal(
        productName === '扬州炒饭' ? '1800' : '1500',
      ),
      profit: new Prisma.Decimal(productName === '扬州炒饭' ? '600' : '500'),
      quantity: 1,
      image: null,
      createdAt,
    });
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 12,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-002',
        totalRevenue: new Prisma.Decimal('17700'),
        totalProfit: new Prisma.Decimal('5900'),
        totalQuantity: 11,
        paymentMethod: 'other',
        calcMode: 'business',
        note: '扫码点餐订单 SO1002',
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: 1002,
        items: [
          ...Array.from({ length: 5 }, (_, index) =>
            buildItemRow(201 + index, 51, '重庆小面'),
          ),
          ...Array.from({ length: 2 }, (_, index) =>
            buildItemRow(206 + index, 51, '重庆小面'),
          ),
          ...Array.from({ length: 4 }, (_, index) =>
            buildItemRow(208 + index, 52, '扬州炒饭'),
          ),
        ],
      },
    ]);
    // 关联扫码订单：同一商品多规格行（加辣 5 份、不辣 2 份、扬州炒饭 4 份）
    prismaService.scanOrders.findMany.mockResolvedValue([
      {
        id: 1002,
        marketingSnapshot: { pointsDeductAmount: 0, breakdownItems: [] },
        itemOriginalAmount: 17700,
        specificationExtraAmount: 0,
        payableAmount: 17700,
        items: [
          {
            productNameSnapshot: '重庆小面',
            quantity: 5,
            lineTotalAmount: 7500,
            payableLineAmount: 7500,
            specs: [{ specOptionNameSnapshot: '加辣' }],
          },
          {
            productNameSnapshot: '重庆小面',
            quantity: 2,
            lineTotalAmount: 3000,
            payableLineAmount: 3000,
            specs: [{ specOptionNameSnapshot: '不辣' }],
          },
          {
            productNameSnapshot: '扬州炒饭',
            quantity: 4,
            lineTotalAmount: 7200,
            payableLineAmount: 7200,
            specs: [],
          },
        ],
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });
    expect(result.items[0].items).toEqual([
      {
        productId: '51',
        productName: '重庆小面',
        categoryName: '面食',
        salePrice: 15,
        profit: 5,
        quantity: 5,
        subtotal: 75,
        specs: ['加辣'],
        originalUnitPrice: 15,
      },
      {
        productId: '51',
        productName: '重庆小面',
        categoryName: '面食',
        salePrice: 15,
        profit: 5,
        quantity: 2,
        subtotal: 30,
        specs: ['不辣'],
        originalUnitPrice: 15,
      },
      {
        productId: '52',
        productName: '扬州炒饭',
        categoryName: '主食',
        salePrice: 18,
        profit: 6,
        quantity: 4,
        subtotal: 72,
        originalUnitPrice: 18,
      },
    ]);
    // 金额合计在叠加前后保持不变（总营业额/总利润/总件数）
    expect(result.items[0]).toMatchObject({
      totalRevenue: 177,
      totalProfit: 59,
      totalQuantity: 11,
    });
    // 优惠前总价由后端计算（= 商品基础价 + 规格加价），前端只读展示
    expect(result.items[0].amountSummary).toMatchObject({
      itemOriginalAmount: 177,
      specificationExtraAmount: 0,
      totalBeforeDiscount: 177,
      payableAmount: 177,
      discountAmount: 0,
    });
  });

  it('list 对普通订单不返回增强字段，other 支付方式保持原样', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 13,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-003',
        totalRevenue: new Prisma.Decimal('1000'),
        totalProfit: new Prisma.Decimal('200'),
        totalQuantity: 1,
        paymentMethod: 'other',
        calcMode: 'business',
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 104,
            orderId: 13,
            storeId: 18,
            productId: 53,
            productName: '手写商品',
            categoryName: '其他',
            salePrice: new Prisma.Decimal('1000'),
            profit: new Prisma.Decimal('200'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
      },
    ]);

    await expect(
      service.list(user, { storeId: 18, period: 'all' }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: '13',
            paymentMethod: 'other',
            paymentLabel: '其他',
            items: [
              expect.objectContaining({
                productName: '手写商品',
              }),
            ],
          }),
        ],
      }),
    );
    // 普通订单不应触发扫码订单批量查询（空 ID 集合直接返回）
    expect(prismaService.scanOrders.findMany).not.toHaveBeenCalled();
    // 普通订单响应不含增强字段
    const result = await service.list(user, { storeId: 18, period: 'all' });
    expect(result.items[0]).not.toHaveProperty('amountSummary');
  });

  it('list 对空间台位费商品拼接空间名称前缀（非餐饮账号场景）', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 14,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-004',
        totalRevenue: new Prisma.Decimal('4400'),
        totalProfit: new Prisma.Decimal('4400'),
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 105,
            orderId: 14,
            storeId: 18,
            productId: 54,
            productName: '台位费（固定）',
            categoryName: '台位费',
            salePrice: new Prisma.Decimal('4400'),
            profit: new Prisma.Decimal('4400'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 106,
            orderId: 14,
            storeId: 18,
            productId: 55,
            productName: '绿茶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('1200'),
            profit: new Prisma.Decimal('500'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          space: { name: 'A01' },
        },
      },
    ]);

    await expect(
      service.list(user, { storeId: 18, period: 'all' }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: '14',
            items: [
              expect.objectContaining({
                productName: 'A01 台位费（固定）',
              }),
              // 非台位费商品不受影响
              expect.objectContaining({
                productName: '绿茶',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('listFrontendOrders 默认返回 purelyProfit 前端兼容分页结构', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('3700'),
        totalProfit: new Prisma.Decimal('1040'),
        totalQuantity: 5,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '晚高峰补录',
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        items: [
          {
            id: 101,
            orderId: 11,
            storeId: 18,
            productId: null,
            productName: '手打柠檬茶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('1850'),
            profit: new Prisma.Decimal('520'),
            quantity: 2,
            image: null,
            createdAt,
          },
        ],
      },
    ]);

    await expect(
      service.listFrontendOrders(user, { storeId: 18 }),
    ).resolves.toEqual({
      items: [
        {
          id: '11',
          orderNo: '#20260514-001',
          items: [
            {
              productId: 'manual_101',
              productName: '手打柠檬茶',
              categoryName: '饮品',
              salePrice: 18.5,
              profit: 5.2,
              quantity: 2,
              subtotal: 37,
            },
          ],
          totalRevenue: 37,
          totalProfit: 10.4,
          totalQuantity: 2,
          paymentMethod: 'cash',
          paymentLabel: '现金',
          calcMode: 'business',
          note: '晚高峰补录',
          date: saleDate.getTime(),
          createdAt: createdAt.getTime(),
          refundedAt: null,
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
      summary: {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      },
    });
    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({
            gte: new Date(0),
          }),
        }),
      }),
    );
  });

  it('list 在缺失 period 但传入显式时间范围时应按 custom_range 查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.list(user, {
      storeId: 18,
      rangeStartDate: new Date('2026-01-01T00:00:00.000Z').getTime(),
      rangeEndDate: new Date('2026-05-30T23:59:59.999Z').getTime(),
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
  });

  it('listFrontendOrders 在传入显式时间范围时应按 custom_range 查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.listFrontendOrders(user, {
      storeId: 18,
      rangeStartDate: new Date('2026-01-01T00:00:00.000Z').getTime(),
      rangeEndDate: new Date('2026-05-30T23:59:59.999Z').getTime(),
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
  });

  it('listFrontendOrders 在传入年份时应按 year 查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.listFrontendOrders(user, {
      storeId: 18,
      year: 2026,
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date(2026, 0, 1, 0, 0, 0, 0),
            lte: new Date(2026, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
  });

  it('list 会按会员历史窗口裁剪查询范围', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date('2026-05-08T00:00:00.000Z').getTime(),
      end: new Date('2026-05-14T12:00:00.000Z').getTime(),
      clamped: true,
      empty: false,
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.list(user, { storeId: 18, period: 'all' });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-05-08T00:00:00.000Z'),
            lte: new Date('2026-05-14T12:00:00.000Z'),
          },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-05-08T00:00:00.000Z'),
            lte: new Date('2026-05-14T12:00:00.000Z'),
          },
        }),
      }),
    );
  });
});
