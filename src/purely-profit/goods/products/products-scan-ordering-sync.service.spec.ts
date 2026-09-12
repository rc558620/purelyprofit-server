import { ProductsScanOrderingSyncService } from './products-scan-ordering-sync.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RedisService } from '../../../redis/redis.service';

/**
 * 规格同步测试聚焦「无变更则不重建」：
 * 规格组/选项是物理删除后重建，选项 ID 会漂移，
 * 历史订单退款按 specOptionId 恢复规格库存时若 ID 已变就会静默丢失（风险 #5）。
 */
describe('ProductsScanOrderingSyncService.syncSpecifications', () => {
  const MENU_PRODUCT_ID = 77;

  /** 待写入的规格（前端 DTO 形态，priceDelta 单位为元） */
  const buildGroups = (priceDelta = 2) => [
    {
      id: '1',
      name: '杯型',
      selectMode: 'single' as const,
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        {
          id: '11',
          name: '大杯',
          priceDelta,
          isDefault: false,
          isActive: true,
        },
      ],
    },
  ];

  /** 库里已存在的规格（extraPrice 单位为分） */
  const buildCurrentGroups = (extraPrice = 200) => [
    {
      name: '杯型',
      selectionType: 'single',
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 0,
      options: [
        {
          name: '大杯',
          extraPrice,
          isDefault: false,
          isActive: true,
          sortOrder: 0,
        },
      ],
    },
  ];

  const tx = {
    scanOrderingSpecGroup: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    scanOrderingSpecOption: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const prisma = {
    scanOrderingMenuProduct: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    product: { findUnique: jest.fn() },
    scanOrderingMenuCategory: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const redis = { del: jest.fn() };

  const service = new ProductsScanOrderingSyncService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  const sync = (groups: ReturnType<typeof buildGroups>) =>
    service.syncSpecifications(18, 297, groups);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scanOrderingMenuProduct.findFirst.mockResolvedValue({
      id: MENU_PRODUCT_ID,
    });
    prisma.$transaction.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    redis.del.mockResolvedValue(1);
  });

  it('内容完全一致时不重建：不执行任何 delete/create', async () => {
    // 第一次 findMany 取库里现有规格；无变更时不会再走后续的 createMany
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce(
      buildCurrentGroups(200),
    );

    await sync(buildGroups(2));

    expect(tx.scanOrderingSpecOption.deleteMany).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.deleteMany).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.createMany).not.toHaveBeenCalled();
  });

  it('加价变化时会重建（选项 ID 允许漂移，因为内容确实变了）', async () => {
    tx.scanOrderingSpecGroup.findMany
      .mockResolvedValueOnce(buildCurrentGroups(200))
      .mockResolvedValueOnce([{ id: 101 }]);

    await sync(buildGroups(3));

    expect(tx.scanOrderingSpecOption.deleteMany).toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.deleteMany).toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.createMany).toHaveBeenCalled();
  });

  it('组数变化时会重建', async () => {
    tx.scanOrderingSpecGroup.findMany
      .mockResolvedValueOnce([
        ...buildCurrentGroups(200),
        {
          name: '温度',
          selectionType: 'single',
          minSelections: 1,
          maxSelections: 1,
          sortOrder: 1,
          options: [
            {
              name: '热',
              extraPrice: 0,
              isDefault: false,
              isActive: true,
              sortOrder: 0,
            },
          ],
        },
      ])
      .mockResolvedValueOnce([{ id: 101 }]);

    await sync(buildGroups(2));

    expect(tx.scanOrderingSpecGroup.deleteMany).toHaveBeenCalled();
  });

  it('空规格且商品没有宿主：不创建宿主、不开启事务（Stage 0 空规格短路）', async () => {
    prisma.scanOrderingMenuProduct.findFirst.mockResolvedValue(null);

    await service.syncSpecifications(18, 297, []);

    // 关键：非餐饮门店每次编辑「不配规格」的商品，都不得凭空生成幽灵宿主
    expect(prisma.scanOrderingMenuProduct.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('空规格但已有宿主：清空规格且不删除宿主', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce(
      buildCurrentGroups(200),
    );

    await service.syncSpecifications(18, 297, []);

    expect(tx.scanOrderingSpecOption.deleteMany).toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.deleteMany).toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.createMany).not.toHaveBeenCalled();
    // 宿主本身保留（仅作规格容器，删除宿主由 cleanup() 负责）
    expect(prisma.scanOrderingMenuProduct.create).not.toHaveBeenCalled();
  });

  it('选项名变化时会重建', async () => {
    tx.scanOrderingSpecGroup.findMany
      .mockResolvedValueOnce([
        {
          ...buildCurrentGroups(200)[0],
          options: [
            {
              name: '中杯',
              extraPrice: 200,
              isDefault: false,
              isActive: true,
              sortOrder: 0,
            },
          ],
        },
      ])
      .mockResolvedValueOnce([{ id: 101 }]);

    await sync(buildGroups(2));

    expect(tx.scanOrderingSpecGroup.deleteMany).toHaveBeenCalled();
  });
});
