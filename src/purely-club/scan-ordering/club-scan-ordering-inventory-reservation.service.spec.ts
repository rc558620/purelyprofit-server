import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';

const MENU_ROWS = [
  {
    id: 1,
    stockMode: 'limited',
    stockQuantity: 10,
    reservedQuantity: 0,
    version: 1,
    productId: null,
  },
  {
    id: 2,
    stockMode: 'limited',
    stockQuantity: 8,
    reservedQuantity: 1,
    version: 4,
    productId: 101,
  },
];

const ITEMS = [
  { productId: 1, inventoryProductId: null, quantity: 2 },
  { productId: 2, inventoryProductId: 101, quantity: 3 },
];

function createTx() {
  return {
    scanOrderingMenuProduct: {
      findMany: jest
        .fn()
        .mockResolvedValue(MENU_ROWS.map((row) => ({ ...row }))),
      updateMany: jest.fn(),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([{ id: 101, stock: 20 }]),
    },
    $executeRaw: jest.fn().mockResolvedValue(2),
  };
}

function asTransactionClient(
  tx: ReturnType<typeof createTx>,
): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

describe('ClubScanOrderingInventoryReservationService', () => {
  const service = new ClubScanOrderingInventoryReservationService(
    {} as PrismaService,
  );

  it('多个商品合并为一次批量 UPDATE，不再逐条 updateMany', async () => {
    const tx = createTx();

    await service.reserveMenuProductStock(asTransactionClient(tx), ITEMS, 7);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.scanOrderingMenuProduct.updateMany).not.toHaveBeenCalled();
  });

  it('乐观锁影响行数不足时抛冲突，由调用方事务整体回滚', async () => {
    const tx = createTx();
    tx.$executeRaw.mockResolvedValue(1);

    await expect(
      service.reserveMenuProductStock(asTransactionClient(tx), ITEMS, 7),
    ).rejects.toThrow(ConflictException);
  });

  it('库存不足时不发起任何写操作', async () => {
    const tx = createTx();
    tx.scanOrderingMenuProduct.findMany.mockResolvedValue([
      {
        id: 1,
        stockMode: 'limited',
        stockQuantity: 1,
        reservedQuantity: 0,
        version: 1,
        productId: null,
      },
    ]);

    await expect(
      service.reserveMenuProductStock(
        asTransactionClient(tx),
        [{ productId: 1, inventoryProductId: null, quantity: 2 }],
        7,
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('同一商品重复下单合并数量后只预留一次', async () => {
    const tx = createTx();
    tx.$executeRaw.mockResolvedValue(1);

    await service.reserveMenuProductStock(
      asTransactionClient(tx),
      [
        { productId: 1, inventoryProductId: null, quantity: 1 },
        { productId: 1, inventoryProductId: null, quantity: 2 },
      ],
      7,
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('空订单不发起任何写操作', async () => {
    const tx = createTx();

    await service.reserveMenuProductStock(asTransactionClient(tx), [], 7);

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
