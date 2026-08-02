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

  const createService = (): AuthLegacyOwnerRepairService =>
    new AuthLegacyOwnerRepairService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
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
