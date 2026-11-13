import type { PrismaService } from '../../../prisma/prisma.service';
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
    exists: jest.Mock;
    setJson: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      member: { findFirst: jest.fn() },
      marketingCustomer: { findFirst: jest.fn() },
      marketingRecharge: { aggregate: jest.fn() },
    };
    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(false),
      setJson: jest.fn().mockResolvedValue(undefined),
    };
    service = new ClubMemberProfileService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
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

  it('缓存命中时不查库，且 null 哨兵仍按原有语义返回 null', async () => {
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

    redis.getJson.mockResolvedValueOnce(null);
    redis.exists.mockResolvedValueOnce(true);
    await expect(
      service.getSnapshotByStoreIdentity(STORE_ID, 202, PHONE),
    ).resolves.toBeNull();
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });
});
