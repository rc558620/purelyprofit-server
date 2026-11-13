import { StoresProfileService } from './stores-profile.service';

describe('StoresProfileService', () => {
  const prisma = {
    store: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    getJson: jest.fn(),
    mgetJson: jest.fn(),
  };

  const createService = (): StoresProfileService =>
    new StoresProfileService(prisma as never, redis as never);

  beforeEach(() => {
    jest.clearAllMocks();
    redis.set.mockResolvedValue(undefined);
    redis.getJson.mockResolvedValue(null);
    redis.mgetJson.mockResolvedValue([]);
  });

  it('DB 有扩展字段时优先返回 DB，不回退 Redis', async () => {
    prisma.store.findUnique.mockResolvedValue({
      profileMetadata: {
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
        storeLogo: 'https://img.test/store.png',
      },
    });

    const service = createService();
    const metadata = await service.readStoreProfileMetadata(9);

    expect(metadata).toEqual({
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      storeLogo: 'https://img.test/store.png',
    });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('DB 未命中时回退 Redis，并回填 DB 与规范化缓存', async () => {
    prisma.store.findUnique.mockResolvedValue(null);
    redis.get.mockResolvedValue(
      JSON.stringify({
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
        storeLogo: 'blob:http://localhost:5173/tmp',
      }),
    );
    redis.set.mockResolvedValue(undefined);
    prisma.store.update.mockResolvedValue({ id: 9 });

    const service = createService();
    const metadata = await service.readStoreProfileMetadata(9);

    expect(metadata).toEqual({
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
    });
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        profileMetadata: {
          storeType: '零售',
          region: ['北京市', '北京市', '朝阳区'],
        },
      },
    });
    expect(redis.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
      }),
      604800,
    );
  });

  it('DB 与 Redis 均未命中时返回空扩展字段', async () => {
    prisma.store.findUnique.mockResolvedValue(null);
    redis.get.mockResolvedValue(null);

    const service = createService();
    const metadata = await service.readStoreProfileMetadata(9);

    expect(metadata).toEqual({
      storeType: '',
      region: [],
    });
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('批量读取时 DB 优先，未命中项回退 Redis', async () => {
    prisma.store.findMany.mockResolvedValue([
      {
        id: 1,
        profileMetadata: { storeType: '零售', region: ['a', 'b', 'c'] },
      },
    ]);
    redis.mgetJson.mockResolvedValue([
      { storeType: '餐饮', region: ['x', 'y', 'z'] },
    ]);

    const service = createService();
    const results = await service.batchReadStoreProfileMetadata([1, 2]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ storeType: '零售', region: ['a', 'b', 'c'] });
    expect(results[1]).toEqual({ storeType: '餐饮', region: ['x', 'y', 'z'] });
  });

  it('持久化时 DB 失败会记录错误但不阻断 Redis 写入', async () => {
    prisma.store.update.mockRejectedValue(new Error('db down'));
    redis.set.mockResolvedValue(undefined);

    const service = createService();
    await expect(
      service.persistStoreProfileMetadata(9, {
        storeType: '零售',
        region: [],
      }),
    ).resolves.toBeUndefined();

    expect(redis.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({ storeType: '零售', region: [] }),
      604800,
    );
  });

  it('持久化时 DB 与 Redis 双写成功', async () => {
    prisma.store.update.mockResolvedValue({ id: 9 });
    redis.set.mockResolvedValue(undefined);

    const service = createService();
    await service.persistStoreProfileMetadata(9, {
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
    });

    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        profileMetadata: {
          storeType: '零售',
          region: ['北京市', '北京市', '朝阳区'],
        },
      },
    });
    expect(redis.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
      }),
      604800,
    );
  });

  it('C 端缓存优先读取命中时不再查 DB', async () => {
    redis.getJson.mockResolvedValue({
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      storeLogo: 'https://img.test/store.png',
    });

    const service = createService();
    const metadata = await service.readStoreProfileMetadataCached(9);

    expect(metadata).toEqual({
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      storeLogo: 'https://img.test/store.png',
    });
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
  });

  it('C 端缓存未命中时回退 DB 并回填缓存', async () => {
    prisma.store.findUnique.mockResolvedValue({
      profileMetadata: { storeType: '零售', region: ['a', 'b', 'c'] },
    });

    const service = createService();
    const metadata = await service.readStoreProfileMetadataCached(9);

    expect(metadata).toEqual({ storeType: '零售', region: ['a', 'b', 'c'] });
    expect(redis.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({ storeType: '零售', region: ['a', 'b', 'c'] }),
      604800,
    );
  });

  it('未配置扩展字段的门店同样缓存空结果，避免每次回源 DB', async () => {
    prisma.store.findUnique.mockResolvedValue(null);
    redis.get.mockResolvedValue(null);

    const service = createService();
    const metadata = await service.readStoreProfileMetadataCached(9);

    expect(metadata).toEqual({ storeType: '', region: [] });
    expect(redis.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({ storeType: '', region: [] }),
      604800,
    );
  });

  it('Redis 读取异常时回退 DB 事实源', async () => {
    redis.getJson.mockRejectedValue(new Error('redis down'));
    prisma.store.findUnique.mockResolvedValue({
      profileMetadata: { storeType: '餐饮', region: ['x', 'y', 'z'] },
    });

    const service = createService();

    await expect(service.readStoreProfileMetadataCached(9)).resolves.toEqual({
      storeType: '餐饮',
      region: ['x', 'y', 'z'],
    });
    expect(prisma.store.findUnique).toHaveBeenCalledTimes(1);
  });
});
