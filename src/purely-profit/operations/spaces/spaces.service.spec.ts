import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SpacesReadService } from './spaces-read.service';
import { SpacesService } from './spaces.service';
import { SpacesWriteService } from './spaces-write.service';

describe('SpacesService', () => {
  let service: SpacesService;

  const spacesReadService = {
    listSpaces: jest.fn(),
  };

  const spacesWriteService = {
    createSpace: jest.fn(),
    updateSpace: jest.fn(),
    removeSpace: jest.fn(),
    markSpaceReady: jest.fn(),
    updateSpaceStatus: jest.fn(),
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
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacesService,
        { provide: SpacesReadService, useValue: spacesReadService },
        { provide: SpacesWriteService, useValue: spacesWriteService },
      ],
    }).compile();

    service = module.get<SpacesService>(SpacesService);
  });

  it('listSpaces 委托给 read service', async () => {
    const query = { storeId: 18, status: 'idle' as const };
    const result = [
      { id: '1', name: 'A台', type: '台球台', status: 'idle' as const },
    ];

    spacesReadService.listSpaces.mockResolvedValue(result);

    await expect(service.listSpaces(user, query)).resolves.toBe(result);
    expect(spacesReadService.listSpaces).toHaveBeenCalledWith(user, query);
  });

  it('写操作委托给 write service', async () => {
    const createDto = {
      storeId: 18,
      name: 'A台',
      type: '台球台',
      zone: '一楼',
      capacity: 4,
      enableDirtyRoom: false,
      autoCheckout: false,
      sortOrder: 1,
    };
    const updateDto = { name: 'A台-V2' };
    const statusDto = { status: 'cleaning' as const };
    const response = {
      id: '1',
      name: 'A台',
      type: '台球台',
      status: 'idle' as const,
      enableDirtyRoom: false,
      autoCheckout: false,
      sortOrder: 1,
      createdAt: 1,
    };

    spacesWriteService.createSpace.mockResolvedValue(response);
    spacesWriteService.updateSpace.mockResolvedValue(response);
    spacesWriteService.removeSpace.mockResolvedValue(undefined);
    spacesWriteService.markSpaceReady.mockResolvedValue(response);
    spacesWriteService.updateSpaceStatus.mockResolvedValue(response);

    await expect(service.createSpace(user, createDto)).resolves.toBe(response);
    await expect(service.updateSpace(user, 1, updateDto)).resolves.toBe(
      response,
    );
    await expect(service.removeSpace(user, 1)).resolves.toBeUndefined();
    await expect(service.markSpaceReady(user, 1)).resolves.toBe(response);
    await expect(service.updateSpaceStatus(user, 1, statusDto)).resolves.toBe(
      response,
    );

    expect(spacesWriteService.createSpace).toHaveBeenCalledWith(
      user,
      createDto,
    );
    expect(spacesWriteService.updateSpace).toHaveBeenCalledWith(
      user,
      1,
      updateDto,
    );
    expect(spacesWriteService.removeSpace).toHaveBeenCalledWith(user, 1);
    expect(spacesWriteService.markSpaceReady).toHaveBeenCalledWith(user, 1);
    expect(spacesWriteService.updateSpaceStatus).toHaveBeenCalledWith(
      user,
      1,
      statusDto,
    );
  });
});
