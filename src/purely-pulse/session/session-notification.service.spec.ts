import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SessionNotificationService } from './session-notification.service';

describe('SessionNotificationService', () => {
  let service: SessionNotificationService;

  const prismaService = {
    $queryRaw: jest.fn(),
    financeAccountRecord: {
      count: jest.fn(),
    },
    partnerWithdrawal: {
      count: jest.fn(),
    },
    employeeLeave: {
      count: jest.fn(),
    },
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
    jest.clearAllMocks();
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionNotificationService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<SessionNotificationService>(
      SessionNotificationService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('countUnreadNotifications 聚合库存 账款 提现 请假和订阅到期提醒', async () => {
    prismaService.$queryRaw.mockResolvedValue([{ count: BigInt(2) }]);
    prismaService.financeAccountRecord.count.mockResolvedValue(2);
    prismaService.partnerWithdrawal.count.mockResolvedValue(1);
    prismaService.employeeLeave.count.mockResolvedValue(3);
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      expiresAt: new Date('2026-05-25T00:00:00.000Z'),
    });

    await expect(service.countUnreadNotifications(18)).resolves.toBe(9);
    expect(prismaService.$queryRaw).toHaveBeenCalled();
    expect(prismaService.financeAccountRecord.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 18,
        dueDate: { lt: new Date('2026-05-21T12:00:00.000Z') },
        paidAmount: new Prisma.Decimal(0),
        remaining: { gt: new Prisma.Decimal(0) },
      }),
    });
    expect(prismaService.partnerWithdrawal.count).toHaveBeenCalledWith({
      where: { storeId: 18, status: 'pending' },
    });
    expect(prismaService.employeeLeave.count).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        startDate: {
          gte: new Date('2026-05-21T12:00:00.000Z'),
          lte: new Date('2026-05-28T15:59:59.999Z'),
        },
      },
    });
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).toHaveBeenCalledWith({
      where: { storeId: 18 },
      select: { expiresAt: true },
    });
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:session:notifications:store:18',
        ttlSeconds: 15,
      }),
    );
  });

  it('countUnreadNotifications 订阅未到期窗口内时不增加订阅提醒', async () => {
    prismaService.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    prismaService.financeAccountRecord.count.mockResolvedValue(1);
    prismaService.partnerWithdrawal.count.mockResolvedValue(0);
    prismaService.employeeLeave.count.mockResolvedValue(2);
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      expiresAt: new Date('2026-06-05T00:00:00.000Z'),
    });

    await expect(service.countUnreadNotifications(20)).resolves.toBe(3);
    expect(prismaService.financeAccountRecord.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 20,
        dueDate: { lt: new Date('2026-05-21T12:00:00.000Z') },
        paidAmount: new Prisma.Decimal(0),
        remaining: { gt: new Prisma.Decimal(0) },
      }),
    });
  });

  it('countUnreadNotifications 订阅已过期或不存在时不增加订阅提醒', async () => {
    prismaService.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    prismaService.financeAccountRecord.count.mockResolvedValue(0);
    prismaService.partnerWithdrawal.count.mockResolvedValue(0);
    prismaService.employeeLeave.count.mockResolvedValue(0);
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      expiresAt: new Date('2026-05-20T00:00:00.000Z'),
    });

    await expect(service.countUnreadNotifications(21)).resolves.toBe(0);

    prismaService.storeMembershipProfile.findUnique.mockResolvedValue(null);

    await expect(service.countUnreadNotifications(21)).resolves.toBe(0);
  });

  it('countUnreadNotifications 不会把部分已收付的过期账款算作逾期提醒', async () => {
    prismaService.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    prismaService.financeAccountRecord.count.mockResolvedValue(0);
    prismaService.partnerWithdrawal.count.mockResolvedValue(0);
    prismaService.employeeLeave.count.mockResolvedValue(0);
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue(null);

    await expect(service.countUnreadNotifications(22)).resolves.toBe(0);
    expect(prismaService.financeAccountRecord.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 22,
        dueDate: { lt: new Date('2026-05-21T12:00:00.000Z') },
        paidAmount: new Prisma.Decimal(0),
        remaining: { gt: new Prisma.Decimal(0) },
      }),
    });
  });
});
