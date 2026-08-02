import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
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
    mgetJson: jest.fn(),
  };

  const createService = (): StoresProfileService =>
    new StoresProfileService(prisma as never, redis as never);

  beforeEach(() => {
    jest.clearAllMocks();
    redis.set.mockResolvedValue(undefined);
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
      { id: 1, profileMetadata: { storeType: '零售', region: ['a', 'b', 'c'] } },
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
});
