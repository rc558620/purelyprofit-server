import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('CostsController', () => {
  let controller: CostsController;

  const costsService = {
    listRecords: jest.fn(),
    getStats: jest.fn(),
    createRecord: jest.fn(),
    deleteRecord: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleBuilder = Test.createTestingModule({
      controllers: [CostsController],
      providers: [{ provide: CostsService, useValue: costsService }],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<CostsController>(CostsController);
  });

  it('records 与 stats 路由转发到 service', async () => {
    const records = [
      {
        id: '1',
        title: '房租',
        type: 'fixed' as const,
        category: 'rent' as const,
        amount: 5000,
        date: 1747180800000,
        sourceType: 'manual' as const,
        deletable: true,
        createdAt: 1747184400000,
      },
    ];
    const stats = {
      totalThisMonth: 5000,
      fixedThisMonth: 5000,
      variableThisMonth: 0,
      compareLastMonth: 25,
      countThisMonth: 1,
    };
    const createDto = {
      title: '房租',
      type: 'fixed' as const,
      category: 'rent' as const,
      amount: 5000,
      date: 1747180800000,
      note: '5 月房租',
    };
    const createdRecord = {
      id: '2',
      ...createDto,
      sourceType: 'manual' as const,
      deletable: true,
      createdAt: 1747184500000,
    };
    costsService.listRecords.mockResolvedValue(records);
    costsService.getStats.mockResolvedValue(stats);
    costsService.createRecord.mockResolvedValue(createdRecord);
    costsService.deleteRecord.mockResolvedValue(undefined);

    await expect(
      controller.listRecords(
        { user },
        { period: 'month', typeFilter: 'fixed' },
      ),
    ).resolves.toEqual(records);
    await expect(
      controller.getStats({ user }, { period: 'week' }),
    ).resolves.toEqual(stats);
    await expect(controller.createRecord({ user }, createDto)).resolves.toEqual(
      createdRecord,
    );
    await expect(controller.deleteRecord({ user }, 2)).resolves.toBeUndefined();

    expect(costsService.listRecords).toHaveBeenCalledWith(user, {
      period: 'month',
      typeFilter: 'fixed',
    });
    expect(costsService.getStats).toHaveBeenCalledWith(user, {
      period: 'week',
    });
    expect(costsService.createRecord).toHaveBeenCalledWith(user, createDto);
    expect(costsService.deleteRecord).toHaveBeenCalledWith(user, 2);
  });
});
