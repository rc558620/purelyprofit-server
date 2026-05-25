import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoryResponse } from './categories.mapper';
import { listCategoryRecords } from './categories.query';
import { CategoriesReadService } from './categories-read.service';
import type { CategoryRecord } from './categories.types';

jest.mock('./categories.query', () => ({
  listCategoryRecords: jest.fn(),
}));

jest.mock('./categories.mapper', () => ({
  buildCategoryResponse: jest.fn(),
}));

describe('CategoriesReadService', () => {
  let service: CategoriesReadService;

  const prismaService = {};

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };

  const mockedListCategoryRecords = jest.mocked(listCategoryRecords);
  const mockedBuildCategoryResponse = jest.mocked(buildCategoryResponse);

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
        CategoriesReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<CategoriesReadService>(CategoriesReadService);
  });

  it('list 在无可查看门店时返回空数组', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(service.list(user, { storeId: 18, keyword: '饮' })).resolves.toEqual(
      [],
    );

    expect(mockedListCategoryRecords).not.toHaveBeenCalled();
    expect(mockedBuildCategoryResponse).not.toHaveBeenCalled();
  });

  it('list 会串联权限、query 和 mapper 返回分类列表', async () => {
    const record = createCategoryRecordFixture();
    const response = {
      id: '11',
      name: '饮品',
      icon: '🥤',
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    };

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    mockedListCategoryRecords.mockResolvedValue([record]);
    mockedBuildCategoryResponse.mockReturnValue(response);

    await expect(service.list(user, { storeId: 18, keyword: '饮' })).resolves.toEqual([
      response,
    ]);

    expect(mockedListCategoryRecords).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      keyword: '饮',
    });
    expect(mockedBuildCategoryResponse).toHaveBeenCalledWith(record, 0, [record]);
  });
});
