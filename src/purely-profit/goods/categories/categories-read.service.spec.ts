import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoriesListCacheKey } from '../../../redis/cache-keys';
import { RedisService } from '../../../redis/redis.service';
import { buildCategoryResponse } from './categories.mapper';
import {
  findCategoryListVersion,
  listCategoryRecords,
} from './categories.query';
import { CategoriesReadService } from './categories-read.service';
import type { CategoryRecord } from './categories.types';

jest.mock('./categories.query', () => ({
  findCategoryListVersion: jest.fn(),
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

  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  };

  const mockedListCategoryRecords = jest.mocked(listCategoryRecords);
  const mockedFindCategoryListVersion = jest.mocked(findCategoryListVersion);
  const mockedBuildCategoryResponse = jest.mocked(buildCategoryResponse);

  const CATEGORY_LIST_VERSION = '1783728000000-11-1';

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

    mockedFindCategoryListVersion.mockResolvedValue(CATEGORY_LIST_VERSION);
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<CategoriesReadService>(CategoriesReadService);
  });

  it('list 在无可查看门店时返回空数组，且不产生查询与缓存访问', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(
      service.list(user, { storeId: 18, keyword: '饮' }),
    ).resolves.toEqual([]);

    expect(mockedFindCategoryListVersion).not.toHaveBeenCalled();
    expect(redisService.getJson).not.toHaveBeenCalled();
    expect(mockedListCategoryRecords).not.toHaveBeenCalled();
    expect(mockedBuildCategoryResponse).not.toHaveBeenCalled();
  });

  it('list 会串联权限、版本、query 和 mapper 并写入缓存', async () => {
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

    await expect(
      service.list(user, { storeId: 18, keyword: '饮' }),
    ).resolves.toEqual([response]);

    expect(mockedFindCategoryListVersion).toHaveBeenCalledWith(
      prismaService,
      18,
    );
    expect(redisService.getJson).toHaveBeenCalledWith(
      buildCategoriesListCacheKey(18, CATEGORY_LIST_VERSION, '饮'),
    );
    expect(mockedListCategoryRecords).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      keyword: '饮',
    });
    expect(mockedBuildCategoryResponse).toHaveBeenCalledWith(record, 0, [
      record,
    ]);
    expect(redisService.setJson).toHaveBeenCalledWith(
      buildCategoriesListCacheKey(18, CATEGORY_LIST_VERSION, '饮'),
      [response],
      30,
    );
  });

  it('list 命中缓存时直接返回，不查库也不做映射', async () => {
    const cached = [{ id: '11', name: '饮品', createdAt: 1, updatedAt: 2 }];

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    redisService.getJson.mockResolvedValue(cached);

    await expect(service.list(user, { storeId: 18 })).resolves.toBe(cached);

    expect(mockedListCategoryRecords).not.toHaveBeenCalled();
    expect(mockedBuildCategoryResponse).not.toHaveBeenCalled();
    expect(redisService.setJson).not.toHaveBeenCalled();
  });

  it('list 在缓存读取失败时降级查库', async () => {
    const record = createCategoryRecordFixture();
    const response = {
      id: '11',
      name: '饮品',
      icon: '🥤',
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    };

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    redisService.getJson.mockRejectedValue(new Error('redis unavailable'));
    mockedListCategoryRecords.mockResolvedValue([record]);
    mockedBuildCategoryResponse.mockReturnValue(response);

    await expect(service.list(user, { storeId: 18 })).resolves.toEqual([
      response,
    ]);

    expect(mockedListCategoryRecords).toHaveBeenCalledTimes(1);
    expect(mockedBuildCategoryResponse).toHaveBeenCalledTimes(1);
  });

  it('list 会缓存空列表，避免空结果穿透到数据库', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    mockedListCategoryRecords.mockResolvedValue([]);

    await expect(service.list(user, { storeId: 18 })).resolves.toEqual([]);

    expect(redisService.setJson).toHaveBeenCalledWith(
      buildCategoriesListCacheKey(18, CATEGORY_LIST_VERSION, undefined),
      [],
      30,
    );
  });
});
