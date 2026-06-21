import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CategoriesReadService } from './categories-read.service';
import { CategoriesService } from './categories.service';
import { CategoriesWriteService } from './categories-write.service';

describe('CategoriesService', () => {
  let service: CategoriesService;

  const categoriesReadService = {
    list: jest.fn(),
  };

  const categoriesWriteService = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
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
        CategoriesService,
        {
          provide: CategoriesReadService,
          useValue: categoriesReadService,
        },
        {
          provide: CategoriesWriteService,
          useValue: categoriesWriteService,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('list 委托给 read service', async () => {
    const query = { storeId: 18, keyword: '饮' };
    const result = [{ id: '1', name: '饮品', createdAt: 1, updatedAt: 2 }];

    categoriesReadService.list.mockResolvedValue(result);

    await expect(service.list(user, query)).resolves.toBe(result);
    expect(categoriesReadService.list).toHaveBeenCalledWith(user, query);
  });

  it('create/update/remove 委托给 write service', async () => {
    const createDto = { storeId: 18, name: '饮品', icon: '🥤' };
    const updateDto = { name: '酒水', icon: '' };
    const createResult = {
      id: '1',
      name: '饮品',
      icon: '🥤',
      createdAt: 1,
      updatedAt: 2,
    };
    const updateResult = {
      id: '1',
      name: '酒水',
      createdAt: 1,
      updatedAt: 3,
    };

    categoriesWriteService.create.mockResolvedValue(createResult);
    categoriesWriteService.update.mockResolvedValue(updateResult);
    categoriesWriteService.remove.mockResolvedValue(undefined);

    await expect(service.create(user, createDto)).resolves.toBe(createResult);
    await expect(service.update(user, 1, updateDto)).resolves.toBe(
      updateResult,
    );
    await expect(service.remove(user, 1)).resolves.toBeUndefined();

    expect(categoriesWriteService.create).toHaveBeenCalledWith(user, createDto);
    expect(categoriesWriteService.update).toHaveBeenCalledWith(
      user,
      1,
      updateDto,
    );
    expect(categoriesWriteService.remove).toHaveBeenCalledWith(user, 1);
  });
});
