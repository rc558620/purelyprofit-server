import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubProductsService } from './club-products.service';

describe('ClubProductsService', () => {
  let service: ClubProductsService;

  const prismaService = {
    marketingProduct: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const clubStoresService = {
    getCurrent: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    accountScope: 'purely_club',
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    clubStoresService.getCurrent.mockResolvedValue({
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      coverImage: 'https://cdn.example.com/store-cover.png',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubProductsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubStoresService, useValue: clubStoresService },
      ],
    }).compile();

    service = module.get<ClubProductsService>(ClubProductsService);
  });

  it('list 在 featured=true 时仅返回热门商品并映射到 club 视图', async () => {
    prismaService.marketingProduct.findMany.mockResolvedValue([
      createProduct({ id: 31, name: '经典养护套餐', createdAt: new Date('2026-06-03T00:00:00.000Z') }),
      createProduct({ id: 30, name: '黄金焕肤疗程', personCount: 2, createdAt: new Date('2026-06-02T00:00:00.000Z') }),
      createProduct({ id: 29, name: '头皮护理套组', durationMinutes: 100, createdAt: new Date('2026-06-01T00:00:00.000Z') }),
      createProduct({ id: 28, name: '肩颈舒缓护理', createdAt: new Date('2026-05-31T00:00:00.000Z') }),
    ]);

    await expect(service.list(user, { featured: true })).resolves.toEqual({
      items: [
        expect.objectContaining({ id: '31', isHot: true, type: 'product' }),
        expect.objectContaining({ id: '30', isHot: true, type: 'package' }),
        expect.objectContaining({ id: '29', isHot: true, type: 'experience' }),
      ],
    });
    expect(prismaService.marketingProduct.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        isActive: true,
      },
      select: {
        id: true,
        categoryId: true,
        name: true,
        price: true,
        originalPrice: true,
        image: true,
        description: true,
        stock: true,
        durationMinutes: true,
        personCount: true,
        createdAt: true,
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('getDetail 返回当前门店指定商品详情', async () => {
    prismaService.marketingProduct.findFirst.mockResolvedValue(
      createProduct({
        id: 18,
        name: '黄金焕肤疗程',
        price: 49900,
        originalPrice: 68800,
        description: '激活细胞，提亮肤色，7 天肉眼可见变化',
        durationMinutes: 100,
        personCount: 1,
      }),
    );

    await expect(service.getDetail(user, 18)).resolves.toEqual({
      id: '18',
      name: '黄金焕肤疗程',
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 499,
      type: 'experience',
      tags: ['热销', '面部护理'],
      isHot: true,
      stock: 30,
      validityDesc: '单次服务约 100 分钟 · 适用 1 人',
      details: [
        '激活细胞，提亮肤色，7 天肉眼可见变化',
        '服务分类：面部护理',
        '参考时长：100 分钟',
        '适用人数：1 人',
        '当前库存：30 份',
      ],
    });
  });

  it('getDetail 在当前门店找不到商品时抛出 NotFoundException', async () => {
    prismaService.marketingProduct.findFirst.mockResolvedValue(null);

    await expect(service.getDetail(user, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function createProduct(
  overrides?: Partial<{
    id: number;
    categoryId: number;
    name: string;
    price: number;
    originalPrice: number | null;
    image: string | null;
    description: string | null;
    stock: number;
    durationMinutes: number | null;
    personCount: number | null;
    createdAt: Date;
    category: { name: string };
  }>,
): {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  description: string | null;
  stock: number;
  durationMinutes: number | null;
  personCount: number | null;
  createdAt: Date;
  category: { name: string };
} {
  return {
    id: 1,
    categoryId: 3,
    name: '经典养护套餐',
    price: 19900,
    originalPrice: 28800,
    image: null,
    description: '深层清洁 + 补水保湿，恢复肌肤光泽活力',
    stock: 30,
    durationMinutes: 60,
    personCount: 1,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    category: { name: '面部护理' },
    ...overrides,
  };
}
