import { SpaceBillingMode, SpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ProductSpecPricingService } from '../../../goods/products/product-spec-pricing.service';
import { SpaceSessionWriteService } from '../space-session-write.service';
import { mergeSessionItems } from '../space-session-items.shared';
import type { SpaceSessionItemRecord } from '../space-sessions.types';
import { createSpaceTestUser } from '../space-session.spec-helpers';

// ─── mergeSessionItems：规格维度合并键 ────────────────────────────────────
const row = (
  overrides: Partial<SpaceSessionItemRecord> = {},
): SpaceSessionItemRecord => ({
  productId: '297',
  productName: '可乐',
  categoryName: '饮品',
  salePrice: 10,
  profit: 6,
  quantity: 1,
  lineTotal: 10,
  ...overrides,
});

describe('mergeSessionItems（规格维度）', () => {
  it('同商品、同价、不同规格 → 不合并，保持两行', () => {
    const merged = mergeSessionItems(
      [row({ specSignature: 'sig-large' })],
      [row({ specSignature: 'sig-small' })],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.specSignature)).toEqual([
      'sig-large',
      'sig-small',
    ]);
  });

  it('同商品、同价、同规格 → 合并数量', () => {
    const merged = mergeSessionItems(
      [row({ specSignature: 'sig-large' })],
      [row({ specSignature: 'sig-large' })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });

  it('无规格行（specSignature 缺失或 null）仍然按旧口径合并', () => {
    const merged = mergeSessionItems([row()], [row()]);

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });
});

// ─── SpaceSessionWriteService：服务端权威定价 + 规格落库 ──────────────────
describe('SpaceSessionWriteService 规格落库', () => {
  const user: AuthenticatedUser = createSpaceTestUser();

  const buildTransaction = () => ({
    $queryRaw: jest.fn(),
    spaceSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    spaceSessionItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    spaceSessionRenewRecord: { create: jest.fn() },
  });

  const buildSession = (sessionItems: unknown[]) => ({
    id: 9,
    storeId: 18,
    spaceId: 7,
    reservationId: null,
    guestName: '张三',
    guestPhone: '13800138000',
    guestCount: 2,
    startTime: new Date('2026-06-07T10:00:00.000Z'),
    endTime: null,
    billingMode: SpaceBillingMode.mixed,
    hourlyRate: 6800,
    timeCost: null,
    countdownMinutes: null,
    autoCheckout: false,
    prepaidPaymentMethod: null,
    prepaidCustomerPaymentMethod: null,
    prepaidSettlementChannel: null,
    prepaidGrouponCode: null,
    prepaidGrouponPlatform: null,
    prepaidVoucherCode: null,
    prepaidVoucherPlatform: null,
    prepaidNote: null,
    prepaidAmount: null,
    prepaidVoucherFaceAmount: null,
    sessionItems,
    itemsCost: 0,
    commissionAssignments: null,
    sessionRenewRecords: [],
    status: SpaceSessionStatus.active,
    saleOrderId: null,
    createdAt: new Date('2026-06-07T10:00:00.000Z'),
    updatedAt: new Date('2026-06-07T10:00:00.000Z'),
    space: { id: 7, name: 'A01', type: { name: '台球桌' } },
  });

  const setup = () => {
    const transaction = buildTransaction();
    const prismaService = {
      spaceSession: { findFirst: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation((callback) =>
          Promise.resolve(callback(transaction)),
        ),
    };
    const specPricingService = { price: jest.fn() };
    const service = new SpaceSessionWriteService(
      prismaService as unknown as PrismaService,
      specPricingService as unknown as ProductSpecPricingService,
    );
    const deps = {
      ensureCanAccessStore: jest.fn().mockResolvedValue(undefined),
      findOperatorStaffIdForStore: jest.fn().mockResolvedValue(8),
    };

    prismaService.spaceSession.findFirst.mockResolvedValue({
      id: 9,
      storeId: 18,
    });
    transaction.spaceSession.findUnique.mockResolvedValue(buildSession([]));
    transaction.spaceSession.update.mockImplementation(({ data }) =>
      buildSessionWithItems(data),
    );

    return { service, transaction, prismaService, specPricingService, deps };
  };

  /** update 返回体需带上 createMany 写入的行，供 toSpaceSessionResponse 映射 */
  const buildSessionWithItems = (data: { itemsCost?: number }) => ({
    ...buildSession([]),
    itemsCost: data.itemsCost ?? 0,
  });

  it('数字商品 ID + 规格：以服务端定价覆盖前端传值，并落 specSignature / specNames', async () => {
    const { service, transaction, specPricingService, deps } = setup();
    specPricingService.price.mockResolvedValue({
      menuProductId: 77,
      unitPriceCents: 1200,
      costPriceCents: 300,
      profitCents: 900,
      specOptionIds: [11],
      specNames: ['大杯'],
      specSignature: 'sig-large',
      displayName: '可乐（大杯）',
    });

    await service.addItemsToSession(
      user,
      9,
      {
        items: [
          {
            productId: '297',
            productName: '可乐',
            categoryName: '饮品',
            // 前端传的价格与利润故意写错，验证服务端权威覆盖
            salePrice: 1,
            profit: 1,
            quantity: 2,
            specOptionIds: [11],
          },
        ],
      },
      deps,
    );

    expect(specPricingService.price).toHaveBeenCalledWith({
      storeId: 18,
      productId: 297,
      specOptionIds: [11],
    });

    const createManyArg = transaction.spaceSessionItem.createMany.mock
      .calls[0][0] as { data: Record<string, unknown>[] };
    expect(createManyArg.data).toEqual([
      expect.objectContaining({
        productId: '297',
        productName: '可乐（大杯）',
        salePrice: 1200,
        profit: 900,
        quantity: 2,
        specSignature: 'sig-large',
        specNames: ['大杯'],
      }),
    ]);
  });

  it('虚拟商品行（manual_ / SYS_）不走定价服务，沿用前端传值', async () => {
    const { service, transaction, specPricingService, deps } = setup();

    await service.addItemsToSession(
      user,
      9,
      {
        items: [
          {
            productId: 'manual_1',
            productName: '手工录入商品',
            categoryName: '其他',
            salePrice: 20,
            profit: 8,
            quantity: 1,
          },
        ],
      },
      deps,
    );

    expect(specPricingService.price).not.toHaveBeenCalled();
    const createManyArg = transaction.spaceSessionItem.createMany.mock
      .calls[0][0] as { data: Record<string, unknown>[] };
    expect(createManyArg.data).toEqual([
      expect.objectContaining({
        productId: 'manual_1',
        productName: '手工录入商品',
        salePrice: 2000,
        profit: 800,
        specSignature: null,
      }),
    ]);
  });

  it('带规格但商品不可定价时直接抛错，不静默丢规格', async () => {
    const { service, specPricingService, deps } = setup();
    specPricingService.price.mockRejectedValue(
      new Error('商品规格已更新，请重新选择'),
    );

    await expect(
      service.addItemsToSession(
        user,
        9,
        {
          items: [
            {
              productId: '297',
              productName: '可乐',
              categoryName: '饮品',
              salePrice: 10,
              profit: 6,
              quantity: 1,
              specOptionIds: [11],
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('商品规格已更新，请重新选择');
  });
});
