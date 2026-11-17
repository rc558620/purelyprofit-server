import type { PrismaService } from '../../../prisma/prisma.service';
import type { RedisReadPrefetchService } from '../../../redis/redis-read-prefetch.service';
import type { RedisService } from '../../../redis/redis.service';
import { ClubMemberProfileService } from './club-member-profile.service';

const STORE_ID = 11;
const PHONE = '13800138000';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

describe('ClubMemberProfileService · 会员快照并发去重', () => {
  let service: ClubMemberProfileService;
  let prisma: {
    member: { findFirst: jest.Mock };
    marketingCustomer: { findFirst: jest.Mock };
    marketingRecharge: { aggregate: jest.Mock };
  };
  let redis: {
    getJson: jest.Mock;
    setJson: jest.Mock;
  };
  /** 本文件不覆盖预取语义：peekJson 恒为 undefined，等价于「未预取」 */
  let prefetch: { peekJson: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      member: { findFirst: jest.fn() },
      marketingCustomer: { findFirst: jest.fn() },
      marketingRecharge: { aggregate: jest.fn() },
    };
    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
    };
    prefetch = { peekJson: jest.fn().mockResolvedValue(undefined) };
    service = new ClubMemberProfileService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      prefetch as unknown as RedisReadPrefetchService,
    );
  });

  const mockMemberRecords = (): void => {
    prisma.member.findFirst.mockResolvedValue({ id: 9, createdAt: CREATED_AT });
    prisma.marketingCustomer.findFirst.mockResolvedValue({
      id: 55,
      balance: 10000,
      points: 20,
      tier: 'gold',
      createdAt: CREATED_AT,
    });
    prisma.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 50000 },
    });
  };

  it('并发解析同一门店+用户的快照只回源一次', async () => {
    mockMemberRecords();

    const [first, second] = await Promise.all([
      service.getSnapshotByStoreIdentity(STORE_ID, 201, PHONE),
      service.getSnapshotByStoreIdentity(STORE_ID, 201, PHONE),
    ]);

    expect(first).toEqual(second);
    expect(first?.customerId).toBe(55);
    expect(prisma.member.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.marketingCustomer.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.marketingRecharge.aggregate).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledTimes(1);
  });

  it('不同用户不共享在途 Promise，避免串号', async () => {
    mockMemberRecords();

    await Promise.all([
      service.getSnapshotByStoreIdentity(STORE_ID, 201, PHONE),
      service.getSnapshotByStoreIdentity(STORE_ID, 202, PHONE),
    ]);

    expect(prisma.member.findFirst).toHaveBeenCalledTimes(2);
  });

  it('在途 Promise 异常后不残留，后续请求可重新回源', async () => {
    prisma.member.findFirst.mockRejectedValueOnce(new Error('db down'));
    prisma.marketingCustomer.findFirst.mockResolvedValue(null);
    prisma.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    await expect(
      service.getSnapshotByStoreIdentity(STORE_ID, 201, PHONE),
    ).rejects.toThrow('db down');

    mockMemberRecords();
    const snapshot = await service.getSnapshotByStoreIdentity(
      STORE_ID,
      201,
      PHONE,
    );

    expect(snapshot?.customerId).toBe(55);
    expect(prisma.member.findFirst).toHaveBeenCalledTimes(2);
  });

  it('缓存命中时不查库，且空结果哨兵仍按原有语义返回 null', async () => {
    redis.getJson.mockResolvedValueOnce({
      customerId: 55,
      memberId: 9,
      storeId: STORE_ID,
      balance: 100,
      level: 'gold',
      points: 20,
      memberCode: '20260101-9',
      joinDate: '2026-01-01',
      totalConsume: 500,
    });
    await service.getSnapshotByStoreIdentity(STORE_ID, 201, PHONE);
    expect(prisma.member.findFirst).not.toHaveBeenCalled();

    // 空结果用显式哨兵对象表达，单次 GET 即可判定，无需 EXISTS 兜底
    redis.getJson.mockResolvedValueOnce({ found: false });
    await expect(
      service.getSnapshotByStoreIdentity(STORE_ID, 202, PHONE),
    ).resolves.toBeNull();
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it('无档案时写入空结果哨兵并复用短 TTL，不再额外 EXISTS 判定', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    prisma.marketingCustomer.findFirst.mockResolvedValue(null);

    await expect(
      service.getSnapshotByStoreIdentity(STORE_ID, 203, PHONE),
    ).resolves.toBeNull();

    expect(redis.setJson).toHaveBeenCalledWith(
      expect.stringContaining('club:member-snapshot:store:11:user:203'),
      { found: false },
      expect.any(Number),
    );
  });
});
