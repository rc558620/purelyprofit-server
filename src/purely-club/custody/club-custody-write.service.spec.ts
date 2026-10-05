// 客存 C 端写服务单测：确认与拒绝的归属校验语义
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustodyCodeService } from '../../shared/custody/custody-code.service';
import { CUSTODY_ORDER_NOT_FOUND_MESSAGE } from '../../purely-profit/operations/custody/custody.constants';
import { ClubCustodyWriteService } from './club-custody-write.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';

const ORDER_ID = 12;
const STORE_ID = 7;
const MEMBER_ID = 101;

const buildContext = (): ClubCurrentContext =>
  ({
    store: { id: STORE_ID, name: '三里屯店' },
    user: { id: 1, phone: '13800000000' },
  }) as unknown as ClubCurrentContext;

/** 写服务在冻结口径下会用到事务与商品行锁，mock 需覆盖这些方法 */
interface PrismaMock {
  custodyOrder: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    findFirstOrThrow: jest.Mock;
    groupBy: jest.Mock;
  };
  product: { findFirst: jest.Mock };
  inventoryAdjustmentLog: { create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
}

const buildService = (
  overrides: {
    draftOrder?: Record<string, unknown> | null;
    updatedCount?: number;
    /** 冻结校验读到的商品行；undefined 表示商品不存在 */
    product?: { name: string; stock: number } | null;
  } = {},
) => {
  const draftOrder =
    overrides.draftOrder === undefined
      ? {
          id: ORDER_ID,
          orderNo: 'CO0001',
          status: 'draft',
          stockMode: 'sold',
          productId: null,
          remainingQty: 1,
        }
      : overrides.draftOrder;
  const prisma: PrismaMock = {
    custodyOrder: {
      findFirst: jest.fn().mockResolvedValue(draftOrder),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: overrides.updatedCount ?? 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(draftOrder),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    product: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.product === undefined ? null : overrides.product,
        ),
    },
    // 客存冻结台账：physical 库存不变，记录可用库存的占用/释放
    inventoryAdjustmentLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    // 单测里不透出真实事务语义，直接把自身当事务客户端传回，保持既有断言成立
    $transaction: jest.fn((fn: (tx: PrismaMock) => unknown) => fn(prisma)),
  };
  const clubCustodyReadService = {
    findMemberId: jest.fn().mockResolvedValue(MEMBER_ID),
  };
  const custodyCodeService = {
    invalidateSummaryCache: jest.fn().mockResolvedValue(undefined),
  };
  const auditLogService = { record: jest.fn() };
  const realtimeService = {
    publishStoreConfirmed: jest.fn(),
    publishStoreRejected: jest.fn(),
  };
  const service = new ClubCustodyWriteService(
    prisma as never,
    clubCustodyReadService as never,
    custodyCodeService as unknown as CustodyCodeService,
    auditLogService as never,
    realtimeService as never,
  );
  return {
    service,
    prisma,
    custodyCodeService,
    realtimeService,
  };
};

describe('ClubCustodyWriteService 确认 / 拒绝授权', () => {
  it('确认存入按「本人 + 本店 + 草稿」定位存单，越权归属无法命中', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.confirmStore(buildContext(), ORDER_ID),
    ).resolves.toEqual(expect.objectContaining({ order: expect.anything() }));

    expect(prisma.custodyOrder.findFirst).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        storeId: STORE_ID,
        memberId: MEMBER_ID,
        deletedAt: null,
        status: 'draft',
      },
    });
  });

  it('确认非本人的草稿存单时按不存在处理，不产生任何写操作', async () => {
    const { service, prisma } = buildService({ draftOrder: null });

    await expect(
      service.confirmStore(buildContext(), ORDER_ID),
    ).rejects.toThrow(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    await expect(
      service.confirmStore(buildContext(), ORDER_ID),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.custodyOrder.updateMany).not.toHaveBeenCalled();
  });

  it('并发下第二次确认落空时抛冲突，不会重复置为在存', async () => {
    const { service } = buildService({ updatedCount: 0 });

    await expect(
      service.confirmStore(buildContext(), ORDER_ID),
    ).rejects.toThrow(ConflictException);
  });

  /*
   * 回归用：draft 不占用冻结额度，冻结只在确认这一刻发生，
   * 若确认时不复核可用库存，多张待确认存单被逐个确认后会超额冻结。
   */
  it('冻结口径确认时复核可用库存，可用库存不足则不置为在存', async () => {
    const { service, prisma } = buildService({
      draftOrder: {
        id: ORDER_ID,
        orderNo: 'CO0001',
        status: 'draft',
        stockMode: 'frozen',
        productId: 5,
        remainingQty: 10,
      },
      product: { name: '茅台', stock: 3 },
    });

    await expect(
      service.confirmStore(buildContext(), ORDER_ID),
    ).rejects.toThrow(/可用库存不足/);
    expect(prisma.custodyOrder.updateMany).not.toHaveBeenCalled();
  });

  /*
   * 冻结台账回归：会员确认这一刻才真正占用可用库存，
   * 此前「存入占用」完全不入 inventory_adjustment_logs，
   * 门店盘点时对不上「为什么这件商品突然不能卖了」。
   */
  it('冻结口径确认存入时写入 custody_freeze 台账，可用库存按寄存量下降', async () => {
    const { service, prisma } = buildService({
      draftOrder: {
        id: ORDER_ID,
        orderNo: 'CO0001',
        status: 'draft',
        stockMode: 'frozen',
        productId: 5,
        productName: '茅台',
        unit: '瓶',
        remainingQty: 2,
      },
      product: { name: '茅台', stock: 10 },
    });

    await service.confirmStore(buildContext(), ORDER_ID);

    expect(prisma.inventoryAdjustmentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: STORE_ID,
          productId: 5,
          productName: '茅台',
          beforeStock: 10,
          afterStock: 8,
          delta: -2,
          adjustType: 'custody_freeze',
        }),
      }),
    );
  });

  it('sold 口径不占库存，确认存入时不写冻结台账', async () => {
    const { service, prisma } = buildService({
      product: { name: '茅台', stock: 10 },
    });

    await service.confirmStore(buildContext(), ORDER_ID);

    expect(prisma.inventoryAdjustmentLog.create).not.toHaveBeenCalled();
  });

  it('冻结口径确认时可用库存充足则正常置为在存', async () => {
    const { service, prisma } = buildService({
      draftOrder: {
        id: ORDER_ID,
        orderNo: 'CO0001',
        status: 'draft',
        stockMode: 'frozen',
        productId: 5,
        remainingQty: 2,
      },
      product: { name: '茅台', stock: 10 },
    });

    await expect(
      service.confirmStore(buildContext(), ORDER_ID),
    ).resolves.toEqual(expect.objectContaining({ order: expect.anything() }));
    expect(prisma.custodyOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        storeId: STORE_ID,
        deletedAt: null,
        status: 'draft',
      },
      data: { status: 'stored' },
    });
  });

  it('拒绝存入同样按归属校验，成功后推送 store_rejected', async () => {
    const { service, prisma, realtimeService } = buildService();

    await expect(
      service.rejectStore(buildContext(), ORDER_ID),
    ).resolves.toEqual({
      success: true,
    });

    expect(prisma.custodyOrder.findFirst).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        storeId: STORE_ID,
        memberId: MEMBER_ID,
        deletedAt: null,
        status: 'draft',
      },
    });
    expect(realtimeService.publishStoreRejected).toHaveBeenCalled();
  });

  it('拒绝非本人的草稿存单时按不存在处理，不产生任何写操作', async () => {
    const { service, prisma } = buildService({ draftOrder: null });

    await expect(service.rejectStore(buildContext(), ORDER_ID)).rejects.toThrow(
      CUSTODY_ORDER_NOT_FOUND_MESSAGE,
    );
    await expect(service.rejectStore(buildContext(), ORDER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.custodyOrder.updateMany).not.toHaveBeenCalled();
  });
});
