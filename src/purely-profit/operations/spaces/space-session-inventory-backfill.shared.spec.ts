import type { Prisma } from '@prisma/client';
import { backfillSpaceAddItemInventoryLogs } from './space-session-inventory-backfill.shared';

/**
 * 结账回填库存流水单号。
 *
 * 守三条：
 * 1. 必须用 relatedSpaceSessionId 等值定位（否则 `sale_order_id IS NULL` 会扫全库未回填流水）；
 * 2. 必须带 `saleOrderId: null` 前置条件（重复结账 / 重试不得改写已回填的单号）；
 * 3. 不得再依赖 note 文案 —— 文案变更曾经会静默漏回填，造成「钱已收、流水没挂单」。
 */
describe('backfillSpaceAddItemInventoryLogs', () => {
  const updateMany = jest.fn();
  const tx = {
    inventoryAdjustmentLog: { updateMany },
  } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.clearAllMocks();
    updateMany.mockResolvedValue({ count: 2 });
  });

  it('按会话 ID 等值回填，并带上幂等前置条件', async () => {
    const count = await backfillSpaceAddItemInventoryLogs(tx, {
      storeId: 18,
      sessionId: 9,
      saleOrderId: 66,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        adjustType: 'sale',
        saleOrderId: null,
        relatedSpaceSessionId: 9,
      },
      data: { saleOrderId: 66 },
    });
    expect(count).toBe(2);
  });

  it('where 里不出现 note，避免回填依赖文案', async () => {
    await backfillSpaceAddItemInventoryLogs(tx, {
      storeId: 18,
      sessionId: 9,
      saleOrderId: 66,
    });

    const args = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).not.toHaveProperty('note');
  });

  it('没有待回填流水时返回 0，不抛错', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      backfillSpaceAddItemInventoryLogs(tx, {
        storeId: 18,
        sessionId: 9,
        saleOrderId: 66,
      }),
    ).resolves.toBe(0);
  });

  it('已回填过的流水不会被再次改写（幂等条件由 saleOrderId: null 保证）', async () => {
    // 第二次调用时该会话的流水 saleOrderId 已非 NULL，UPDATE 命中 0 行
    updateMany.mockResolvedValue({ count: 0 });

    const count = await backfillSpaceAddItemInventoryLogs(tx, {
      storeId: 18,
      sessionId: 9,
      saleOrderId: 66,
    });

    expect(count).toBe(0);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ saleOrderId: null }),
      }),
    );
  });
});
