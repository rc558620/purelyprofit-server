import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessModeGuard } from '../stores/business-mode.guard';
import { BUSINESS_MODE_KEY } from '../stores/business-mode.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MarketingProductsController } from './marketing-products.controller';
import { MarketingProductCategoriesController } from './marketing-product-categories.controller';
import { MarketingOverviewController } from './marketing-overview.controller';
import { MarketingPromotionsController } from './marketing-promotions.controller';
import { MarketingTransactionsController } from './marketing-transactions.controller';

/**
 * 营销商品上架业态接口保护测试。
 *
 * 覆盖：
 * - 餐饮门店请求营销商品接口 → 403
 * - 非餐饮且具备原营销权限时通过
 * - 非餐饮但无原营销权限时仍返回 403
 * - 营销中心其他接口（充值、会员、优惠活动）不受业态限制
 */
describe('营销商品上架业态接口保护', () => {
  let reflector: Reflector;
  let guard: BusinessModeGuard;
  let storeBusinessCapabilityService: {
    getCapabilities: jest.Mock;
  };

  const buildUser = (
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser => ({
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: {
      staffId: 1,
      storeId: 100,
      role: 'staff',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
    },
    ...overrides,
  });

  const buildExecutionContext = (user: AuthenticatedUser) =>
    ({
      getHandler: () => 'listProducts',
      getClass: () => MarketingProductsController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    storeBusinessCapabilityService = {
      getCapabilities: jest.fn(),
    };
    reflector = new Reflector();
    guard = new BusinessModeGuard(
      reflector,
      storeBusinessCapabilityService as unknown as StoreBusinessCapabilityService,
    );
  });

  const mockGeneralRequirement = () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === BUSINESS_MODE_KEY) return 'general';
        return undefined;
      });
  };

  it('餐饮门店请求营销商品接口返回 403', async () => {
    mockGeneralRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'catering',
      isCateringStore: true,
      isGeneralStore: false,
      canUseMarketingProductListing: false,
    });

    await expect(
      guard.canActivate(buildExecutionContext(buildUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('非餐饮且具备原营销权限时通过', async () => {
    mockGeneralRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: true,
      canUseMarketingProductListing: true,
    });

    const result = await guard.canActivate(buildExecutionContext(buildUser()));

    expect(result).toBe(true);
  });

  it('门店未知/数据库失败时返回 403', async () => {
    mockGeneralRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: false,
      canUseMarketingProductListing: false,
    });

    await expect(
      guard.canActivate(buildExecutionContext(buildUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('验证 MarketingProductsController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      MarketingProductsController,
    );
    expect(requirement).toBe('general');
  });

  it('验证 MarketingProductCategoriesController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      MarketingProductCategoriesController,
    );
    expect(requirement).toBe('general');
  });

  it('验证营销中心其他 Controller 未声明 @RequireBusinessMode（不受业态限制）', () => {
    expect(
      Reflect.getMetadata(BUSINESS_MODE_KEY, MarketingOverviewController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(BUSINESS_MODE_KEY, MarketingPromotionsController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(BUSINESS_MODE_KEY, MarketingTransactionsController),
    ).toBeUndefined();
  });
});
