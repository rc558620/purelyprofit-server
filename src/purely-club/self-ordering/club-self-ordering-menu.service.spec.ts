import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubSelfOrderingMenuService } from './club-self-ordering-menu.service';

/**
 * 自助下单菜单查询测试：
 * - 商品库直接作为菜单数据源（与空间管理追加商品同源）
 * - specGroups 恒为空数组；P0 不做库存，全部 unlimited
 * - 无归属商品归入「其他」兜底分类；空分类被过滤
 */
describe('ClubSelfOrderingMenuService', () => {
  let service: ClubSelfOrderingMenuService;

  const prisma = {
    spaceSession: { findFirst: jest.fn() },
    productCategory: { findMany: jest.fn() },
    product: { findMany: jest.fn() },
  };

  const currentStoreContext = { requireCurrentContext: jest.fn() };
  const user = { id: 100 } as unknown as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    currentStoreContext.requireCurrentContext.mockResolvedValue({
      store: { id: 1, businessMode: 'general' },
    });
    prisma.spaceSession.findFirst.mockResolvedValue({ id: 42 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubSelfOrderingMenuService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ClubCurrentStoreContextService,
          useValue: currentStoreContext,
        },
      ],
    }).compile();
    service = module.get<ClubSelfOrderingMenuService>(
      ClubSelfOrderingMenuService,
    );
  });

  it('正常返回：分类分组 + specGroups 恒为空 + unlimited 库存', async () => {
    // 真实 Prisma 按 id asc 返回，mock 保持同一顺序
    prisma.productCategory.findMany.mockResolvedValue([
      { id: 1, name: '酒水饮料' },
      { id: 2, name: '零食小吃' },
    ]);
    prisma.product.findMany.mockResolvedValue([
      {
        id: 101,
        categoryId: 1,
        name: '可口可乐',
        description: '330ml',
        image: 'x.png',
        price: 800,
        updatedAt: new Date('2026-09-01'),
      },
      {
        id: 201,
        categoryId: 2,
        name: '乐事薯片',
        description: null,
        image: null,
        price: 1000,
        updatedAt: new Date('2026-09-02'),
      },
    ]);

    const result = await service.getMenu(user, 42);

    // categories 按 id 升序输出（查询排序），sortOrder 重新编号
    expect(result.categories.map((c) => c.name)).toEqual([
      '酒水饮料',
      '零食小吃',
    ]);
    expect(result.categories[0]).toMatchObject({
      id: 1,
      sortOrder: 1,
      products: [
        expect.objectContaining({
          id: 101,
          basePrice: 800,
          stockMode: 'unlimited',
          stockQuantity: null,
          specGroups: [],
        }),
      ],
    });
    expect(result.menuVersion).toBe(`v${new Date('2026-09-02').getTime()}`);
  });

  it('会话不可用时拒绝', async () => {
    prisma.spaceSession.findFirst.mockResolvedValue(null);

    await expect(service.getMenu(user, 42)).rejects.toThrow(ForbiddenException);
  });

  it('无归属商品归入「其他」兜底分类', async () => {
    prisma.productCategory.findMany.mockResolvedValue([
      { id: 1, name: '酒水饮料' },
    ]);
    prisma.product.findMany.mockResolvedValue([
      {
        id: 101,
        categoryId: 1,
        name: '可口可乐',
        description: null,
        image: null,
        price: 800,
        updatedAt: new Date('2026-09-01'),
      },
      {
        id: 301,
        categoryId: null,
        name: '一次性拖鞋',
        description: null,
        image: null,
        price: 300,
        updatedAt: new Date('2026-09-01'),
      },
    ]);

    const result = await service.getMenu(user, 42);

    const fallback = result.categories.find((c) => c.id === -1);
    expect(fallback).toMatchObject({ name: '其他', sortOrder: 2 });
    expect(fallback?.products).toHaveLength(1);
    expect(fallback?.products[0]).toMatchObject({ id: 301, categoryId: -1 });
  });

  it('空分类被过滤，不出现在左栏', async () => {
    prisma.productCategory.findMany.mockResolvedValue([
      { id: 1, name: '酒水饮料' },
      { id: 2, name: '空分类' },
    ]);
    prisma.product.findMany.mockResolvedValue([
      {
        id: 101,
        categoryId: 1,
        name: '可口可乐',
        description: null,
        image: null,
        price: 800,
        updatedAt: new Date('2026-09-01'),
      },
    ]);

    const result = await service.getMenu(user, 42);

    expect(result.categories.map((c) => c.name)).toEqual(['酒水饮料']);
  });

  it('无商品时返回空菜单', async () => {
    prisma.productCategory.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);

    const result = await service.getMenu(user, 42);

    expect(result).toEqual({ menuVersion: 'empty', categories: [] });
  });
});
