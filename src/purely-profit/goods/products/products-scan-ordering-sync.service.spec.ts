import { ProductsScanOrderingSyncService } from './products-scan-ordering-sync.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RedisService } from '../../../redis/redis.service';

/**
 * 规格同步聚焦「按稳定 ID 增量更新」：
 * 选项 ID 会被历史订单的 scan_order_item_specs.spec_option_id 引用（该表无外键），
 * 物理删除后 ID 漂移会让退款/释放预留按旧 ID 恢复库存时静默丢量。
 */
describe('ProductsScanOrderingSyncService.syncSpecifications', () => {
  const MENU_PRODUCT_ID = 77;
  const GROUP_ID = 101;
  const OPTION_ID = 1001;

  /** 待写入的规格（前端 DTO 形态，priceDelta 单位为元） */
  const buildGroups = (priceDelta = 2) => [
    {
      id: String(GROUP_ID),
      name: '杯型',
      selectMode: 'single' as const,
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        {
          id: String(OPTION_ID),
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
      id: GROUP_ID,
      name: '杯型',
      selectionType: 'single',
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 0,
      options: [
        {
          id: OPTION_ID,
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
    scanOrderingMenuProduct: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    product: { findUnique: jest.fn() },
    scanOrderingMenuCategory: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    scanOrderingSpecGroup: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    scanOrderingSpecOption: {
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    scanOrderItemSpec: { findMany: jest.fn() },
  };

  const prisma = {
    scanOrderingMenuProduct: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const redis = { del: jest.fn(), delByPattern: jest.fn() };

  const service = new ProductsScanOrderingSyncService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  const sync = (groups: ReturnType<typeof buildGroups>) =>
    service.syncSpecifications(18, 297, groups);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.scanOrderingMenuProduct.findFirst.mockResolvedValue({
      id: MENU_PRODUCT_ID,
    });
    prisma.scanOrderingMenuProduct.findFirst.mockResolvedValue({
      id: MENU_PRODUCT_ID,
    });
    prisma.$transaction.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    tx.scanOrderItemSpec.findMany.mockResolvedValue([]);
    redis.del.mockResolvedValue(1);
    redis.delByPattern.mockResolvedValue(1);
  });

  it('内容完全一致时不写库：不执行任何 update/create/delete', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce(
      buildCurrentGroups(200),
    );

    await expect(sync(buildGroups(2))).resolves.toBe(false);

    expect(tx.scanOrderingSpecGroup.update).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.create).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.delete).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecOption.update).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecOption.create).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecOption.delete).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('改加价时原地更新选项：保留 specOptionId 与库存/预留字段', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce(
      buildCurrentGroups(200),
    );

    await expect(sync(buildGroups(3))).resolves.toBe(true);

    expect(tx.scanOrderingSpecOption.update).toHaveBeenCalledWith({
      where: { id: OPTION_ID },
      data: expect.objectContaining({
        extraPrice: 300,
        name: '大杯',
        groupId: GROUP_ID,
      }),
    });
    // 关键：不再删除旧选项，ID 不会漂移
    expect(tx.scanOrderingSpecOption.delete).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecOption.create).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });

  it('新增选项（无 id）时创建，不影响已有选项', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce(
      buildCurrentGroups(200),
    );
    tx.scanOrderingSpecOption.create.mockResolvedValue({ id: 2002 });

    await sync([
      {
        ...buildGroups(2)[0],
        options: [
          ...buildGroups(2)[0].options,
          {
            // 空字符串等价于「未传 id」：新建选项
            id: '',
            name: '超大杯',
            priceDelta: 4,
            isDefault: false,
            isActive: true,
          },
        ],
      },
    ]);

    expect(tx.scanOrderingSpecOption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '超大杯', extraPrice: 400 }),
      select: { id: true },
    });
    expect(tx.scanOrderingSpecOption.update).toHaveBeenCalledTimes(1);
    expect(tx.scanOrderingSpecOption.delete).not.toHaveBeenCalled();
  });

  it('删除无历史引用的选项：物理删除', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce([
      ...buildCurrentGroups(200),
      {
        id: 202,
        name: '温度',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        sortOrder: 1,
        options: [
          {
            id: 2002,
            name: '热',
            extraPrice: 0,
            isDefault: false,
            isActive: true,
            sortOrder: 0,
          },
        ],
      },
    ]);
    tx.scanOrderItemSpec.findMany.mockResolvedValue([]);

    await sync(buildGroups(2));

    expect(tx.scanOrderingSpecOption.delete).toHaveBeenCalledWith({
      where: { id: 2002 },
    });
    expect(tx.scanOrderingSpecGroup.delete).toHaveBeenCalledWith({
      where: { id: 202 },
    });
  });

  it('删除仍有历史订单引用的选项：停用而不是物理删除', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce([
      ...buildCurrentGroups(200),
      {
        id: 202,
        name: '温度',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        sortOrder: 1,
        options: [
          {
            id: 2002,
            name: '热',
            extraPrice: 0,
            isDefault: true,
            isActive: true,
            sortOrder: 0,
          },
        ],
      },
    ]);
    tx.scanOrderItemSpec.findMany.mockResolvedValue([{ specOptionId: 2002 }]);

    await sync(buildGroups(2));

    expect(tx.scanOrderingSpecOption.delete).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecOption.update).toHaveBeenCalledWith({
      where: { id: 2002 },
      data: { isActive: false, isDefault: false },
    });
    // 组内仍有保留选项，组不能删，只能停用
    expect(tx.scanOrderingSpecGroup.delete).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecGroup.update).toHaveBeenCalledWith({
      where: { id: 202 },
      data: { isActive: false },
    });
  });

  it('空规格且商品没有宿主：不创建宿主、不开启事务（Stage 0 空规格短路）', async () => {
    prisma.scanOrderingMenuProduct.findFirst.mockResolvedValue(null);

    await expect(service.syncSpecifications(18, 297, [])).resolves.toBe(false);

    // 关键：非餐饮门店每次编辑「不配规格」的商品，都不得凭空生成幽灵宿主
    expect(tx.scanOrderingMenuProduct.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('空规格但已有宿主：删除无引用规格且不删除宿主', async () => {
    tx.scanOrderingSpecGroup.findMany.mockResolvedValueOnce(
      buildCurrentGroups(200),
    );

    await service.syncSpecifications(18, 297, []);

    expect(tx.scanOrderingSpecOption.delete).toHaveBeenCalledWith({
      where: { id: OPTION_ID },
    });
    expect(tx.scanOrderingSpecGroup.delete).toHaveBeenCalledWith({
      where: { id: GROUP_ID },
    });
    // 宿主本身保留（仅作规格容器，删除宿主由 cleanup() 负责）
    expect(tx.scanOrderingMenuProduct.create).not.toHaveBeenCalled();
  });
});
