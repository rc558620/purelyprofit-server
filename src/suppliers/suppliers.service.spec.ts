import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;

  const prismaService = {
    supplier: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('list 在无可见门店时返回空数组', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(service.list(user, { storeId: 18 })).resolves.toEqual([]);
    expect(prismaService.supplier.findMany).not.toHaveBeenCalled();
  });

  it('list 会按门店和关键词查询并映射返回字段', async () => {
    const createdAt = new Date('2026-05-14T10:00:00.000Z');
    const updatedAt = new Date('2026-05-14T12:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.supplier.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        name: '可口可乐供应商',
        contact: '张老板',
        phone: '13800138000',
        category: '饮品',
        note: '每周三送货',
        createdAt,
        updatedAt,
      },
    ]);

    await expect(
      service.list(user, { storeId: 18, keyword: '可乐' }),
    ).resolves.toEqual([
      {
        id: '11',
        name: '可口可乐供应商',
        contact: '张老板',
        phone: '13800138000',
        category: '饮品',
        note: '每周三送货',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      },
    ]);

    expect(prismaService.supplier.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        OR: [
          {
            name: {
              contains: '可乐',
              mode: 'insensitive',
            },
          },
          {
            contact: {
              contains: '可乐',
              mode: 'insensitive',
            },
          },
          {
            phone: {
              contains: '可乐',
            },
          },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('create 在名称重复时抛出 ConflictException', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.supplier.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.create(user, {
        storeId: 18,
        name: '  可口可乐供应商  ',
        contact: '张老板',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update 会校验权限并支持清空可选字段', async () => {
    const createdAt = new Date('2026-05-14T10:00:00.000Z');
    const updatedAt = new Date('2026-05-15T09:00:00.000Z');

    prismaService.supplier.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      name: '旧供应商',
      contact: '旧联系人',
      phone: '13800138000',
      category: '饮品',
      note: '旧备注',
      createdAt,
      updatedAt: createdAt,
    });
    prismaService.supplier.findFirst.mockResolvedValue(null);
    prismaService.supplier.update.mockResolvedValue({
      id: 11,
      storeId: 18,
      name: '新供应商',
      contact: null,
      phone: null,
      category: null,
      note: null,
      createdAt,
      updatedAt,
    });

    await expect(
      service.update(user, 11, {
        name: '  新供应商  ',
        contact: '',
        phone: '   ',
        category: '',
        note: '',
      }),
    ).resolves.toEqual({
      id: '11',
      name: '新供应商',
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'supplier:update',
      '无权操作该门店供应商',
    );
    expect(prismaService.supplier.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        name: '新供应商',
        contact: null,
        phone: null,
        category: null,
        note: null,
      },
    });
  });

  it('remove 在供应商不存在时抛出 NotFoundException', async () => {
    prismaService.supplier.findUnique.mockResolvedValue(null);

    await expect(service.remove(user, 11)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
