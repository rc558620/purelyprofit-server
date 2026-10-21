import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordListService } from './sales-record-list.service';
import { SalesRecordStatsService } from './sales-record-stats.service';
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
    // 非扫码订单（空间会话结账）规格回源：默认无匹配会话
    spaceSession: {
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

  /** 列表 summary 复用 stats 的缓存结果，此处按「当期无数据」默认返回零值 */
  const salesRecordStatsService = {
    getCachedStats: jest.fn(),
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
    prismaService.spaceSession.findMany.mockResolvedValue([]);
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
    salesRecordStatsService.getCachedStats.mockResolvedValue({
      totalRevenue: 0,
      totalProfit: 0,
      orderCount: 0,
      avgOrderValue: 0,
      compareLastPeriod: null,
    });

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
        {
          provide: SalesRecordStatsService,
          useValue: salesRecordStatsService,
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
          // 实付金额：无抵扣的普通订单 = 结算净值 = 营业额
          payableAmount: 37,
          // 收款事件：整单由结账（现金）收取
          paymentEvents: [
            {
              kind: 'checkout_due',
              method: 'cash',
              amount: 37,
              direction: 'in',
            },
          ],
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

  it('list 对纯台位费订单计入营业额与利润（回归：曾因复用件数口径被抹成 0）', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 非餐饮（空间计时）订单：整单只有一条台位费行，1 分钟 = ¥1.64
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 15,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-005',
        totalRevenue: new Prisma.Decimal('164'),
        totalProfit: new Prisma.Decimal('164'),
        totalQuantity: 0,
        paymentMethod: 'wechat',
        calcMode: 'business',
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 107,
            orderId: 15,
            storeId: 18,
            productId: null,
            productName: '台位费 1分钟',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('164'),
            profit: new Prisma.Decimal('164'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          space: { name: 'A02' },
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 台位费是真实营收：营业额 / 利润必须计入（与统计卡、报表、CSV 同口径）
    expect(result.items[0]).toMatchObject({
      totalRevenue: 1.64,
      totalProfit: 1.64,
      // 件数口径不变：台位费按时间计费，不是商品销量
      totalQuantity: 0,
    });
  });

  it('list 对团购券纯台位费订单：按券面金额计收（回归：曾按台位费毛额 ¥98 计收）', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 真实场景：券面（顾客买券实付）¥35.2 买断 ¥98 台位费，差额是门店让利
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 17,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-002',
        totalRevenue: new Prisma.Decimal('6280'),
        totalProfit: new Prisma.Decimal('6280'),
        totalQuantity: 0,
        paymentMethod: 'groupon_voucher',
        calcMode: 'business',
        customerPaymentMethod: 'groupon_voucher',
        voucherCode: '982364500059',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('3520'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 110,
            orderId: 17,
            storeId: 18,
            productId: null,
            productName: '台位费（固定）',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('9800'),
            profit: new Prisma.Decimal('9800'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 111,
            orderId: 17,
            storeId: 18,
            productId: null,
            productName: '预付款',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('3520'),
            profit: new Prisma.Decimal('3520'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A05' },
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 营业额 / 利润 / 实付 = 券面 35.2（台位费由券买断，不再按 ¥98 计收）
    expect(result.items[0]).toMatchObject({
      totalRevenue: 35.2,
      totalProfit: 35.2,
      payableAmount: 35.2,
      totalQuantity: 0,
    });
  });

  it('list 对团购券券面大于实付的订单：券抵按券面全额记，超额按退款展示', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 券面 ¥66 的券，本次只消费 ¥30 台位费（未到 1 小时）：
    // 券只抵 ¥30，营业额记 ¥30；券面 ¥66 全额作为收款，超额 ¥36 结账退款
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 24,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-007',
        totalRevenue: new Prisma.Decimal('3000'),
        totalProfit: new Prisma.Decimal('3000'),
        totalQuantity: 0,
        paymentMethod: 'groupon_voucher',
        calcMode: 'business',
        customerPaymentMethod: 'groupon_voucher',
        voucherCode: '812931375999',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('6600'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 150,
            orderId: 24,
            storeId: 18,
            productId: null,
            productName: '台位费 30分钟',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('3000'),
            profit: new Prisma.Decimal('3000'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A05' },
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 券只按实际消费抵扣：营业额 = 实付 = 30（不是券面 66）
    expect(result.items[0]).toMatchObject({
      totalRevenue: 30,
      totalProfit: 30,
      payableAmount: 30,
    });
    // 收款明细：券抵按券面 66 全额记，超额 36 按退款展示（产品口径：超额 = 退款）
    expect(result.items[0].paymentEvents).toEqual([
      {
        kind: 'voucher_table_fee',
        method: 'groupon_voucher',
        platform: 'chunlibao',
        amount: 66,
        direction: 'in',
      },
      {
        kind: 'checkout_refund',
        method: 'groupon_voucher',
        amount: 36,
        direction: 'out',
      },
    ]);
  });

  it('list 对团购券台位费 + 点单订单：券面 + 点单，利润 = 券面 + 点单毛利', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 18,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-003',
        totalRevenue: new Prisma.Decimal('16880'),
        totalProfit: new Prisma.Decimal('12380'),
        totalQuantity: 2,
        paymentMethod: 'groupon_voucher',
        calcMode: 'business',
        customerPaymentMethod: 'groupon_voucher',
        voucherCode: '846507611403',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('3520'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 112,
            orderId: 18,
            storeId: 18,
            productId: null,
            productName: '台位费（固定）',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('9800'),
            profit: new Prisma.Decimal('9800'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 113,
            orderId: 18,
            storeId: 18,
            productId: 55,
            productName: '香氛泡浴球',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('2800'),
            profit: new Prisma.Decimal('1800'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 114,
            orderId: 18,
            storeId: 18,
            productId: 56,
            productName: '元气唤醒',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('7800'),
            profit: new Prisma.Decimal('4300'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 115,
            orderId: 18,
            storeId: 18,
            productId: null,
            productName: '预付款',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('3520'),
            profit: new Prisma.Decimal('3520'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A04' },
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 营业额 = 券面 35.2 + 点单 106；利润 = 35.2 + 点单毛利 61；件数只算点单 2 件
    expect(result.items[0]).toMatchObject({
      totalRevenue: 141.2,
      totalProfit: 96.2,
      payableAmount: 141.2,
      totalQuantity: 2,
    });
  });

  it('list 对团购券超时订单：超出券预设的台位费由顾客另付并计入实付', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 券预设 1 小时台位费 ¥98，实际用了 2 小时 → 台位费 ¥196，超出 ¥98 由顾客到店另付
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 19,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-005',
        totalRevenue: new Prisma.Decimal('16080'),
        totalProfit: new Prisma.Decimal('16080'),
        totalQuantity: 0,
        paymentMethod: 'groupon_voucher',
        calcMode: 'business',
        customerPaymentMethod: 'groupon_voucher',
        voucherCode: 'OVERTIME001',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('3520'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 116,
            orderId: 19,
            storeId: 18,
            productId: null,
            productName: '台位费 2小时',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('19600'),
            profit: new Prisma.Decimal('19600'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 117,
            orderId: 19,
            storeId: 18,
            productId: null,
            productName: '预付款',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('3520'),
            profit: new Prisma.Decimal('3520'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A05' },
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 券面 35.2 + 超时台位费 98（196 − 98）= 133.2
    expect(result.items[0]).toMatchObject({
      totalRevenue: 133.2,
      totalProfit: 133.2,
      payableAmount: 133.2,
    });
  });

  it('list 对团购券按实际计时订单：券只按实际消费抵扣（回归：曾按券面 35.2 多算）', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 真实场景 #20261020-006：按实际计时只开 2 分钟（台位费 ¥3.27），
    // 券面 ¥35.2 大于本次消费 → 券只抵 ¥3.27，多付的留在券余额
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 23,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-006',
        totalRevenue: new Prisma.Decimal('29127'),
        totalProfit: new Prisma.Decimal('21727'),
        totalQuantity: 2,
        paymentMethod: 'groupon_voucher',
        calcMode: 'business',
        customerPaymentMethod: 'groupon_voucher',
        voucherCode: '812931375365',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('3520'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 140,
            orderId: 23,
            storeId: 18,
            productId: null,
            productName: '台位费 2分钟',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('327'),
            profit: new Prisma.Decimal('327'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 141,
            orderId: 23,
            storeId: 18,
            productId: 55,
            productName: '音钵疗愈',
            categoryName: '服务',
            salePrice: new Prisma.Decimal('15800'),
            profit: new Prisma.Decimal('9800'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 142,
            orderId: 23,
            storeId: 18,
            productId: 56,
            productName: '香薰精油按摩',
            categoryName: '服务',
            salePrice: new Prisma.Decimal('18800'),
            profit: new Prisma.Decimal('9000'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 143,
            orderId: 23,
            storeId: 18,
            productId: null,
            productName: '预付款',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('3520'),
            profit: new Prisma.Decimal('3520'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A05' },
          sessionRenewRecords: [],
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 营业额 = 实付 = 券抵 3.27 + 点单 346 = 349.27；利润 = 3.27 + 点单毛利 188
    expect(result.items[0]).toMatchObject({
      totalRevenue: 349.27,
      totalProfit: 191.27,
      payableAmount: 349.27,
    });
    // 收款明细两段式：券抵台位费按券面 35.2 记，结账 = 实付 349.27 − 35.2 = 314.07（到店补付）
    expect(result.items[0].paymentEvents).toEqual([
      {
        kind: 'voucher_table_fee',
        method: 'groupon_voucher',
        platform: 'chunlibao',
        amount: 35.2,
        direction: 'in',
      },
      {
        kind: 'checkout_due',
        method: 'groupon_voucher',
        amount: 314.07,
        direction: 'in',
      },
    ]);
  });

  it('list 对抵扣超过消费的订单：实付金额按本次消费额记（回归：曾显示 -33.56 / ¥0）', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 真实场景：续费用纯利宝券付了 ¥35.2，本次只消费 ¥1.64 台位费，
    // 结算净值 = 1.64 − 35.2 = −33.56（超额 ¥33.56 在结账时退回顾客）
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 20,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-004',
        totalRevenue: new Prisma.Decimal('-3356'),
        totalProfit: new Prisma.Decimal('-3356'),
        totalQuantity: 0,
        paymentMethod: 'cash',
        calcMode: 'business',
        customerPaymentMethod: null,
        voucherCode: '7346488567489',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('3520'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 118,
            orderId: 20,
            storeId: 18,
            productId: null,
            productName: '台位费 1分钟',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('164'),
            profit: new Prisma.Decimal('164'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 119,
            orderId: 20,
            storeId: 18,
            productId: null,
            productName: '续费抵扣',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('3520'),
            profit: new Prisma.Decimal('3520'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A02' },
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 营业额/利润 = 消费毛额 1.64；实付 = 本次消费额 1.64
    // （券多付的 33.56 在结账时退回顾客，不计入营业额，也不显示为负数）
    expect(result.items[0]).toMatchObject({
      totalRevenue: 1.64,
      totalProfit: 1.64,
      payableAmount: 1.64,
    });
    // 收款明细：开台券 +¥35.2 − 结账退款 ¥33.56 = 实付 1.64
    // （产品口径：超额部分按退款处理）
    expect(result.items[0].paymentEvents).toEqual([
      {
        kind: 'open_voucher',
        method: 'groupon_voucher',
        platform: 'chunlibao',
        amount: 35.2,
        direction: 'in',
      },
      {
        kind: 'checkout_refund',
        method: 'cash',
        amount: 33.56,
        direction: 'out',
      },
    ]);
  });

  it('list 对多次续费订单：按支付方式拆出收款/退款事件，合计 = 实付金额', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 真实场景 #20261020-007：开台券 35.2 + 4 次现金续费 100，
    // 消费 426.87 少于已收 435.2 → 结账按所选方式（现金）退 8.33
    const buildItem = (
      id: number,
      productName: string,
      salePrice: string,
      profit: string,
    ) => ({
      id,
      orderId: 21,
      storeId: 18,
      productId: null,
      productName,
      categoryName: '场地费',
      salePrice: new Prisma.Decimal(salePrice),
      profit: new Prisma.Decimal(profit),
      quantity: 1,
      image: null,
      createdAt,
    });

    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-007',
        totalRevenue: new Prisma.Decimal('-833'),
        totalProfit: new Prisma.Decimal('-19833'),
        totalQuantity: 3,
        paymentMethod: 'cash',
        calcMode: 'business',
        customerPaymentMethod: null,
        voucherCode: '159129028485',
        voucherPlatform: 'chunlibao',
        voucherFaceAmount: new Prisma.Decimal('3520'),
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          buildItem(120, '台位费 14分钟', '2287', '2287'),
          buildItem(121, '会员体验', '19800', '10300'),
          buildItem(122, '疗愈礼盒', '16800', '8800'),
          buildItem(123, '香薰扩香', '3800', '2300'),
          buildItem(124, '续费抵扣', '40000', '40000'),
          buildItem(125, '预付款', '3520', '3520'),
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A05' },
          sessionRenewRecords: [1, 2, 3, 4].map(() => ({
            amount: 10000,
            paymentMethod: 'cash',
            voucherFaceAmount: null,
          })),
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 营业额 / 利润 = 消费毛额 426.87；实付同口径
    expect(result.items[0]).toMatchObject({
      totalRevenue: 426.87,
      totalProfit: 236.87,
      payableAmount: 426.87,
    });
    // 收款事件：开台券 35.2 + 续费（现金）400 − 退款（现金）8.33 = 426.87
    expect(result.items[0].paymentEvents).toEqual([
      {
        kind: 'open_voucher',
        method: 'groupon_voucher',
        platform: 'chunlibao',
        amount: 35.2,
        direction: 'in',
      },
      { kind: 'renew', method: 'cash', amount: 400, direction: 'in' },
      {
        kind: 'checkout_refund',
        method: 'cash',
        amount: 8.33,
        direction: 'out',
      },
    ]);
  });

  it('list 对多次续费且方式不同时：续费按支付方式分多行', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    // 2 次现金 + 2 次微信续费，消费大于已收 → 结账补差
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 22,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20261020-008',
        totalRevenue: new Prisma.Decimal('30000'),
        totalProfit: new Prisma.Decimal('15000'),
        totalQuantity: 1,
        paymentMethod: 'wechat',
        calcMode: 'business',
        customerPaymentMethod: null,
        voucherFaceAmount: null,
        note: null,
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        scanOrderId: null,
        items: [
          {
            id: 130,
            orderId: 22,
            storeId: 18,
            productId: null,
            productName: '台位费 30分钟',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('4900'),
            profit: new Prisma.Decimal('4900'),
            quantity: 1,
            image: null,
            createdAt,
          },
        ],
        spaceSession: {
          hourlyRate: 9800,
          space: { name: 'A03' },
          sessionRenewRecords: [
            { amount: 10000, paymentMethod: 'cash', voucherFaceAmount: null },
            { amount: 10000, paymentMethod: 'cash', voucherFaceAmount: null },
            { amount: 10000, paymentMethod: 'wechat', voucherFaceAmount: null },
            { amount: 10000, paymentMethod: 'wechat', voucherFaceAmount: null },
          ],
        },
      },
    ]);

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 消费 49，已收 400 → 结账（微信）退 351
    expect(result.items[0]).toMatchObject({
      totalRevenue: 49,
      payableAmount: 49,
    });
    expect(result.items[0].paymentEvents).toEqual([
      { kind: 'renew', method: 'cash', amount: 200, direction: 'in' },
      { kind: 'renew', method: 'wechat', amount: 200, direction: 'in' },
      {
        kind: 'checkout_refund',
        method: 'wechat',
        amount: 351,
        direction: 'out',
      },
    ]);
  });

  it('list 对台位费 + 商品混合订单：金额含台位费、件数只算商品', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 16,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-006',
        totalRevenue: new Prisma.Decimal('7000'),
        totalProfit: new Prisma.Decimal('6300'),
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
            id: 108,
            orderId: 16,
            storeId: 18,
            productId: null,
            productName: '台位费（固定）',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('5800'),
            profit: new Prisma.Decimal('5800'),
            quantity: 1,
            image: null,
            createdAt,
          },
          {
            id: 109,
            orderId: 16,
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

    const result = await service.list(user, { storeId: 18, period: 'all' });

    // 营业额 = 台位费 58 + 绿茶 12；利润 = 58 + 5；件数只算绿茶 1 件
    expect(result.items[0]).toMatchObject({
      totalRevenue: 70,
      totalProfit: 63,
      totalQuantity: 1,
    });
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
          // 实付金额：无抵扣的普通订单 = 结算净值 = 营业额
          payableAmount: 37,
          // 收款事件：整单由结账（现金）收取
          paymentEvents: [
            {
              kind: 'checkout_due',
              method: 'cash',
              amount: 37,
              direction: 'in',
            },
          ],
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

  it('list 的 summary 取自 stats 缓存，不再执行全店范围聚合', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([]);
    prismaService.saleOrder.count.mockResolvedValue(0);
    salesRecordStatsService.getCachedStats.mockResolvedValue({
      totalRevenue: 128,
      totalProfit: 36,
      orderCount: 4,
      avgOrderValue: 32,
      compareLastPeriod: 12.5,
    });

    const result = await service.list(user, { storeId: 18, period: 'month' });

    // 金额与客单价透传 stats 结果；列表不展示环比，固定为 null
    expect(result.summary).toEqual({
      totalRevenue: 128,
      totalProfit: 36,
      orderCount: 4,
      avgOrderValue: 32,
      compareLastPeriod: null,
    });
    // 子账号作用域按主账号 owner 解析进入（本用户 subjectType 为 owner）
    expect(salesRecordStatsService.getCachedStats).toHaveBeenCalledWith(
      18,
      expect.objectContaining({ storeId: 18, period: 'month' }),
      false,
    );
    // $queryRaw 是 aggregateOrderStats 的专用通道：列表侧不得再触发
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });
});
