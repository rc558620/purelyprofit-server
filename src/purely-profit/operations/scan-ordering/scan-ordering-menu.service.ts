import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingMenuCategoryService } from './scan-ordering-menu-category.service';
import {
  ScanOrderingMenuProductService,
  type ScanOrderingMenuProductResponse,
} from './scan-ordering-menu-product.service';
import { ScanOrderingMenuSpecService } from './scan-ordering-menu-spec.service';
import { ScanOrderingMenuStockService } from './scan-ordering-menu-stock.service';
import { ScanOrderingMenuQueryService } from './scan-ordering-menu-query.service';
import type {
  CreateScanOrderingMenuCategoryDto,
  CreateScanOrderingMenuProductDto,
  UpdateScanOrderingMenuProductAvailabilityDto,
} from './dto/scan-ordering-menu.dto';
import type {
  CreateScanOrderingSpecGroupDto,
  CreateScanOrderingSpecOptionDto,
} from './dto/scan-ordering-spec.dto';
import type {
  UpdateScanOrderingMenuProductDto,
  UpdateScanOrderingSpecGroupDto,
  UpdateScanOrderingSpecOptionDto,
} from './dto/scan-ordering-menu-update.dto';
import type { UpdateScanOrderingProductStockDto } from './dto/scan-ordering-product-stock.dto';
import type { UpdateScanOrderingMenuCategoryDto } from './dto/scan-ordering-category-update.dto';
import type { ScanOrderingMenuCategoryResponse } from './scan-ordering-menu-category.service';

/**
 * 商家扫码点餐菜单服务（统一接口层）。
 *
 * 原实现已拆分为：
 * - ScanOrderingMenuCategoryService: 分类 CRUD
 * - ScanOrderingMenuProductService: 商品 CRUD 和上下架
 * - ScanOrderingMenuSpecService: 规格组和选项管理
 * - ScanOrderingMenuStockService: 库存更新
 * - ScanOrderingMenuQueryService: 查询与缓存
 */
export class ScanOrderingMenuService {
  constructor(
    private readonly categoryService: ScanOrderingMenuCategoryService,
    private readonly productService: ScanOrderingMenuProductService,
    private readonly specService: ScanOrderingMenuSpecService,
    private readonly stockService: ScanOrderingMenuStockService,
    private readonly queryService: ScanOrderingMenuQueryService,
  ) {}

  async createCategory(
    user: AuthenticatedUser,
    dto: CreateScanOrderingMenuCategoryDto,
  ): Promise<ScanOrderingMenuCategoryResponse> {
    return this.categoryService.createCategory(user, dto);
  }

  async updateCategory(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateScanOrderingMenuCategoryDto,
  ): Promise<void> {
    return this.categoryService.updateCategory(user, categoryId, dto);
  }

  async removeCategory(
    user: AuthenticatedUser,
    categoryId: number,
  ): Promise<void> {
    return this.categoryService.removeCategory(user, categoryId);
  }

  async createProduct(
    user: AuthenticatedUser,
    dto: CreateScanOrderingMenuProductDto,
  ): Promise<ScanOrderingMenuProductResponse> {
    return this.productService.createProduct(user, dto);
  }

  async updateProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateScanOrderingMenuProductDto,
  ): Promise<void> {
    return this.productService.updateProduct(user, productId, dto);
  }

  async removeProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    return this.productService.removeProduct(user, productId);
  }

  async updateProductAvailability(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateScanOrderingMenuProductAvailabilityDto,
  ): Promise<void> {
    return this.productService.updateAvailability(user, productId, dto);
  }

  async createSpecGroup(
    user: AuthenticatedUser,
    productId: number,
    dto: CreateScanOrderingSpecGroupDto,
  ): Promise<number> {
    return this.specService.createSpecGroup(user, productId, dto);
  }

  async createSpecOption(
    user: AuthenticatedUser,
    groupId: number,
    dto: CreateScanOrderingSpecOptionDto,
  ): Promise<number> {
    return this.specService.createSpecOption(user, groupId, dto);
  }

  async updateSpecGroup(
    user: AuthenticatedUser,
    groupId: number,
    dto: UpdateScanOrderingSpecGroupDto,
  ): Promise<void> {
    return this.specService.updateSpecGroup(user, groupId, dto);
  }

  async removeSpecGroup(
    user: AuthenticatedUser,
    groupId: number,
  ): Promise<void> {
    return this.specService.removeSpecGroup(user, groupId);
  }

  async updateSpecOption(
    user: AuthenticatedUser,
    optionId: number,
    dto: UpdateScanOrderingSpecOptionDto,
  ): Promise<void> {
    return this.specService.updateSpecOption(user, optionId, dto);
  }

  async removeSpecOption(
    user: AuthenticatedUser,
    optionId: number,
  ): Promise<void> {
    return this.specService.removeSpecOption(user, optionId);
  }

  async updateProductStock(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateScanOrderingProductStockDto,
  ): Promise<void> {
    return this.stockService.updateProductStock(user, productId, dto);
  }

  async listMenu(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingMenuCategoryResponse[]> {
    return this.queryService.listMenu(user);
  }
}
