/**
 * 开台选项单测：收银员开台只需服务项与在职服务人员。
 *
 * 覆盖：
 *  - 按 space:view 解析门店（不依赖 commission:view，否则收银员会连带获得提成明细与导出）
 *  - 只返回启用服务项与在职服务人员，响应不含提成金额与员工档案字段
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { CommissionCoreService } from './commission-core.service';
import { CommissionServicesService } from './commission-services.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('CommissionServicesService – 开台选项', () => {
  let service: CommissionServicesService;

  const user = {} as AuthenticatedUser;

  const prismaService = {
    store: {
      findUnique: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const coreService = {
    listConfigRecords: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      technicianLabel: '美容师',
    });
    prismaService.employee.findMany.mockResolvedValue([
      { id: 5, name: '王强', position: '美容师', isTechnician: true },
      { id: 6, name: '李四', position: '美容师', isTechnician: false },
      { id: 7, name: '张三', position: '收银员', isTechnician: false },
    ]);
    coreService.listConfigRecords.mockResolvedValue([
      {
        id: 1,
        name: '全身按摩',
        defaultCommission: 3000,
        enabled: true,
        sortOrder: 1,
        overrides: [{ technicianId: 5, commission: 5000 }],
      },
      {
        id: 2,
        name: '停用服务',
        defaultCommission: 1000,
        enabled: false,
        sortOrder: 2,
        overrides: [],
      },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionServicesService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: CommissionCoreService, useValue: coreService },
      ],
    }).compile();

    service = module.get<CommissionServicesService>(CommissionServicesService);
  });

  it('按 space:view 解析门店，收银员无需 commission:view', async () => {
    await service.listOpenOptions(user);

    expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'space:view',
      '无权访问该门店的开台选项',
    );
  });

  it('只返回启用服务项与在职服务人员，不含提成金额与档案字段', async () => {
    await expect(service.listOpenOptions(user)).resolves.toEqual({
      services: [{ id: 1, name: '全身按摩' }],
      technicians: [
        { id: 5, name: '王强', position: '美容师' },
        { id: 6, name: '李四', position: '美容师' },
      ],
    });
  });
});
