// 服务详情页聚合服务测试：覆盖「一次聚合五份数据」「按商品类型选取价链路」与降级口径
//
// 降级口径是这个模块最容易写坏的地方：页面原先对账户/积分比例/取价各自 catch，
// 收敛到服务端后一旦变成整页失败，用户会在这些旁支出错时连商品都看不到。
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubMemberService } from '../../member/club-member.service';
import { ClubOrderPreviewService } from '../../orders/club-order-preview.service';
import type { ClubProductDto } from '../dto/club-product.dto';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import { ClubProductsService } from '../club-products.service';
import { ClubVoucherOrdersService } from '../../voucher-orders/club-voucher-orders.service';
import { ClubProductBootstrapService } from './club-product-bootstrap.service';

describe('ClubProductBootstrapService', () => {
  let service: ClubProductBootstrapService;

  const clubProductsService = { getDetail: jest.fn() };
  const clubMemberService = {
    getAccount: jest.fn(),
    getPointsRatio: jest.fn(),
  };
  const clubOrderPreviewService = { previewServiceOrder: jest.fn() };
  const clubVoucherOrdersService = { previewVoucherOrder: jest.fn() };

  const currentContext = {
    user: {
      id: 201,
      email: 'club_phone_13800138000@purelyprofit.local',
      phone: '13800138000',
      name: '俱乐部用户',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      lastActiveAt: null,
      accountScope: 'purely_club',
      currentMembership: null,
    },
    store: {
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      businessMode: 'general' as const,
      memberCareEnabled: false,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  } satisfies ClubCurrentContext;

  const buildProduct = (
    overrides: Partial<ClubProductDto> = {},
  ): ClubProductDto =>
    ({
      id: '18',
      name: '肩颈舒缓护理',
      categoryId: '3',
      description: '服务说明',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 619.2,
      finalPrice: 619.2,
      type: 'product',
      tags: [],
      isHot: false,
      isActive: true,
      stock: 10,
      createdAt: Date.parse('2026-05-12T00:00:00.000Z'),
      updatedAt: Date.parse('2026-05-13T00:00:00.000Z'),
      ...overrides,
    }) as ClubProductDto;

  const mockAccount = {
    id: '201',
    storeId: '11',
    balance: 350,
    level: 'gold' as const,
    points: 1280,
    memberCode: 'PC20240601001',
    joinDate: '2024-06-01',
    totalConsume: 3200,
  };
  const mockPointsRatio = {
    redeemRatioPoints: 100,
    maxRedeemRatio: 0.5,
    enabled: true,
  };
  const mockServicePreview = {
    originalPrice: 688,
    finalPrice: 619.2,
    quantity: 1,
    balanceEnough: true,
  };
  const mockVoucherPreview = {
    originalAmountFen: 68800,
    paidAmountFen: 61920,
    pointsUsed: 0,
    personCount: 2,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // 降级分支会打 warn，统一静音避免污染测试输出
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    clubProductsService.getDetail.mockResolvedValue(buildProduct());
    clubMemberService.getAccount.mockResolvedValue(mockAccount);
    clubMemberService.getPointsRatio.mockResolvedValue(mockPointsRatio);
    clubOrderPreviewService.previewServiceOrder.mockResolvedValue(
      mockServicePreview,
    );
    clubVoucherOrdersService.previewVoucherOrder.mockResolvedValue(
      mockVoucherPreview,
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ClubProductBootstrapService,
        { provide: ClubProductsService, useValue: clubProductsService },
        { provide: ClubMemberService, useValue: clubMemberService },
        { provide: ClubOrderPreviewService, useValue: clubOrderPreviewService },
        {
          provide: ClubVoucherOrdersService,
          useValue: clubVoucherOrdersService,
        },
      ],
    }).compile();

    service = moduleRef.get<ClubProductBootstrapService>(
      ClubProductBootstrapService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('一次返回商品 / 账户 / 门店 / 积分比例与服务 preview', async () => {
    const result = await service.getBootstrap(currentContext, 18);

    expect(result.product.id).toBe('18');
    expect(result.account).toEqual(mockAccount);
    expect(result.storeId).toBe(11);
    expect(result.pointsRatio).toEqual(mockPointsRatio);
    expect(result.servicePreview).toEqual(mockServicePreview);
    expect(result.voucherPreview).toBeNull();
    // 门店由上下文提供，聚合接口不再单独打 /stores/current
    expect(clubVoucherOrdersService.previewVoucherOrder).not.toHaveBeenCalled();
  });

  it('服务 preview 恒定以 usePoints=true 取价（取的是最大可抵扣额度，与开关无关）', async () => {
    await service.getBootstrap(currentContext, 18);

    expect(clubOrderPreviewService.previewServiceOrder).toHaveBeenCalledTimes(
      1,
    );
    expect(clubOrderPreviewService.previewServiceOrder).toHaveBeenCalledWith(
      currentContext,
      expect.objectContaining({
        storeId: 11,
        productId: 18,
        quantity: 1,
        usePoints: true,
      }),
    );
  });

  it('团购券商品走券链路，人数取商品配置，不打服务 preview', async () => {
    clubProductsService.getDetail.mockResolvedValue(
      buildProduct({ type: 'voucher', personCount: 2 }),
    );

    const result = await service.getBootstrap(currentContext, 18);

    expect(clubVoucherOrdersService.previewVoucherOrder).toHaveBeenCalledWith(
      currentContext,
      expect.objectContaining({
        storeId: 11,
        productId: 18,
        quantity: 1,
        personCount: 2,
        usePoints: true,
      }),
    );
    expect(clubOrderPreviewService.previewServiceOrder).not.toHaveBeenCalled();
    expect(result.voucherPreview).toEqual(mockVoucherPreview);
    expect(result.servicePreview).toBeNull();
  });

  it('账户 / 积分比例失败降级为 null，不拖垮整页', async () => {
    clubMemberService.getAccount.mockRejectedValue(new Error('账户服务异常'));
    clubMemberService.getPointsRatio.mockRejectedValue(
      new Error('配置服务异常'),
    );

    const result = await service.getBootstrap(currentContext, 18);

    expect(result.account).toBeNull();
    expect(result.pointsRatio).toBeNull();
    expect(result.product.id).toBe('18');
  });

  it('取价失败降级为无 preview，页面按商品价展示', async () => {
    clubOrderPreviewService.previewServiceOrder.mockRejectedValue(
      new Error('取价失败'),
    );

    const result = await service.getBootstrap(currentContext, 18);

    expect(result.servicePreview).toBeNull();
    expect(result.product.id).toBe('18');
  });

  it('商品不存在时上抛，保留与详情接口一致的错误态', async () => {
    clubProductsService.getDetail.mockRejectedValue(
      new NotFoundException('服务商品不存在或未上架'),
    );

    await expect(service.getBootstrap(currentContext, 18)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('上下文缺失时拒绝处理', async () => {
    await expect(
      service.getBootstrap({} as ClubCurrentContext, 18),
    ).rejects.toThrow(BadRequestException);
  });
});
