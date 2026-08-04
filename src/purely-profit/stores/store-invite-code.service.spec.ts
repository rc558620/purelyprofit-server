import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import { buildClubInviteCodeMapCacheKey } from '../../redis/keys';
import { StoreInviteCodeService } from './store-invite-code.service';

describe('StoreInviteCodeService', () => {
  let service: StoreInviteCodeService;
  let prisma: {
    storeInviteCode: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    storeInviteQrIssue: {
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let cacheInvalidator: { invalidateMarketingOverview: jest.Mock };
  let redis: { del: jest.Mock };

  beforeEach(async () => {
    prisma = {
      storeInviteCode: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storeInviteQrIssue: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn().mockImplementation(async (tx: (tx: unknown) => unknown) =>
        tx(prisma),
      ),
    };
    cacheInvalidator = {
      invalidateMarketingOverview: jest.fn().mockResolvedValue(undefined),
    };
    redis = { del: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreInviteCodeService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheInvalidatorService, useValue: cacheInvalidator },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(StoreInviteCodeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateForStore', () => {
    it('生成成功后会主动失效营销概览与 C 端映射缓存', async () => {
      prisma.storeInviteCode.create.mockResolvedValueOnce({ id: 1 });

      const code = await service.generateForStore(18);

      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
      expect(cacheInvalidator.invalidateMarketingOverview).toHaveBeenCalledWith(18);
      expect(redis.del).toHaveBeenCalledWith(buildClubInviteCodeMapCacheKey());
    });
  });

  describe('regenerateForStore', () => {
    it('轮换时先停用旧码、生成新码，并在事务后失效缓存', async () => {
      const code = await service.regenerateForStore(18);

      expect(prisma.storeInviteCode.updateMany).toHaveBeenCalledWith({
        where: { storeId: 18 },
        data: { isActive: false },
      });
      expect(prisma.storeInviteCode.create).toHaveBeenCalled();
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
      expect(cacheInvalidator.invalidateMarketingOverview).toHaveBeenCalledWith(18);
      expect(redis.del).toHaveBeenCalledWith(buildClubInviteCodeMapCacheKey());
    });

    it('轮换时联动失效该门店所有生效中的渠道二维码', async () => {
      await service.regenerateForStore(18);

      expect(prisma.storeInviteQrIssue.updateMany).toHaveBeenCalledWith({
        where: { storeId: 18, status: 'active' },
        data: expect.objectContaining({
          status: 'revoked',
          revokedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('deactivateForStore', () => {
    it('停用全部有效邀请码并失效缓存', async () => {
      await service.deactivateForStore(18);

      expect(prisma.storeInviteCode.updateMany).toHaveBeenCalledWith({
        where: { storeId: 18, isActive: true },
        data: { isActive: false },
      });
      expect(cacheInvalidator.invalidateMarketingOverview).toHaveBeenCalledWith(18);
      expect(redis.del).toHaveBeenCalledWith(buildClubInviteCodeMapCacheKey());
    });

    it('停用邀请码时联动失效该门店所有生效中的渠道二维码', async () => {
      await service.deactivateForStore(18);

      expect(prisma.storeInviteQrIssue.updateMany).toHaveBeenCalledWith({
        where: { storeId: 18, status: 'active' },
        data: expect.objectContaining({
          status: 'revoked',
          revokedAt: expect.any(Date),
        }),
      });
    });
  });
});
