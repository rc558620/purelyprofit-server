import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import { StoreSubAccountService } from './store-sub-account.service';
import { StoreSubAccountSlotService } from './store-sub-account-slot.service';

describe('StoreSubAccountService', () => {
  let service: StoreSubAccountService;
  let prismaService: {
    storeSubAccount: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let storeSubAccountReadService: {
    getStoreSubAccountSummary: jest.Mock;
  };
  let storeSubAccountSlotService: {
    updateQuota: jest.Mock;
    updateSlot: jest.Mock;
  };

  beforeEach(async () => {
    const mockPrismaService = {
      storeSubAccount: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const mockStoreSubAccountReadService = {
      getStoreSubAccountSummary: jest.fn(),
    };

    const mockStoreSubAccountSlotService = {
      updateQuota: jest.fn(),
      updateSlot: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreSubAccountService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: StoreSubAccountReadService,
          useValue: mockStoreSubAccountReadService,
        },
        {
          provide: StoreSubAccountSlotService,
          useValue: mockStoreSubAccountSlotService,
        },
      ],
    }).compile();

    service = module.get<StoreSubAccountService>(StoreSubAccountService);
    prismaService = module.get(PrismaService);
    storeSubAccountReadService = module.get(StoreSubAccountReadService);
    storeSubAccountSlotService = module.get(StoreSubAccountSlotService);
  });

  it('应将 updateQuota 委托给 slot service', async () => {
    const summary = {
      quota: 3,
      usedCount: 1,
      availableCount: 2,
      roleSummary: [],
      slots: [],
    };
    storeSubAccountSlotService.updateQuota.mockResolvedValue(summary);

    await expect(service.updateQuota(1, 3, 99, 'manual')).resolves.toEqual(
      summary,
    );
    expect(storeSubAccountSlotService.updateQuota).toHaveBeenCalledWith(
      1,
      3,
      99,
      'manual',
    );
  });

  it('应将 updateSlot 委托给 slot service', async () => {
    const input = {
      slotIndex: 1,
      role: StoreSubAccountRole.cashier,
      employeeId: 100,
    };
    const summary = {
      quota: 2,
      usedCount: 1,
      availableCount: 1,
      roleSummary: [],
      slots: [],
    };
    storeSubAccountSlotService.updateSlot.mockResolvedValue(summary);

    await expect(service.updateSlot(1, input)).resolves.toEqual(summary);
    expect(storeSubAccountSlotService.updateSlot).toHaveBeenCalledWith(
      1,
      input,
    );
  });

  it('应将 getStoreSubAccountSummary 委托给 read service', async () => {
    const summary = {
      quota: 2,
      usedCount: 0,
      availableCount: 2,
      roleSummary: [],
      slots: [],
    };
    storeSubAccountReadService.getStoreSubAccountSummary.mockResolvedValue(
      summary,
    );

    await expect(service.getStoreSubAccountSummary(1)).resolves.toEqual(
      summary,
    );
    expect(
      storeSubAccountReadService.getStoreSubAccountSummary,
    ).toHaveBeenCalledWith(1);
  });

  it('应过滤并映射可交班的已分配子账号', async () => {
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      {
        id: 11,
        slotIndex: 1,
        role: StoreSubAccountRole.manager,
        employee: {
          id: 100,
          name: 'Alice',
        },
      },
      {
        id: 12,
        slotIndex: 2,
        role: StoreSubAccountRole.cashier,
        employee: null,
      },
    ]);

    await expect(service.listAssignableHandoverCandidates(1)).resolves.toEqual([
      {
        employeeId: 100,
        employeeName: 'Alice',
        subAccountId: 11,
        slotIndex: 1,
        role: StoreSubAccountRole.manager,
      },
    ]);
    expect(prismaService.storeSubAccount.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 1,
        isAssigned: true,
        status: StoreSubAccountStatus.active,
        canUseHandover: true,
        employee: {
          is: {
            storeId: 1,
            status: 'active',
          },
        },
      },
      select: {
        id: true,
        slotIndex: true,
        role: true,
        employee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ slotIndex: 'asc' }],
    });
  });

  it('应查询员工已分配的子账号', async () => {
    const record = {
      id: 11,
      slotIndex: 1,
      role: StoreSubAccountRole.cashier,
      status: StoreSubAccountStatus.active,
      canUseHandover: true,
      canAccessHome: true,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    };
    prismaService.storeSubAccount.findFirst.mockResolvedValue(record);

    await expect(
      service.findAssignedSubAccountByEmployee(1, 100),
    ).resolves.toBe(record);
    expect(prismaService.storeSubAccount.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 1,
        employeeId: 100,
        isAssigned: true,
      },
      select: {
        id: true,
        slotIndex: true,
        role: true,
        status: true,
        canUseHandover: true,
        canAccessHome: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });
});
