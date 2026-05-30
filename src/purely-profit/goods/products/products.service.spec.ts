import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ProductResponseDto } from './dto/product.dto';
import {
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
} from './products.domain';
import { buildProductResponse } from './products.mapper';
import {
  createProductRecord,
  deleteProductRecord,
  findProductById,
  findProductStore,
  queryProductPage,
  updateProductRecord,
} from './products.query';
import { ProductsService } from './products.service';
import type { ProductRecord } from './products.types';

jest.mock('./products.domain', () => ({
  ensureProductCategory: jest.fn(),
  ensureUniqueProductCode: jest.fn(),
  resolveProductCode: jest.fn(),
}));

jest.mock('./products.query', () => ({
  createProductRecord: jest.fn(),
  deleteProductRecord: jest.fn(),
  findProductById: jest.fn(),
  findProductStore: jest.fn(),
  queryProductPage: jest.fn(),
  updateProductRecord: jest.fn(),
}));

jest.mock('./products.mapper', () => ({
  buildProductResponse: jest.fn(),
}));

describe('ProductsService', () => {
  let service: ProductsService;

  const prismaService = {};

  const configService = {
    get: jest.fn(),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
    resolveViewStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const platformMembershipAccessService = {
    ensureProductQuotaAvailable: jest.fn(),
  };

  const mockedEnsureProductCategory = jest.mocked(ensureProductCategory);
  const mockedEnsureUniqueProductCode = jest.mocked(ensureUniqueProductCode);
  const mockedResolveProductCode = jest.mocked(resolveProductCode);
  const mockedBuildProductResponse = jest.mocked(buildProductResponse);
  const mockedCreateProductRecord = jest.mocked(createProductRecord);
  const mockedDeleteProductRecord = jest.mocked(deleteProductRecord);
  const mockedFindProductById = jest.mocked(findProductById);
  const mockedFindProductStore = jest.mocked(findProductStore);
  const mockedQueryProductPage = jest.mocked(queryProductPage);
  const mockedUpdateProductRecord = jest.mocked(updateProductRecord);

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

  function createProductRecordFixture(
    overrides?: Partial<ProductRecord>,
  ): ProductRecord {
    const createdAt = new Date('2026-05-23T10:00:00.000Z');

    return {
      id: 11,
      storeId: 18,
      name: '可乐',
      category: '饮品',
      code: 'SKU-001',
      price: 500,
      profit: 200,
      costPrice: 300,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      image: 'https://example.com/coke.png',
      description: '冰镇口感更佳',
      isActive: true,
      createdAt,
      updatedAt: new Date('2026-05-23T10:05:00.000Z'),
      ...overrides,
    };
  }

  function createProductResponseFixture(params?: {
    record?: ProductRecord;
    overrides?: Partial<ProductResponseDto>;
  }): ProductResponseDto {
    const record = params?.record ?? createProductRecordFixture();

    return {
      id: String(record.id),
      name: record.name,
      category: record.category,
      code: record.code,
      price: Number(record.price),
      profit: Number(record.profit),
      ...(record.costPrice !== null
        ? { costPrice: Number(record.costPrice) }
        : {}),
      unit: record.unit,
      stock: record.stock,
      alertThreshold: record.alertThreshold,
      ...(record.image ? { image: record.image } : {}),
      ...(record.description ? { description: record.description } : {}),
      isActive: record.isActive,
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
      ...params?.overrides,
    };
  }

  function setupListMocks(params?: {
    storeId?: number | null;
    items?: ProductRecord[];
    total?: number;
    responses?: ProductResponseDto[];
  }) {
    const storeId = params?.storeId === undefined ? 18 : params.storeId;
    const items = params?.items ?? [createProductRecordFixture()];
    const total = params?.total ?? items.length;
    const responses =
      params?.responses ??
      items.map((item) => createProductResponseFixture({ record: item }));

    commerceAccessService.resolveViewStoreId.mockResolvedValue(storeId);

    if (storeId !== null) {
      mockedQueryProductPage.mockResolvedValue({
        items,
        total,
      });
      responses.forEach((response) => {
        mockedBuildProductResponse.mockReturnValueOnce(response);
      });
    }

    return {
      storeId,
      items,
      total,
      responses,
    };
  }

  function setupCreateMocks(params?: {
    storeId?: number;
    categoryId?: number | null;
    resolvedCode?: string;
    created?: ProductRecord;
    response?: ProductResponseDto;
    quotaError?: Error;
  }) {
    const storeId = params?.storeId ?? 18;
    const categoryId = params?.categoryId ?? 7;
    const resolvedCode = params?.resolvedCode ?? 'SKU-001';
    const created = params?.created ?? createProductRecordFixture();
    const response =
      params?.response ?? createProductResponseFixture({ record: created });

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(storeId);

    if (params?.quotaError) {
      platformMembershipAccessService.ensureProductQuotaAvailable.mockRejectedValue(
        params.quotaError,
      );
      return { storeId };
    }

    platformMembershipAccessService.ensureProductQuotaAvailable.mockResolvedValue(
      undefined,
    );
    mockedEnsureProductCategory.mockResolvedValue(
      categoryId === null ? null : { id: categoryId },
    );
    mockedResolveProductCode.mockResolvedValue(resolvedCode);
    mockedCreateProductRecord.mockResolvedValue(created);
    mockedBuildProductResponse.mockReturnValue(response);

    return {
      storeId,
      categoryId,
      resolvedCode,
      created,
      response,
    };
  }

  function setupDetailMocks(params?: {
    row?: ProductRecord;
    response?: ProductResponseDto;
  }) {
    const row = params?.row ?? createProductRecordFixture();
    const response =
      params?.response ?? createProductResponseFixture({ record: row });

    mockedFindProductById.mockResolvedValue(row);
    mockedBuildProductResponse.mockReturnValue(response);

    return {
      row,
      response,
    };
  }

  function setupUpdateMocks(params?: {
    current?: ProductRecord;
    updated?: ProductRecord;
    response?: ProductResponseDto;
    categoryId?: number | null;
    nextCode?: string;
  }) {
    const current = params?.current ?? createProductRecordFixture();
    const updated =
      params?.updated ??
      createProductRecordFixture({
        code: 'SKU-002',
        category: '汽水',
        name: '雪碧',
        image: null,
        description: null,
      });
    const response =
      params?.response ?? createProductResponseFixture({ record: updated });
    const categoryId = params?.categoryId ?? 9;
    const nextCode = params?.nextCode ?? 'SKU-002';

    mockedFindProductById.mockResolvedValue(current);
    mockedEnsureUniqueProductCode.mockResolvedValue(undefined);
    mockedEnsureProductCategory.mockResolvedValue(
      categoryId === null ? null : { id: categoryId },
    );
    mockedUpdateProductRecord.mockResolvedValue(updated);
    mockedBuildProductResponse.mockReturnValue(response);

    return {
      current,
      updated,
      response,
      categoryId,
      nextCode,
    };
  }

  function setupRemoveMocks(params?: {
    product?: { id: number; storeId: number } | null;
  }) {
    const product = params?.product ?? {
      id: 11,
      storeId: 18,
    };

    mockedFindProductStore.mockResolvedValue(product);
    mockedDeleteProductRecord.mockResolvedValue(undefined);

    return {
      product,
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    configService.get.mockImplementation((key: string) => {
      if (key === 'app.defaultPageSize') {
        return 20;
      }
      if (key === 'app.maxPageSize') {
        return 100;
      }
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('list 在无可查看门店时直接返回空分页结果', async () => {
    setupListMocks({ storeId: null });

    await expect(service.list(user, {})).resolves.toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      },
    });

    expect(mockedQueryProductPage).not.toHaveBeenCalled();
    expect(mockedBuildProductResponse).not.toHaveBeenCalled();
  });

  it('list 会串联权限、query 和 mapper 完成列表编排', async () => {
    const row = createProductRecordFixture();
    const response = createProductResponseFixture({
      record: row,
      overrides: {
        costPrice: undefined,
        image: undefined,
        description: undefined,
      },
    });
    const { responses } = setupListMocks({
      items: [row],
      total: 1,
      responses: [response],
    });

    await expect(
      service.list(user, {
        storeId: 18,
        page: 2,
        pageSize: 5,
        keyword: '可乐',
        category: '饮品',
        isActive: true,
        sortBy: 'price_desc',
      }),
    ).resolves.toEqual({
      items: responses,
      meta: {
        page: 2,
        pageSize: 5,
        total: 1,
        totalPages: 1,
      },
    });

    expect(mockedQueryProductPage).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      query: {
        storeId: 18,
        page: 2,
        pageSize: 5,
        keyword: '可乐',
        category: '饮品',
        isActive: true,
        sortBy: 'price_desc',
      },
      skip: 5,
      take: 5,
    });
    expect(mockedBuildProductResponse).toHaveBeenNthCalledWith(1, row, 0, [
      row,
    ]);
  });

  it('detail 会查询商品、校验访问权限并交给 mapper 输出', async () => {
    const row = createProductRecordFixture();
    const response = createProductResponseFixture({
      record: row,
      overrides: {
        costPrice: undefined,
        image: undefined,
        description: undefined,
      },
    });
    setupDetailMocks({ row, response });

    await expect(service.detail(user, 11)).resolves.toEqual(response);

    expect(mockedFindProductById).toHaveBeenCalledWith(prismaService, 11);
    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'goods:view',
      '无权查看该门店商品',
    );
    expect(mockedBuildProductResponse).toHaveBeenCalledWith(row);
  });

  it('create 只编排额度校验、domain、query 和 mapper', async () => {
    const created = createProductRecordFixture();
    const response = createProductResponseFixture({
      record: created,
      overrides: {
        costPrice: undefined,
        image: undefined,
        description: undefined,
      },
    });
    const { storeId, categoryId, resolvedCode } = setupCreateMocks({
      created,
      response,
    });

    await expect(
      service.create(user, {
        storeId,
        category: ' 饮品 ',
        code: 'SKU-001',
        name: ' 可乐 ',
        price: 500,
        profit: 200,
        costPrice: 300,
        unit: ' 瓶 ',
        stock: 10,
        alertThreshold: 3,
        image: ' https://example.com/coke.png ',
        description: ' 冰镇口感更佳 ',
      }),
    ).resolves.toEqual(response);

    expect(
      platformMembershipAccessService.ensureProductQuotaAvailable,
    ).toHaveBeenCalledWith(storeId);
    expect(mockedEnsureProductCategory).toHaveBeenCalledWith(prismaService, {
      storeId,
      categoryName: '饮品',
    });
    expect(mockedResolveProductCode).toHaveBeenCalledWith(prismaService, {
      storeId,
      code: 'SKU-001',
    });
    expect(mockedCreateProductRecord).toHaveBeenCalledWith(prismaService, {
      storeId,
      categoryId,
      category: '饮品',
      code: resolvedCode,
      name: '可乐',
      price: 500,
      profit: 200,
      costPrice: 300,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      image: 'https://example.com/coke.png',
      description: '冰镇口感更佳',
    });
    expect(mockedBuildProductResponse).toHaveBeenCalledWith(created);
  });

  it('create 的领域前置校验失败时不会继续调用 query', async () => {
    setupCreateMocks({
      quotaError: new ForbiddenException(
        '当前会员套餐最多可录入 3 个商品，请升级会员后继续添加',
      ),
    });

    await expect(
      service.create(user, {
        storeId: 18,
        category: '饮品',
        code: 'SKU-001',
        name: '可乐',
        price: 500,
        profit: 200,
        costPrice: 300,
        unit: '瓶',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockedEnsureProductCategory).not.toHaveBeenCalled();
    expect(mockedResolveProductCode).not.toHaveBeenCalled();
    expect(mockedCreateProductRecord).not.toHaveBeenCalled();
  });

  it('update 会只编排查找、权限、domain、query 和 mapper', async () => {
    const updated = createProductRecordFixture({
      code: 'SKU-002',
      category: '汽水',
      name: '雪碧',
      image: null,
      description: null,
    });
    const response = createProductResponseFixture({
      record: updated,
      overrides: { costPrice: undefined },
    });
    const { categoryId, nextCode } = setupUpdateMocks({
      updated,
      response,
    });

    await expect(
      service.update(user, 11, {
        name: ' 雪碧 ',
        category: ' 汽水 ',
        code: ' SKU-002 ',
        image: '',
        description: '',
      }),
    ).resolves.toEqual(response);

    expect(mockedFindProductById).toHaveBeenCalledWith(prismaService, 11);
    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'goods:update',
      '无权操作该门店商品',
    );
    expect(mockedEnsureUniqueProductCode).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      code: nextCode,
      excludeId: 11,
    });
    expect(mockedEnsureProductCategory).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      categoryName: '汽水',
    });
    expect(mockedUpdateProductRecord).toHaveBeenCalledWith(prismaService, 11, {
      name: '雪碧',
      category: '汽水',
      categoryId,
      code: nextCode,
      image: null,
      description: null,
    });
    expect(mockedBuildProductResponse).toHaveBeenCalledWith(updated);
  });

  it('remove 会只编排访问校验和删除动作', async () => {
    const { product } = setupRemoveMocks();

    await expect(service.remove(user, 11)).resolves.toBeUndefined();

    expect(mockedFindProductStore).toHaveBeenCalledWith(prismaService, 11);
    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      product.storeId,
      'goods:delete',
      '无权删除该门店商品',
    );
    expect(mockedDeleteProductRecord).toHaveBeenCalledWith(
      prismaService,
      product.id,
    );
  });

  it('商品不存在或金额非法时会在 service 层直接失败', async () => {
    mockedFindProductById.mockResolvedValue(null);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureProductQuotaAvailable.mockResolvedValue(
      undefined,
    );

    await expect(service.detail(user, 404)).rejects.toThrow(
      new NotFoundException('商品不存在'),
    );

    await expect(
      service.create(user, {
        storeId: 18,
        category: '饮品',
        name: '可乐',
        price: 0,
        profit: 200,
        unit: '瓶',
      }),
    ).rejects.toThrow(new BadRequestException('售价必须大于 0'));
  });
});
