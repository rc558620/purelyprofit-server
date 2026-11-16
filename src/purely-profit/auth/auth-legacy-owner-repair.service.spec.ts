import { StaffRole, StaffStatus } from '@prisma/client';
import { AuthLegacyOwnerRepairService } from './auth-legacy-owner-repair.service';

describe('AuthLegacyOwnerRepairService', () => {
  const prisma = {
    store: {
      findFirst: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const redisService = {
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };

  const createService = (): AuthLegacyOwnerRepairService =>
    new AuthLegacyOwnerRepairService(prisma as never, redisService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks 只清调用记录、不清实现：负缓存默认必须回到未命中
    redisService.exists.mockResolvedValue(false);
  });

  it('老店主仅存在 stores.ownerId 时会自动补齐 OWNER staff 并返回 true', async () => {
    const service = createService();

    prisma.store.findFirst.mockResolvedValue({
      id: 9,
      owner: {
        id: 1,
        email: 'owner@example.com',
        name: '老店主',
      },
    });
    prisma.staff.findFirst.mockResolvedValue(null);
    prisma.staff.create.mockResolvedValue({
      id: 21,
      storeId: 9,
    });

    await expect(
      service.repairLegacyOwnerMembership(
        {
          sub: 1,
          phone: '13800138000',
          sessionVersion: 0,
        },
        'owner@example.com',
      ),
    ).resolves.toBe(true);

    expect(prisma.staff.create).toHaveBeenCalledWith({
      data: {
        storeId: 9,
        userId: 1,
        email: 'owner@example.com',
        phone: '13800138000',
        name: '老店主',
        role: StaffRole.owner,
        permissions: ['*'],
        status: StaffStatus.active,
        isSeatActive: true,
        isActive: true,
      },
    });
  });

  it('命中「该账号无 owner 门店」负缓存时不再查库', async () => {
    const service = createService();
    redisService.exists.mockResolvedValue(true);

    await expect(
      service.repairLegacyOwnerMembership(
        {
          sub: 1,
          phone: '13800138000',
          sessionVersion: 0,
        },
        'club@purelyprofit.local',
      ),
    ).resolves.toBe(false);

    // C 端会员每次鉴权都会走到这里：负缓存命中必须完全不碰数据库
    expect(prisma.store.findFirst).not.toHaveBeenCalled();
  });

  it('账号确实没有 owner 门店时写入负缓存', async () => {
    const service = createService();
    prisma.store.findFirst.mockResolvedValue(null);

    await expect(
      service.repairLegacyOwnerMembership(
        {
          sub: 1,
          phone: '13800138000',
          sessionVersion: 0,
        },
        'club@purelyprofit.local',
      ),
    ).resolves.toBe(false);

    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringContaining('auth:legacy-owner-absent:1'),
      '1',
      expect.any(Number),
    );
  });

  it('ownership 迁移后清掉负缓存，避免目标账号长时间看不到门店', async () => {
    const service = createService();

    await service.invalidateOwnerAbsentCache(1);

    expect(redisService.del).toHaveBeenCalledWith(
      expect.stringContaining('auth:legacy-owner-absent:1'),
    );
  });

  it('若命中其他门店 staff 记录则跳过补齐，避免覆盖错误上下文', async () => {
    const service = createService();

    prisma.store.findFirst.mockResolvedValue({
      id: 9,
      owner: {
        id: 1,
        email: 'owner@example.com',
        name: '老店主',
      },
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 30,
      storeId: 99,
    });

    await expect(
      service.repairLegacyOwnerMembership(
        {
          sub: 1,
          phone: '13800138000',
          sessionVersion: 0,
        },
        'owner@example.com',
      ),
    ).resolves.toBe(false);

    expect(prisma.staff.create).not.toHaveBeenCalled();
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });
});
