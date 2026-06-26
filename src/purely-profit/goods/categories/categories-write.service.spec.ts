import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoryResponse } from './categories.mapper';
import {
  clearCategoryProducts,
  createCategoryRecord,
  deleteCategoryRecord,
  findCategoryById,
  findCategoryDuplicateByName,
  renameCategoryProducts,
  updateCategoryRecord,
} from './categories.query';
import { CategoriesWriteService } from './categories-write.service';
import type { CategoryRecord } from './categories.types';

jest.mock('./categories.query', () => ({
  clearCategoryProducts: jest.fn(),
  createCategoryRecord: jest.fn(),
  deleteCategoryRecord: jest.fn(),
  findCategoryById: jest.fn(),
  findCategoryDuplicateByName: jest.fn(),
  renameCategoryProducts: jest.fn(),
  updateCategoryRecord: jest.fn(),
}));

jest.mock('./categories.mapper', () => ({
  buildCategoryResponse: jest.fn(),
}));

describe('CategoriesWriteService', () => {
  let service: CategoriesWriteService;

  const transactionMock = {
    productCategory: {
      update: jest.fn(),
      delete: jest.fn(),
    },
    product: {
      updateMany: jest.fn(),
    },
  };

  const prismaService = {
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const mockedClearCategoryProducts = jest.mocked(clearCategoryProducts);
  const mockedCreateCategoryRecord = jest.mocked(createCategoryRecord);
  const mockedDeleteCategoryRecord = jest.mocked(deleteCategoryRecord);
  const mockedFindCategoryById = jest.mocked(findCategoryById);
  const mockedFindCategoryDuplicateByName = jest.mocked(
    findCategoryDuplicateByName,
  );
  const mockedRenameCategoryProducts = jest.mocked(renameCategoryProducts);
  const mockedUpdateCategoryRecord = jest.mocked(updateCategoryRecord);
  const mockedBuildCategoryResponse = jest.mocked(buildCategoryResponse);

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
      role: 'owner',
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

  function createCategoryRecordFixture(
    overrides?: Partial<CategoryRecord>,
  ): CategoryRecord {
    return {
      id: 11,
      storeId: 18,
      name: '饮品',
      icon: '🥤',
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:05:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesWriteService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<CategoriesWriteService>(CategoriesWriteService);
  });

  it('create 会校验重名、创建记录并映射返回', async () => {
    const record = createCategoryRecordFixture();
    const response = {
      id: '11',
      name: '饮品',
      icon: '🥤',
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    };

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    mockedFindCategoryDuplicateByName.mockResolvedValue(null);
    mockedCreateCategoryRecord.mockResolvedValue(record);
    mockedBuildCategoryResponse.mockReturnValue(response);

    await expect(
      service.create(user, { storeId: 18, name: '饮品', icon: '🥤' }),
    ).resolves.toEqual(response);

    expect(mockedFindCategoryDuplicateByName).toHaveBeenCalledWith(
      prismaService,
      {
        storeId: 18,
        name: '饮品',
        excludeId: undefined,
      },
    );
    expect(mockedCreateCategoryRecord).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      name: '饮品',
      icon: '🥤',
    });
    expect(mockedBuildCategoryResponse).toHaveBeenCalledWith(record);
  });

  it('create 在分类重名时抛出 ConflictException', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    mockedFindCategoryDuplicateByName.mockResolvedValue({ id: 99 });

    await expect(
      service.create(user, { storeId: 18, name: '饮品' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockedCreateCategoryRecord).not.toHaveBeenCalled();
  });

  it('update 在分类不存在时抛出 NotFoundException', async () => {
    mockedFindCategoryById.mockResolvedValue(null);

    await expect(
      service.update(user, 11, { name: '酒水' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(commerceAccessService.ensureCanAccessStore).not.toHaveBeenCalled();
  });

  it('update 会校验权限、在事务中更新记录并同步商品分类名称', async () => {
    const category = createCategoryRecordFixture();
    const updated = createCategoryRecordFixture({
      name: '酒水',
      icon: null,
      updatedAt: new Date('2026-05-23T11:00:00.000Z'),
    });
    const response = {
      id: '11',
      name: '酒水',
      createdAt: updated.createdAt.getTime(),
      updatedAt: updated.updatedAt.getTime(),
    };

    mockedFindCategoryById.mockResolvedValue(category);
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    mockedFindCategoryDuplicateByName.mockResolvedValue(null);

    prismaService.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        mockedUpdateCategoryRecord.mockResolvedValue(updated);
        mockedRenameCategoryProducts.mockResolvedValue(undefined);
        return callback(transactionMock);
      },
    );

    mockedBuildCategoryResponse.mockReturnValue(response);

    await expect(
      service.update(user, 11, { name: '酒水', icon: '' }),
    ).resolves.toEqual(response);

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'goods:update',
      '无权操作该门店商品分类',
    );
    expect(mockedFindCategoryDuplicateByName).toHaveBeenCalledWith(
      prismaService,
      {
        storeId: 18,
        name: '酒水',
        excludeId: 11,
      },
    );
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedUpdateCategoryRecord).toHaveBeenCalledWith(
      transactionMock,
      11,
      {
        name: '酒水',
        icon: null,
      },
    );
    expect(mockedRenameCategoryProducts).toHaveBeenCalledWith(transactionMock, {
      storeId: 18,
      categoryId: 11,
      name: '酒水',
    });
  });

  it('update 在不修改名称时不触发重命名商品', async () => {
    const category = createCategoryRecordFixture();
    const updated = createCategoryRecordFixture({
      icon: null,
      updatedAt: new Date('2026-05-23T11:00:00.000Z'),
    });
    const response = {
      id: '11',
      name: '饮品',
      createdAt: updated.createdAt.getTime(),
      updatedAt: updated.updatedAt.getTime(),
    };

    mockedFindCategoryById.mockResolvedValue(category);
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);

    prismaService.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        mockedUpdateCategoryRecord.mockResolvedValue(updated);
        return callback(transactionMock);
      },
    );

    mockedBuildCategoryResponse.mockReturnValue(response);

    await expect(service.update(user, 11, { icon: '' })).resolves.toEqual(
      response,
    );

    expect(mockedFindCategoryDuplicateByName).not.toHaveBeenCalled();
    expect(mockedRenameCategoryProducts).not.toHaveBeenCalled();
  });

  it('remove 会校验权限、在事务中先清空商品分类再删除分类记录', async () => {
    const category = createCategoryRecordFixture();

    mockedFindCategoryById.mockResolvedValue(category);
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);

    prismaService.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        mockedClearCategoryProducts.mockResolvedValue(undefined);
        mockedDeleteCategoryRecord.mockResolvedValue(undefined);
        return callback(transactionMock);
      },
    );

    await expect(service.remove(user, 11)).resolves.toBeUndefined();

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'goods:delete',
      '无权删除该门店商品分类',
    );
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedClearCategoryProducts).toHaveBeenCalledWith(transactionMock, {
      storeId: 18,
      categoryId: 11,
    });
    expect(mockedDeleteCategoryRecord).toHaveBeenCalledWith(
      transactionMock,
      11,
    );
  });
});
